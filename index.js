// Entry point for the pey.storage plugin
// Two-phase lifecycle per Bonyan architecture 0.11:
//   prepare()   — build and return the declared storage service; no other
//                 plugin's service is available yet.
//   activate()  — wire dependencies (none declared here), publish the ready
//                 event, and assign lifecycle hooks.

import { PLUGIN_VERSION, SERVICE_NAME, EVENT_READY, ERROR_CODES, ERROR_SOURCE } from './lib/constants.js'
import { buildStartupError } from './lib/error.js'
import StorageService from './lib/storage-service.js'
import IndexedDBAdapter from './adapters/indexeddb-adapter.js'

/** Known adapter name → constructor map */
const ADAPTERS = {
  IndexedDBAdapter,
}

// Module-level closure: prepare()'s context is the same object reference the
// Core reads back later (e.g. for onShutdown), and activate() needs it too
// since it only receives `services`. storesConfig/adapterRef/serviceRef are
// kept here likewise so activate() (and the lifecycle hooks) can read them
// without reaching into StorageService internals.
let savedContext = null
let storesConfig = null
let adapterRef = null
let serviceRef = null

/**
 * Phase 1 — preparation.
 *
 * Build and return the declared service instances. No other plugin's service
 * is available yet; do not call one. Must return an array.
 *
 * @param {object} prepareContext — PrepareContext from the Core
 * @returns {Promise<{ name: string, object: StorageService }[]>}
 */
export async function prepare(prepareContext) {
  savedContext = prepareContext

  // 1) Resolve the adapter by identifier. The Core guarantees config.adapter
  //    is present when adapterType is declared (ADAPTER_NOT_CONFIGURED is
  //    caught at declaration validation, before this runs). ADAPTER_SELECTION_INVALID
  //    (malformed selection) is likewise caught before this runs.
  const adapterName = prepareContext.config.adapter
  const AdapterClass = ADAPTERS[adapterName]
  if (!AdapterClass) {
    throw buildStartupError(
      ERROR_CODES.ADAPTER_NOT_CONFIGURED,
      `Unknown adapter: ${adapterName}`
    )
  }

  // 2) Plugin-owned fields the adapter consumes (declared in manifest.config).
  //    These remain the plugin's responsibility, not the Core's, even under 0.11.
  storesConfig = prepareContext.config.stores || []

  const adapter = new AdapterClass()
  const service = new StorageService(adapter, storesConfig)

  // 3) Build a single adapter-scoped config: plugin-level defaults first,
  //    Core-injected adapterConfig (extended bootstrap form only; absent in
  //    the simple form, in which case the empty spread is a no-op and behavior
  //    is byte-identical to the pre-migration path). ...adapterConfig wins on
  //    overlap — least-surprising override rule.
  //    Do NOT pass the whole prepareContext.config through: it carries the
  //    `adapter` identifier itself and other plugin-level fields the adapter
  //    has no business reading.
  const adapterConfig = {
    databaseName: prepareContext.config.databaseName,
    schemaVersion: prepareContext.config.schemaVersion,
    stores: storesConfig,
    ...prepareContext.config.adapterConfig,
  }

  // Open the adapter before exposing the service.
  // Any failure here is a startup failure — normalize to type 'startup'.
  // The Core maps a prepare() throw to PREPARATION_FAILED; we still throw the
  // structured startup error so the underlying code is observable.
  try {
    await adapter.open(adapterConfig)
  } catch (rawError) {
    // Re-wrap with type 'startup' regardless of original error type
    if (rawError && rawError.code && rawError.source === ERROR_SOURCE) {
      throw {
        ...rawError,
        type: 'startup',
        message: `Startup error: ${rawError.message}`,
      }
    }
    throw buildStartupError(
      ERROR_CODES.STORAGE_UNAVAILABLE,
      'Failed to open storage adapter during startup'
    )
  }

  adapterRef = adapter
  serviceRef = service

  return [
    { name: SERVICE_NAME, object: service },
  ]
}

/**
 * Phase 2 — binding + local activation.
 *
 * Receives ONLY the resolved services object. Anything else (config, events,
 * lifecycle hooks, reportCriticalError) must be read off savedContext captured
 * in prepare(). This plugin declares no required/optional dependency, so
 * `services` is intentionally ignored — do not read any key from it.
 *
 * @param {object} services — resolved declared dependencies (none for this plugin)
 * @returns {Promise<void>}
 */
export async function activate(_services) {
  // Publish the ready event after binding + local activation: the service is
  // now logically "alive". events is accessed via the saved prepare-time
  // context since activate() only receives `services`.
  savedContext.events.publish(EVENT_READY, {
    version: PLUGIN_VERSION,
    stores: storesConfig.map(s => s.name),
  })

  // Lifecycle hooks
  savedContext.onShutdown = async () => {
    await adapterRef.close()
    serviceRef._setDeactivated()
  }

  savedContext.onDeactivated = async () => {
    await adapterRef.close()
    serviceRef._setDeactivated()
  }
}

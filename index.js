// Entry point for the pey.storage plugin
// Registers the storage service with the Core and manages lifecycle.

import { PLUGIN_NAME, PLUGIN_VERSION, SERVICE_NAME, EVENT_READY, ERROR_CODES } from './lib/constants.js'
import { buildStartupError } from './lib/error.js'
import StorageService from './lib/storage-service.js'
import IndexedDBAdapter from './adapters/indexeddb-adapter.js'

/** Known adapter name → constructor map */
const ADAPTERS = {
  IndexedDBAdapter,
}

/**
 * Plugin entry point.
 * Called by the Core during plugin startup.
 *
 * @param {object} context — plugin context from the Core
 * @returns {Promise<{ name: string, object: StorageService }[]>}
 */
export async function setup(context) {
  const adapterName = context.config.adapter
  const AdapterClass = ADAPTERS[adapterName]

  if (!AdapterClass) {
    throw buildStartupError(
      ERROR_CODES.ADAPTER_NOT_CONFIGURED,
      `Unknown adapter: ${adapterName}`
    )
  }

  const adapter = new AdapterClass()
  const storesConfig = context.config.stores || []
  const service = new StorageService(adapter, storesConfig)

  // Open the adapter before exposing the service
  await adapter.open(context.config)

  // Publish the ready event after successful open
  context.events.publish(EVENT_READY, {
    version: PLUGIN_VERSION,
    stores: storesConfig.map(s => s.name),
  })

  // Lifecycle hooks
  context.onShutdown = async () => {
    await adapter.close()
    service._setDeactivated()
  }

  context.onDeactivated = async () => {
    await adapter.close()
    service._setDeactivated()
  }

  return [
    { name: SERVICE_NAME, object: service },
  ]
}

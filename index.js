// Entry point for the pey.storage plugin
// Registers the storage service with the Core and manages lifecycle.

import { PLUGIN_NAME, SERVICE_NAME, EVENT_READY } from './lib/constants.js'
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
 * @returns {{ name: string, object: StorageService }[]}
 */
export function setup(context) {
  const adapterName = context.config.adapter
  const AdapterClass = ADAPTERS[adapterName]

  if (!AdapterClass) {
    context.reportCriticalError({
      code: 'ADAPTER_NOT_CONFIGURED',
      message: `Unknown adapter: ${adapterName}`,
      source: PLUGIN_NAME,
      type: 'critical',
      timestamp: new Date().toISOString(),
    })
    return []
  }

  const adapter = new AdapterClass()
  const storesConfig = context.config.stores || []
  const service = new StorageService(adapter, storesConfig)

  // Open the adapter and then publish the ready event
  adapter.open(context.config).then(() => {
    context.events.publish(EVENT_READY, {
      version: '0.1.0',
      stores: storesConfig.map(s => s.name),
    })
  }).catch((err) => {
    context.reportCriticalError({
      code: 'STORAGE_UNAVAILABLE',
      message: 'Failed to open storage adapter',
      source: PLUGIN_NAME,
      type: 'critical',
      timestamp: new Date().toISOString(),
      detail: { error: err.message },
    })
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

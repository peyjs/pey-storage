// Shared constants for the pey.storage plugin

/** Plugin name — matches manifest.json `name` */
export const PLUGIN_NAME = 'pey.storage'

/** Plugin version — matches manifest.json `version` */
export const PLUGIN_VERSION = '0.5.0'

/** Service name — matches manifest.json `provides[0].name` */
export const SERVICE_NAME = 'pey.storage.service'

/** Event name — matches manifest.json `events[0].name` */
export const EVENT_READY = 'storage:ready'

/** Default IndexedDB database name */
export const DEFAULT_DB_NAME = 'pey-app-db'

/** Default schema version */
export const DEFAULT_SCHEMA_VERSION = 1

/** Export format version */
export const EXPORT_FORMAT_VERSION = '1.0.0'

/** Standard Bonyan error source prefix */
export const ERROR_SOURCE = 'pey.storage'

/** Error codes */
export const ERROR_CODES = {
  STORE_NOT_FOUND: 'STORE_NOT_FOUND',
  RECORD_NOT_FOUND: 'RECORD_NOT_FOUND',
  ADAPTER_NOT_OPEN: 'ADAPTER_NOT_OPEN',
  ADAPTER_NOT_CONFIGURED: 'ADAPTER_NOT_CONFIGURED',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  STORAGE_UNAVAILABLE: 'STORAGE_UNAVAILABLE',
  TRANSACTION_FAILED: 'TRANSACTION_FAILED',
  SCHEMA_UPGRADE_FAILED: 'SCHEMA_UPGRADE_FAILED',
  IMPORT_INVALID_PAYLOAD: 'IMPORT_INVALID_PAYLOAD',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
}

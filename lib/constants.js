// Shared constants for the pey.storage plugin

/** Plugin name — matches manifest.json `name` */
export const PLUGIN_NAME = 'pey.storage'

/** Service name — matches manifest.json `provides[0].name` */
export const SERVICE_NAME = 'pey.storage.service'

/** Event name — matches manifest.json `events[0].name` */
export const EVENT_READY = 'storage:ready'

/** Default IndexedDB database name */
export const DEFAULT_DB_NAME = 'pey-app-db'

/** Default schema version */
export const DEFAULT_SCHEMA_VERSION = 1

/** Standard Bonyan error source prefix */
export const ERROR_SOURCE = 'pey.storage'

/** Error codes */
export const ERROR_CODES = {
  STORE_NOT_FOUND: 'STORE_NOT_FOUND',
  RECORD_NOT_FOUND: 'RECORD_NOT_FOUND',
  STORE_NOT_OPENED: 'STORE_NOT_OPENED',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  STORAGE_UNAVAILABLE: 'STORAGE_UNAVAILABLE',
  TRANSACTION_FAILED: 'TRANSACTION_FAILED',
  IMPORT_INVALID_PAYLOAD: 'IMPORT_INVALID_PAYLOAD',
}

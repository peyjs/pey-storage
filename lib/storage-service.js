// Storage service — plugin layer orchestration
// Implements all 10 service methods declared in manifest.json.
// Decision logic lives here; raw primitives are delegated to the adapter.

import { PLUGIN_NAME, SERVICE_NAME, EVENT_READY, EXPORT_FORMAT_VERSION, ERROR_CODES } from './constants.js'
import { buildError } from './error.js'

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Validate that a collection name matches a configured store.
 * Throws a standard Bonyan error if unknown.
 *
 * @param {string} collection
 * @param {Set<string>} configuredStores
 */
function validateCollection(collection, configuredStores) {
  if (!configuredStores.has(collection)) {
    throw buildError('STORE_NOT_FOUND', `Collection "${collection}" is not configured`, { collection })
  }
}

/**
 * Resolve the keyPath for a collection from the store definitions.
 *
 * @param {string} collection
 * @param {Array} storesConfig
 * @returns {string}
 */
function resolveKeyPath(collection, storesConfig) {
  const store = storesConfig.find(s => s.name === collection)
  return store?.keyPath ?? 'id'
}

/**
 * Validate the structure of an import payload.
 * Throws a standard Bonyan error if invalid.
 *
 * @param {object} payload
 */
function validateImportPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw buildError('IMPORT_INVALID_PAYLOAD', 'Import payload must be a non-null object')
  }
  if (!payload.data || typeof payload.data !== 'object') {
    throw buildError('IMPORT_INVALID_PAYLOAD', 'Import payload must contain a "data" object')
  }
}

// ---------------------------------------------------------------------------
// Public: Storage service class
// ---------------------------------------------------------------------------

/**
 * Plugin-layer storage service.
 * Orchestrates adapter primitives and hosts all decision logic.
 *
 * Encryption is a no-op hook in v0.1.0 — reserved for future addition.
 */
export default class StorageService {
  /**
   * @param {object} adapter — any storage adapter implementing the full contract
   * @param {Array}  storesConfig — configured store definitions from plugin config
   */
  constructor(adapter, storesConfig = []) {
    /** @type {object} adapter — storage adapter (IndexedDB or in-memory) */
    this._adapter = adapter
    /** @type {Array} storesConfig — store definitions resolved from config */
    this._storesConfig = storesConfig
    /** @type {Set<string>} configured store names for validation */
    this._configuredStores = new Set(storesConfig.map(s => s.name))
    /** @type {boolean} whether the service has been deactivated */
    this._deactivated = false
  }

  // -- Lifecycle control --

  /** Mark the service as deactivated. All methods must return an error after this. */
  _setDeactivated() {
    this._deactivated = true
  }

  /**
   * Check if the service is still active; throw if deactivated.
   * @private
   */
  _requireActive() {
    if (this._deactivated) {
      throw buildError(ERROR_CODES.SERVICE_UNAVAILABLE, 'Storage service is deactivated')
    }
  }

  // -- CRUD operations (delegate to adapter after validation) --

  /**
   * Read a single record by key from a collection.
   *
   * @param {string} collection
   * @param {string | number} key
   * @returns {Promise<object | null>}
   */
  async read(collection, key) {
    this._requireActive()
    validateCollection(collection, this._configuredStores)
    return this._adapter.read(collection, key)
  }

  /**
   * Write (insert or update) a single record.
   *
   * @param {string} collection
   * @param {object} record
   * @returns {Promise<void>}
   */
  async write(collection, record) {
    this._requireActive()
    validateCollection(collection, this._configuredStores)
    return this._adapter.write(collection, record)
  }

  /**
   * Delete a single record by key.
   *
   * @param {string} collection
   * @param {string | number} key
   * @returns {Promise<void>}
   */
  async delete(collection, key) {
    this._requireActive()
    validateCollection(collection, this._configuredStores)
    return this._adapter.delete(collection, key)
  }

  /**
   * Query records with a raw index/range criteria.
   *
   * @param {string} collection
   * @param {object} criteria
   * @returns {Promise<object[]>}
   */
  async query(collection, criteria = {}) {
    this._requireActive()
    validateCollection(collection, this._configuredStores)
    return this._adapter.query(collection, criteria)
  }

  /**
   * Count records, optionally filtered by raw query criteria.
   *
   * @param {string} collection
   * @param {object} [criteria]
   * @returns {Promise<number>}
   */
  async count(collection, criteria = {}) {
    this._requireActive()
    validateCollection(collection, this._configuredStores)
    return this._adapter.count(collection, criteria)
  }

  // -- Bulk operations (delegate to adapter) --

  /**
   * Bulk insert or update multiple records atomically.
   *
   * @param {string} collection
   * @param {object[]} records
   * @returns {Promise<void>}
   */
  async bulkWrite(collection, records) {
    this._requireActive()
    validateCollection(collection, this._configuredStores)
    return this._adapter.bulkWrite(collection, records)
  }

  /**
   * Bulk delete multiple records atomically.
   *
   * @param {string} collection
   * @param {(string | number)[]} keys
   * @returns {Promise<void>}
   */
  async bulkDelete(collection, keys) {
    this._requireActive()
    validateCollection(collection, this._configuredStores)
    return this._adapter.bulkDelete(collection, keys)
  }

  // -- Transaction (delegate to adapter) --

  /**
   * Run multiple raw operations atomically.
   * Plugin orchestrates; adapter executes atomically.
   *
   * @param {object[]} operations
   * @returns {Promise<void>}
   */
  async transaction(operations) {
    this._requireActive()
    // Validate all target collections upfront
    for (const op of operations) {
      validateCollection(op.collection, this._configuredStores)
    }
    return this._adapter.transaction(operations)
  }

  // -- Export (plugin-layer decision logic) --

  /**
   * Export records as a JSON-compatible payload with metadata.
   *
   * @param {string[] | null} [collections] — specific collections to export, or null for all
   * @returns {Promise<{ metadata: object, data: object }>}
   */
  async exportData(collections = null) {
    this._requireActive()

    const targetCollections = collections || [...this._configuredStores]
    for (const collection of targetCollections) {
      validateCollection(collection, this._configuredStores)
    }

    // Encryption placeholder: future hook for transparent encryption
    // No-op in v0.1.0

    const metadata = {
      format: 'pey-storage-export',
      version: EXPORT_FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      collections: targetCollections,
    }

    const data = {}
    for (const collection of targetCollections) {
      data[collection] = await this._adapter.query(collection, {})
    }

    return { metadata, data }
  }

  // -- Import (plugin-layer decision logic) --

  /**
   * Import a previously exported payload with replace, merge, or restore mode.
   *
   * @param {object} payload — exported data object
   * @param {'replace' | 'merge' | 'restore'} [mode='merge']
   * @returns {Promise<{ imported: number, skipped: object[], deleted: number, errors: object[] }>}
   *
   * @description
   * Replace mode: all records are written atomically via bulkWrite.
   * Merge mode: each record is checked individually; if the key exists,
   * it is skipped. Merge is NOT fully atomic per operation because each
   * record must be read before deciding to write.
   *
   * Restore mode: only collections present in payload.data are targeted.
   * For each target collection, all existing keys are read first, then a
   * single operation array is built containing: one `delete` for each
   * existing key + one `put` for each valid payload record. The entire
   * array is sent to `adapter.transaction()` in one call — fully atomic.
   * Invalid records (missing key) are reported in `errors` (reason:
   * 'missing-key') and excluded from the write; they do NOT abort the
   * transaction.
   *
   * NOTE: restore reads ALL existing keys into memory before building the
   * operation array. This is suitable for moderate-sized stores (roughly
   * < 50K records — unconfirmed, no benchmark); very large stores may hit
   * IndexedDB transaction limits or cause memory pressure.
   */
  async importData(payload, mode = 'merge') {
    this._requireActive()
    validateImportPayload(payload)

    const results = {
      imported: 0,
      skipped: [],
      deleted: 0,
      errors: [],
    }

    // Validate target collections upfront so that unknown collection names
    // fail fast — before any side effects.
    const targetCollections = Object.keys(payload.data)
    for (const collection of targetCollections) {
      validateCollection(collection, this._configuredStores)
    }

    // Restore mode: read all existing keys first, then build a single
    // atomic operation array (delete all existing + put all valid payload
    // records). This is done in TWO phases because we must collect all
    // existing keys across all collections before building operations.
    if (mode === 'restore') {
      const allOperations = []

      for (const [collection, records] of Object.entries(payload.data)) {
        const keyPath = resolveKeyPath(collection, this._storesConfig)
        const existingKeys = []

        // Read all existing records to collect their keys
        const existingRecords = await this._adapter.query(collection, {})
        for (const rec of existingRecords) {
          const key = rec[keyPath]
          if (key !== undefined && key !== null) {
            existingKeys.push(key)
          }
        }

        // Delete all existing records
        for (const key of existingKeys) {
          allOperations.push({ method: 'delete', collection, key })
        }

        // Prepare valid payload records (skip those with missing keys)
        const validRecords = []
        for (const record of records) {
          const key = record[keyPath]
          if (key === undefined || key === null) {
            results.errors.push({ collection, reason: 'missing-key', key })
            continue
          }
          validRecords.push(record)
        }

        // Put all valid records
        for (const record of validRecords) {
          allOperations.push({ method: 'put', collection, record })
        }
      }

      // Execute everything atomically
      if (allOperations.length > 0) {
        await this._adapter.transaction(allOperations)
      }

      // Count deleted and imported by counting actual operations built
      // (keeps numbers in sync with whatever filtering logic runs above)
      for (const op of allOperations) {
        if (op.method === 'delete') results.deleted++
        if (op.method === 'put') results.imported++
      }

      return results
    }

    // Existing modes: replace and merge
    for (const [collection, records] of Object.entries(payload.data)) {
      const keyPath = resolveKeyPath(collection, this._storesConfig)

      if (mode === 'replace') {
        await this._adapter.bulkWrite(collection, records)
        results.imported += records.length
      } else if (mode === 'merge') {
        for (const record of records) {
          const key = record[keyPath]
          if (key === undefined || key === null) {
            results.errors.push({ collection, reason: 'missing-key', key })
            continue
          }
          const existing = await this._adapter.read(collection, key)
          if (existing) {
            results.skipped.push({ collection, key })
          } else {
            await this._adapter.write(collection, record)
            results.imported++
          }
        }
      }
    }

    return results
  }
}

// IndexedDB storage adapter
// Implements the full storage adapter contract:
// read, write, delete, query, count, bulkWrite, bulkDelete, transaction,
// plus open, close, and destroy.
//
// Migration (store/index creation) happens in onupgradeneeded.

import { DEFAULT_DB_NAME, DEFAULT_SCHEMA_VERSION, ERROR_CODES } from '../lib/constants.js'
import { buildError, buildCriticalError, mapError } from '../lib/error.js'

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Open or upgrade the IndexedDB database.
 * Creates stores and indexes from config inside onupgradeneeded.
 *
 * @param {string} dbName       — database name (from config)
 * @param {number} schemaVersion — schema version (from config)
 * @param {Array} storesConfig  — configured stores
 * @returns {Promise<IDBDatabase>}
 */
function openDatabase(dbName, schemaVersion, storesConfig) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, schemaVersion)

    request.onerror = () => {
      reject(mapError(request.error, 'IDB.open'))
    }

    request.onsuccess = () => {
      resolve(request.result)
    }

    request.onupgradeneeded = (event) => {
      const db = event.target.result
      const storeNames = new Set(db.objectStoreNames)

      for (const storeDef of storesConfig) {
        if (storeNames.has(storeDef.name)) continue
        const store = db.createObjectStore(storeDef.name, {
          keyPath: storeDef.keyPath,
          autoIncrement: storeDef.autoIncrement ?? false,
        })
        if (storeDef.indexes) {
          for (const idx of storeDef.indexes) {
            store.createIndex(idx.name, idx.field, {
              unique: idx.unique ?? false,
            })
          }
        }
      }
    }
  })
}

/**
 * Get a reference to an object store within a transaction.
 * Wraps synchronous IndexedDB calls so any error
 * (e.g. unknown store name) is converted to a standard Bonyan error.
 *
 * @param {IDBDatabase} db
 * @param {string} storeName
 * @param {string} mode — 'readonly' | 'readwrite'
 * @returns {{ store: IDBObjectStore, tx: IDBTransaction }}
 * @throws {object} Standard Bonyan error if the store does not exist
 */
function getStore(db, storeName, mode) {
  try {
    const tx = db.transaction(storeName, mode)
    const store = tx.objectStore(storeName)
    return { store, tx }
  } catch (rawError) {
    throw mapError(rawError, `getStore[${storeName}]`)
  }
}

/**
 * Check that the database is open; throw if not.
 *
 * @param {IDBDatabase | null} db
 */
function requireOpen(db) {
  if (!db) {
    throw buildError(ERROR_CODES.ADAPTER_NOT_OPEN, 'Database is not open')
  }
}

/**
 * Build an IDBKeyRange from a criteria value.
 *
 * - Object with comparison operators ({ gte, lte, gt, lt }) → bound / lowerBound / upperBound
 * - Anything else → only()
 *
 * @param {object | string | number} criteriaValue
 * @returns {IDBKeyRange}
 */
function buildKeyRange(criteriaValue) {
  if (criteriaValue && typeof criteriaValue === 'object' && !Array.isArray(criteriaValue)) {
    const { gte, lte, gt, lt } = criteriaValue
    if (gte !== undefined && lte !== undefined) return IDBKeyRange.bound(gte, lte)
    if (gte !== undefined && lt !== undefined) return IDBKeyRange.bound(gte, lt, false, true)
    if (gt !== undefined && lte !== undefined) return IDBKeyRange.bound(gt, lte, true, false)
    if (gt !== undefined && lt !== undefined) return IDBKeyRange.bound(gt, lt, true, true)
    if (gte !== undefined) return IDBKeyRange.lowerBound(gte, false)
    if (lte !== undefined) return IDBKeyRange.upperBound(lte, false)
    if (gt !== undefined) return IDBKeyRange.lowerBound(gt, true)
    if (lt !== undefined) return IDBKeyRange.upperBound(lt, true)
  }
  return IDBKeyRange.only(criteriaValue)
}

/**
 * Check whether a criteria value object contains at least one range operator.
 * An empty {} object is treated as "match nothing" to keep in-memory and
 * IndexedDB adapters in sync (IDBKeyRange.only({}) would throw or match nothing).
 *
 * @param {object} criteriaValue
 * @returns {boolean}
 */
function hasRangeOperators(criteriaValue) {
  if (criteriaValue && typeof criteriaValue === 'object' && !Array.isArray(criteriaValue)) {
    const { gte, lte, gt, lt } = criteriaValue
    return (gte !== undefined || lte !== undefined || gt !== undefined || lt !== undefined)
  }
  return true // plain values (string/number) always "match" the key lookup
}

// ---------------------------------------------------------------------------
// Adapter class
// ---------------------------------------------------------------------------

/**
 * IndexedDB implementation of the storage adapter contract.
 *
 * All public methods convert raw IndexedDB errors to the
 * standard Bonyan error structure before returning.
 */
export default class IndexedDBAdapter {
  constructor() {
    /** @type {IDBDatabase | null} */
    this._db = null
    /** @type {boolean} */
    this._isOpen = false
    /** @type {string | null} */
    this._dbName = null
  }

  // ------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------

  /**
   * Open the database and create stores/indexes from config.
   * Also requests persistent storage to prevent auto-eviction.
   *
   * @param {object} config
   * @param {string} [config.databaseName]
   * @param {number} [config.schemaVersion]
   * @param {Array}  [config.stores]
   * @returns {Promise<void>}
   */
  async open(config = {}) {
    if (this._isOpen) return

    // Detect if IndexedDB is available
    if (typeof indexedDB === 'undefined') {
      throw buildCriticalError(ERROR_CODES.STORAGE_UNAVAILABLE, 'IndexedDB is not available in this environment')
    }

    this._dbName = config.databaseName || DEFAULT_DB_NAME
    const schemaVersion = config.schemaVersion || DEFAULT_SCHEMA_VERSION
    const storesConfig = config.stores || []

    this._db = await openDatabase(this._dbName, schemaVersion, storesConfig)
    this._isOpen = true

    // Request persistent storage (non-blocking — failure is acceptable)
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(() => {
        // Persistent storage request is a best-effort operation
      })
    }
  }

  /** Close the database connection. */
  async close() {
    if (!this._isOpen) return
    this._db?.close()
    this._isOpen = false
    this._db = null
  }

  /** Delete the entire database (utility / test). */
  async destroy() {
    if (!this._isOpen) return
    const dbName = this._dbName || DEFAULT_DB_NAME
    if (this._db) this._db.close()
    await new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase(dbName)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(mapError(req.error, 'IDB.deleteDatabase'))
    })
    this._isOpen = false
    this._db = null
    this._dbName = null
  }

  // ------------------------------------------------------------------
  // Core primitives
  // ------------------------------------------------------------------

  /**
   * Read a single record by key.
   *
   * @param {string} collection
   * @param {string | number} key
   * @returns {Promise<object | null>}
   */
  async read(collection, key) {
    requireOpen(this._db)
    const { store, tx } = getStore(this._db, collection, 'readonly')
    return new Promise((resolve, reject) => {
      const request = store.get(key)
      request.onsuccess = () => resolve(request.result ?? null)
      request.onerror = () => reject(mapError(request.error, `read[${collection}]`))
    })
  }

  /**
   * Write (insert or update) a single record.
   * Key resolution for autoIncrement stores is handled by IndexedDB itself.
   *
   * @param {string} collection
   * @param {object} record
   * @returns {Promise<void>}
   */
  async write(collection, record) {
    requireOpen(this._db)
    const { store, tx } = getStore(this._db, collection, 'readwrite')
    store.put(record)
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(mapError(tx.error, `write[${collection}]`))
    })
  }

  /**
   * Delete a single record by key.
   *
   * @param {string} collection
   * @param {string | number} key
   * @returns {Promise<void>}
   */
  async delete(collection, key) {
    requireOpen(this._db)
    const { store, tx } = getStore(this._db, collection, 'readwrite')
    store.delete(key)
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(mapError(tx.error, `delete[${collection}]`))
    })
  }

  /**
   * Query records with a raw index/range criteria.
   * Criteria is a plain object { indexName: value } for exact match,
   * or { indexName: { gte, lte } } for a range — any combination of
   * { gte, lte, gt, lt } keys (where "gt" = greater-than / "lt" =
   * less-than, both open-bounded).
   *
   * @param {string} collection
   * @param {object} criteria
   * @returns {Promise<object[]>}
   */
  async query(collection, criteria = {}) {
    requireOpen(this._db)
    const { store, tx } = getStore(this._db, collection, 'readonly')
    return new Promise((resolve, reject) => {
      const results = []
      let cursor

      const entries = Object.entries(criteria)
      if (entries.length > 0) {
        const [indexName, criteriaValue] = entries[0]
        // Empty {} object has no range operators — return empty results in sync with in-memory adapter
        if (!hasRangeOperators(criteriaValue)) {
          resolve(results)
          return
        }
        let index
        try {
          index = store.index(indexName)
        } catch (rawError) {
          reject(mapError(rawError, `query[${collection}] index=${indexName}`))
          return
        }
        cursor = index.openCursor(buildKeyRange(criteriaValue))
      } else {
        cursor = store.openCursor()
      }

      cursor.onsuccess = () => {
        const item = cursor?.result
        if (!item) {
          resolve(results)
          return
        }
        results.push(item.value)
        item.continue()
      }
      cursor.onerror = () => reject(mapError(cursor.error, `query[${collection}]`))
    })
  }

  /**
   * Count records, optionally filtered by a raw range query criteria.
   * Supports the same { indexName: value } and { indexName: { gte, lte } }
   * formats as `query()`.
   *
   * @param {string} collection
   * @param {object} [criteria]
   * @returns {Promise<number>}
   */
  async count(collection, criteria = {}) {
    requireOpen(this._db)
    const { store, tx } = getStore(this._db, collection, 'readonly')
    return new Promise((resolve, reject) => {
      let request

      const entries = Object.entries(criteria)
      if (entries.length > 0) {
        const [indexName, criteriaValue] = entries[0]
        // Empty {} object has no range operators — return zero
        if (!hasRangeOperators(criteriaValue)) {
          resolve(0)
          return
        }
        let index
        try {
          index = store.index(indexName)
        } catch (rawError) {
          reject(mapError(rawError, `count[${collection}] index=${indexName}`))
          return
        }
        request = index.count(buildKeyRange(criteriaValue))
      } else {
        request = store.count()
      }

      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(mapError(request.error, `count[${collection}]`))
    })
  }

  /**
   * Bulk write multiple records atomically.
   *
   * @param {string} collection
   * @param {object[]} records
   * @returns {Promise<void>}
   */
  async bulkWrite(collection, records) {
    requireOpen(this._db)
    const { store, tx } = getStore(this._db, collection, 'readwrite')
    for (const record of records) {
      store.put(record)
    }
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(mapError(tx.error, `bulkWrite[${collection}]`))
    })
  }

  /**
   * Bulk delete multiple records atomically.
   *
   * @param {string} collection
   * @param {(string | number)[]} keys
   * @returns {Promise<void>}
   */
  async bulkDelete(collection, keys) {
    requireOpen(this._db)
    const { store, tx } = getStore(this._db, collection, 'readwrite')
    for (const key of keys) {
      store.delete(key)
    }
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(mapError(tx.error, `bulkDelete[${collection}]`))
    })
  }

  /**
   * Run multiple raw operations atomically within a single transaction.
   * Operations can target one or more collections.
   *
   * @param {object[]} operations
   * @returns {Promise<void>}
   */
  async transaction(operations) {
    requireOpen(this._db)
    const storeNames = [...new Set(operations.map(op => op.collection))]
    return new Promise((resolve, reject) => {
      let tx
      try {
        tx = this._db.transaction(storeNames, 'readwrite')
      } catch (rawError) {
        reject(mapError(rawError, 'transaction'))
        return
      }

      for (const op of operations) {
        let store
        try {
          store = tx.objectStore(op.collection)
        } catch (rawError) {
          reject(mapError(rawError, `transaction[${op.collection}]`))
          return
        }
        switch (op.method) {
          case 'put':
            store.put(op.record)
            break
          case 'delete':
            store.delete(op.key)
            break
          default:
            reject(buildError(ERROR_CODES.TRANSACTION_FAILED, `Unknown operation: ${op.method}`))
            return
        }
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(mapError(tx.error, 'transaction'))
    })
  }
}

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
 * @param {Array<{name: string, keyPath: string, autoIncrement: boolean, indexes?: Array<{name: string, field: string, unique: boolean}>}>} storesConfig
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
 *
 * @param {IDBDatabase} db
 * @param {string} storeName
 * @param {string} mode — 'readonly' | 'readwrite'
 * @returns {IDBObjectStore}
 */
function getStore(db, storeName, mode) {
  const tx = db.transaction(storeName, mode)
  const store = tx.objectStore(storeName)
  return { store, tx }
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
export default class StorageAdapter {
  constructor() {
    /** @type {IDBDatabase | null} */
    this._db = null
    /** @type {boolean} */
    this._isOpen = false
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

    const dbName = config.databaseName || DEFAULT_DB_NAME
    const schemaVersion = config.schemaVersion || DEFAULT_SCHEMA_VERSION
    const storesConfig = config.stores || []

    this._db = await openDatabase(dbName, schemaVersion, storesConfig)
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
    this._db?.close()
    await new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase(DEFAULT_DB_NAME)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(mapError(req.error, 'IDB.deleteDatabase'))
    })
    this._isOpen = false
    this._db = null
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
    const { store, tx } = getStore(this._db, collection, 'readonly')
    return new Promise((resolve, reject) => {
      const request = store.get(key)
      request.onsuccess = () => {
        resolve(request.result ?? null)
        tx.complete
      }
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
    const { store, tx } = getStore(this._db, collection, 'readwrite')
    return new Promise((resolve, reject) => {
      const request = store.put(record)
      request.onsuccess = () => { resolve() }
      request.onerror = () => reject(mapError(request.error, `write[${collection}]`))
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
    const { store, tx } = getStore(this._db, collection, 'readwrite')
    return new Promise((resolve, reject) => {
      const request = store.delete(key)
      request.onsuccess = () => { resolve() }
      request.onerror = () => reject(mapError(request.error, `delete[${collection}]`))
    })
  }

  /**
   * Query records with a raw index/range criteria.
   * Criteria is a plain object { indexName: rangeValue } or {} for full scan.
   *
   * @param {string} collection
   * @param {object} criteria
   * @returns {Promise<object[]>}
   */
  async query(collection, criteria = {}) {
    const { store, tx } = getStore(this._db, collection, 'readonly')
    return new Promise((resolve, reject) => {
      const results = []
      let cursor

      if (Object.keys(criteria).length > 0) {
        const [indexName, rangeValue] = Object.entries(criteria)[0]
        const index = store.index(indexName)
        cursor = index.openCursor(IDBKeyRange.only(rangeValue))
      } else {
        cursor = store.openCursor()
      }

      cursor.onsuccess = () => {
        const item = cursor?.result
        if (!item) {
          resolve(results)
          tx.complete
          return
        }
        results.push(item.value)
        item.continue()
      }
      cursor.onerror = () => reject(mapError(cursor.error, `query[${collection}]`))
    })
  }

  /**
   * Count records, optionally filtered.
   *
   * @param {string} collection
   * @param {object} [criteria]
   * @returns {Promise<number>}
   */
  async count(collection, criteria = {}) {
    const { store, tx } = getStore(this._db, collection, 'readonly')
    return new Promise((resolve, reject) => {
      let request

      if (Object.keys(criteria).length > 0) {
        const [indexName, rangeValue] = Object.entries(criteria)[0]
        request = store.index(indexName).count(IDBKeyRange.only(rangeValue))
      } else {
        request = store.count()
      }

      request.onsuccess = () => {
        resolve(request.result)
        tx.complete
      }
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
    const { store, tx } = getStore(this._db, collection, 'readwrite')
    return new Promise((resolve, reject) => {
      for (const record of records) {
        store.put(record)
      }
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
    const { store, tx } = getStore(this._db, collection, 'readwrite')
    return new Promise((resolve, reject) => {
      for (const key of keys) {
        store.delete(key)
      }
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
    // Collect unique store names from all operations
    const storeNames = [...new Set(operations.map(op => op.collection))]
    const tx = this._db.transaction(storeNames, 'readwrite')
    return new Promise((resolve, reject) => {
      for (const op of operations) {
        const store = tx.objectStore(op.collection)
        switch (op.method) {
          case 'put':
            store.put(op.record)
            break
          case 'delete':
            store.delete(op.key)
            break
          default:
            reject(buildError('TRANSACTION_FAILED', `Unknown operation: ${op.method}`))
            return
        }
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(mapError(tx.error, 'transaction'))
    })
  }
}

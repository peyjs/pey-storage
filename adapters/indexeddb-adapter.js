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
 * Create every configured index that does not exist on the store yet.
 * Idempotent — safe to run on every upgrade; already-present indexes
 * (from an earlier version or a fresh object store creation) are skipped.
 *
 * @param {IDBObjectStore} store — newly created or existing (upgrade tx) store
 * @param {Array} [indexes] — configured indexes for the store
 */
function ensureIndexes(store, indexes) {
  if (!indexes) return
  const existing = new Set(Array.from(store.indexNames))
  for (const idx of indexes) {
    if (existing.has(idx.name)) continue
    store.createIndex(idx.name, idx.field, {
      unique: idx.unique ?? false,
    })
  }
}

/**
 * Validate the stores configuration before any upgrade work starts.
 * Detects duplicate or inconsistent store/index definitions that would
 * otherwise be silently partially applied (or skipped) during the upgrade.
 *
 * @param {Array} storesConfig
 * @throws {object} Standard Bonyan error SCHEMA_UPGRADE_FAILED on invalid config
 */
function validateStoresConfig(storesConfig) {
  if (!Array.isArray(storesConfig)) {
    throw buildError(
      ERROR_CODES.SCHEMA_UPGRADE_FAILED,
      'Stores configuration must be an array',
      { context: 'IDB.config' }
    )
  }
  const storeNames = new Set()
  for (const storeDef of storesConfig) {
    if (!storeDef || typeof storeDef.name !== 'string' || storeDef.name === '') {
      throw buildError(
        ERROR_CODES.SCHEMA_UPGRADE_FAILED,
        'Every store definition requires a non-empty name',
        { context: 'IDB.config' }
      )
    }
    if (storeNames.has(storeDef.name)) {
      throw buildError(
        ERROR_CODES.SCHEMA_UPGRADE_FAILED,
        'Duplicate store name in schema configuration',
        { context: `IDB.config[${storeDef.name}]` }
      )
    }
    storeNames.add(storeDef.name)

    const indexNames = new Set()
    for (const idx of storeDef.indexes || []) {
      if (!idx || typeof idx.name !== 'string' || idx.name === '' || typeof idx.field !== 'string' || idx.field === '') {
        throw buildError(
          ERROR_CODES.SCHEMA_UPGRADE_FAILED,
          'Every index definition requires a non-empty name and field',
          { context: `IDB.config[${storeDef.name}]` }
        )
      }
      if (indexNames.has(idx.name)) {
        throw buildError(
          ERROR_CODES.SCHEMA_UPGRADE_FAILED,
          'Duplicate index name in schema configuration',
          { context: `IDB.config[${storeDef.name}] index=${idx.name}` }
        )
      }
      indexNames.add(idx.name)
    }
  }
}

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
    validateStoresConfig(storesConfig)

    let request
    try {
      request = indexedDB.open(dbName, schemaVersion)
    } catch (rawError) {
      reject(mapError(rawError, 'IDB.open'))
      return
    }

    request.onerror = () => {
      reject(mapError(request.error, 'IDB.open'))
    }

    request.onsuccess = () => {
      resolve(request.result)
    }

    request.onupgradeneeded = (event) => {
      const db = event.target.result
      const storeNames = new Set(db.objectStoreNames)
      const upgradeTx = event.target.transaction
      let currentStoreName = null
      let failed = false

      // Report an upgrade failure exactly once — abort the versionchange
      // transaction so partial store/index state is rolled back, close the
      // intermediate connection, and record the underlying cause in detail
      // (mapped via mapError, no record values) for debuggability
      const failUpgrade = (rawError) => {
        if (failed) return
        failed = true
        abortSafely(upgradeTx)
        try {
          db.close()
        } catch {
          // Ignore close failures on the intermediate connection
        }
        const detail = { context: 'IDB.upgrade' }
        if (currentStoreName) detail.store = currentStoreName
        if (rawError) {
          // Nested cause carries code/type only — no raw error text or
          // record data may leak through the nested structure
          const cause = mapError(rawError, 'IDB.upgrade')
          detail.cause = { code: cause.code, type: cause.type }
        }
        reject(buildError(ERROR_CODES.SCHEMA_UPGRADE_FAILED, 'Database schema upgrade failed', detail))
      }
      upgradeTx.onerror = (event2) => failUpgrade(event2.target.error)
      upgradeTx.onabort = () => failUpgrade(upgradeTx.error)

      try {
        for (const storeDef of storesConfig) {
          currentStoreName = storeDef.name
          // Existing stores come from the versionchange upgrade transaction so
          // indexes added in config are applied to them too, not only new stores
          const store = storeNames.has(storeDef.name)
            ? upgradeTx.objectStore(storeDef.name)
            : db.createObjectStore(storeDef.name, {
                keyPath: storeDef.keyPath,
                autoIncrement: storeDef.autoIncrement ?? false,
              })
          ensureIndexes(store, storeDef.indexes)
        }
      } catch (rawError) {
        failUpgrade(rawError)
      }
    }
  })
}

/**
 * Abort a transaction without letting the abort call itself throw and mask
 * the error being reported (aborting a transaction that already failed or
 * was committed/aborted throws from the host).
 *
 * @param {IDBTransaction} tx
 */
function abortSafely(tx) {
  try {
    tx.abort()
  } catch {
    // Transaction may already be failing/aborting — the primary error wins
  }
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

/**
 * Check whether a record field value matches a criteria value.
 * Mirrors the in-memory adapter's matching: exact match for plain values and
 * inclusive/exclusive range semantics for { gte, lte, gt, lt } objects.
 * An empty {} object (no range operators) matches nothing.
 *
 * @param {any} value — record field value under comparison
 * @param {object | string | number} criteriaValue
 * @returns {boolean}
 */
function fieldMatches(value, criteriaValue) {
  if (criteriaValue && typeof criteriaValue === 'object' && !Array.isArray(criteriaValue)) {
    const { gte, lte, gt, lt } = criteriaValue
    if (gte === undefined && lte === undefined && gt === undefined && lt === undefined) return false
    if (value === undefined || value === null) return false
    if (gte !== undefined && value < gte) return false
    if (lte !== undefined && value > lte) return false
    if (gt !== undefined && value <= gt) return false
    if (lt !== undefined && value >= lt) return false
    return true
  }
  return value === criteriaValue
}

/**
 * Full-store scan fallback for when a criteria key has no usable index.
 * Opens a cursor over every record and filters in JavaScript, mirroring
 * the in-memory adapter's field-based matching so both adapters return
 * identical results for non-index criteria keys.
 *
 * @param {IDBObjectStore} store
 * @param {string} field — record field the criteria applies to
 * @param {object | string | number} criteriaValue
 * @param {object} [options] — { countOnly: true } returns a number instead of records
 * @returns {Promise<object[] | number>}
 */
function scanByField(store, field, criteriaValue, { countOnly = false } = {}) {
  return new Promise((resolve, reject) => {
    const records = []
    let matchedCount = 0
    const cursorRequest = store.openCursor()

    cursorRequest.onsuccess = () => {
      const item = cursorRequest.result
      if (!item) {
        resolve(countOnly ? matchedCount : records)
        return
      }
      const record = item.value
      if (fieldMatches(record[field], criteriaValue)) {
        matchedCount++
        if (!countOnly) records.push(record)
      }
      item.continue()
    }
    cursorRequest.onerror = () => reject(mapError(cursorRequest.error, `scanByField[${store.name}]`))
  })
}

/**
 * Build an index name → field name map per store from config.
 * Mirrors the in-memory adapter so a criteria key that names a configured
 * index can be resolved to its record field for the scan fallback.
 *
 * @param {Array} storesConfig
 * @returns {Map<string, Map<string, string>>}
 */
function buildIndexFieldMap(storesConfig) {
  const indexFieldMap = new Map()
  for (const storeDef of storesConfig) {
    const fieldMap = new Map()
    for (const idx of storeDef.indexes || []) {
      fieldMap.set(idx.name, idx.field)
    }
    indexFieldMap.set(storeDef.name, fieldMap)
  }
  return indexFieldMap
}

/**
 * Resolve a criteria key to the record field it filters on, mirroring the
 * in-memory adapter: a configured index name resolves to its field; any
 * other key is used as the field name directly.
 *
 * @param {Map<string, Map<string, string>>} indexFieldMap
 * @param {string} collection
 * @param {string} criteriaKey
 * @returns {string}
 */
function resolveField(indexFieldMap, collection, criteriaKey) {
  const fieldMap = indexFieldMap.get(collection)
  return fieldMap ? (fieldMap.get(criteriaKey) ?? criteriaKey) : criteriaKey
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
    /** @type {Map<string, Map<string, string>>} index name → field name per store */
    this._indexFieldMap = new Map()
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
    this._indexFieldMap = buildIndexFieldMap(storesConfig)

    // Request persistent storage (non-blocking — failure is acceptable)
    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
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
      let request
      try {
        request = store.get(key)
      } catch {
        // Invalid key (e.g. null) cannot be looked up — resolve null, matching
        // the in-memory adapter's get(null) → null behavior
        resolve(null)
        return
      }
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
    return new Promise((resolve, reject) => {
      try {
        store.put(record)
      } catch (rawError) {
        abortSafely(tx)
        reject(mapError(rawError, `write[${collection}]`))
        return
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(mapError(tx.error, `write[${collection}]`))
      tx.onabort = () => reject(mapError(tx.error, `write[${collection}]`))
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
    return new Promise((resolve, reject) => {
      try {
        store.delete(key)
      } catch (rawError) {
        abortSafely(tx)
        reject(mapError(rawError, `delete[${collection}]`))
        return
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(mapError(tx.error, `delete[${collection}]`))
      tx.onabort = () => reject(mapError(tx.error, `delete[${collection}]`))
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
    const { store } = getStore(this._db, collection, 'readonly')
    const entries = Object.entries(criteria)

    // Empty {} object has no range operators — return empty results in sync
    // with the in-memory adapter
    if (entries.length > 0 && !hasRangeOperators(entries[0][1])) {
      return []
    }

    const [criteriaKey, criteriaValue] = entries[0] ?? [null, null]

    if (entries.length === 0 || Array.from(store.indexNames).includes(criteriaKey)) {
      // Index fast path: a real index exists for this key (full-store cursor
      // when no criteria is provided)
      return new Promise((resolve, reject) => {
        const results = []
        let cursor
        try {
          cursor = entries.length === 0
            ? store.openCursor()
            : store.index(criteriaKey).openCursor(buildKeyRange(criteriaValue))
        } catch (rawError) {
          reject(mapError(rawError, `query[${collection}] index=${criteriaKey}`))
          return
        }
        cursor.onsuccess = () => {
          const item = cursor.result
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

    // Fallback: no index for this criteria key — scan the whole store and
    // filter the record field in JS (mirrors the in-memory adapter semantics)
    const field = resolveField(this._indexFieldMap, collection, criteriaKey)
    return scanByField(store, field, criteriaValue)
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
    const { store } = getStore(this._db, collection, 'readonly')
    const entries = Object.entries(criteria)

    // Empty {} object has no range operators — return zero
    if (entries.length > 0 && !hasRangeOperators(entries[0][1])) {
      return 0
    }

    const [criteriaKey, criteriaValue] = entries[0] ?? [null, null]

    if (entries.length === 0 || Array.from(store.indexNames).includes(criteriaKey)) {
      // Index fast path: a real index exists for this key (full-store count
      // when no criteria is provided)
      return new Promise((resolve, reject) => {
        let request
        try {
          request = entries.length === 0
            ? store.count()
            : store.index(criteriaKey).count(buildKeyRange(criteriaValue))
        } catch (rawError) {
          reject(mapError(rawError, `count[${collection}] index=${criteriaKey}`))
          return
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(mapError(request.error, `count[${collection}]`))
      })
    }

    // Fallback: no index for this criteria key — scan and count matches in JS
    const field = resolveField(this._indexFieldMap, collection, criteriaKey)
    return scanByField(store, field, criteriaValue, { countOnly: true })
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
    return new Promise((resolve, reject) => {
      try {
        for (const record of records) {
          store.put(record)
        }
      } catch (rawError) {
        abortSafely(tx)
        reject(mapError(rawError, `bulkWrite[${collection}]`))
        return
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(mapError(tx.error, `bulkWrite[${collection}]`))
      tx.onabort = () => reject(mapError(tx.error, `bulkWrite[${collection}]`))
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
    return new Promise((resolve, reject) => {
      try {
        for (const key of keys) {
          store.delete(key)
        }
      } catch (rawError) {
        abortSafely(tx)
        reject(mapError(rawError, `bulkDelete[${collection}]`))
        return
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(mapError(tx.error, `bulkDelete[${collection}]`))
      tx.onabort = () => reject(mapError(tx.error, `bulkDelete[${collection}]`))
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

      // Explicit settle guard — an explicit rejection during the operation
      // loop must win regardless of event-handler timing (tx.onabort /
      // tx.onerror may fire later for the same failure)
      let settled = false
      const resolveOnce = () => {
        if (settled) return
        settled = true
        resolve()
      }
      const rejectOnce = (structuredError) => {
        if (settled) return
        settled = true
        reject(structuredError)
      }

      try {
        for (const op of operations) {
          let store
          try {
            store = tx.objectStore(op.collection)
          } catch (rawError) {
            abortSafely(tx)
            rejectOnce(mapError(rawError, `transaction[${op.collection}]`))
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
              // Abort the transaction so already-issued writes are rolled
              // back, matching the in-memory adapter's staged rollback
              abortSafely(tx)
              rejectOnce(buildError(ERROR_CODES.TRANSACTION_FAILED, `Unknown operation: ${op.method}`))
              return
          }
        }
      } catch (rawError) {
        abortSafely(tx)
        rejectOnce(mapError(rawError, 'transaction'))
        return
      }

      tx.oncomplete = resolveOnce
      tx.onerror = () => rejectOnce(mapError(tx.error, 'transaction'))
      tx.onabort = () => rejectOnce(mapError(tx.error, 'transaction'))
    })
  }
}

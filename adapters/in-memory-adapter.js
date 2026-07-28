// In-memory storage adapter for testing
// Implements the exact same interface as IndexedDBAdapter
// so plugin and product logic can be tested without IndexedDB.

import { ERROR_CODES } from '../lib/constants.js'
import { buildError } from '../lib/error.js'

/**
 * A simple key-value store backed by a Map.
 * Supports a single collection with auto-increment by default.
 */
class InMemoryStore {
  constructor({ keyPath, autoIncrement = true }) {
    this.keyPath = keyPath
    this.autoIncrement = autoIncrement
    /** @type {Map<string | number, object>} */
    this._data = new Map()
    /** @type {number} */
    this._nextId = 1
  }

  _getKey(record) {
    return record[this.keyPath]
  }

  _generateKey() {
    return this.autoIncrement ? this._nextId++ : undefined
  }

  get(key) {
    return this._data.get(key) ?? null
  }

  put(record) {
    const key = this._getKey(record) ?? this._generateKey()
    this._data.set(key, { ...record, [this.keyPath]: key })
  }

  delete(key) {
    this._data.delete(key)
  }

  getAll() {
    return [...this._data.values()]
  }

  count() {
    return this._data.size
  }

  deleteAll() {
    this._data.clear()
  }

  /**
   * Create a deep snapshot of the current data.
   * Used for transaction rollback on failure.
   *
   * @returns {{ data: Map<string | number, object>, nextId: number }}
   */
  snapshot() {
    return { data: new Map(this._data), nextId: this._nextId }
  }

  /**
   * Restore data and _nextId from a snapshot.
   *
   * @param {{ data: Map<string | number, object>, nextId: number }} snap
   */
  restore(snap) {
    this._data = snap.data
    this._nextId = snap.nextId
  }
}

// ---------------------------------------------------------------------------
// Adapter class
// ---------------------------------------------------------------------------

/**
 * In-memory substitute for IndexedDBAdapter.
 * Uses the same public method names and return types.
 *
 * Transaction implements rollback-on-failure semantics
 * matching IndexedDB transaction behavior.
 */
export default class InMemoryStorageAdapter {
  constructor() {
    /** @type {Map<string, InMemoryStore>} */
    this._stores = new Map()
    /** @type {boolean} */
    this._isOpen = false
    /** @type {Map<string, Map<string, string>>} */
    this._indexFieldMap = new Map()
  }

  /**
   * Check whether a value matches a criteria value.
   * Supports exact match (plain value) and range queries
   * ({ gte, lte, gt, lt }).
   *
   * @param {any} value
   * @param {object | string | number} criteriaValue
   * @returns {boolean}
   */
  _matchesRange(value, criteriaValue) {
    // Undefined / missing field never matches a range filter
    if (criteriaValue && typeof criteriaValue === 'object' && !Array.isArray(criteriaValue)) {
      const { gte, lte, gt, lt } = criteriaValue
      // Empty object has no range operators — reject (both adapters treat this as "no match")
      if (gte === undefined && lte === undefined && gt === undefined && lt === undefined) return false
      if (value === undefined || value === null) return false
      if (criteriaValue.gte !== undefined && value < criteriaValue.gte) return false
      if (criteriaValue.lte !== undefined && value > criteriaValue.lte) return false
      if (criteriaValue.gt !== undefined && value <= criteriaValue.gt) return false
      if (criteriaValue.lt !== undefined && value >= criteriaValue.lt) return false
      return true
    }
    return value === criteriaValue
  }

  /**
   * @param {object} config
   * @param {Array}  [config.stores]
   * @returns {Promise<void>}
   */
  async open(config = {}) {
    if (this._isOpen) return
    const storesConfig = config.stores || []
    for (const storeDef of storesConfig) {
      this._stores.set(storeDef.name, new InMemoryStore(storeDef))
      // Build index name -> field name map (mirrors IndexedDB behavior)
      const fieldMap = new Map()
      if (storeDef.indexes) {
        for (const idx of storeDef.indexes) {
          fieldMap.set(idx.name, idx.field)
        }
      }
      this._indexFieldMap.set(storeDef.name, fieldMap)
    }
    this._isOpen = true
  }

  async close() {
    this._isOpen = false
    this._stores.clear()
  }

  async destroy() {
    this._stores.clear()
    this._isOpen = false
  }

  // --- Core primitives ---

  async read(collection, key) {
    this._requireOpen()
    const store = this._getStore(collection)
    return store.get(key)
  }

  async write(collection, record) {
    this._requireOpen()
    const store = this._getStore(collection)
    store.put(record)
  }

  async delete(collection, key) {
    this._requireOpen()
    const store = this._getStore(collection)
    store.delete(key)
  }

  async query(collection, criteria = {}) {
    this._requireOpen()
    const store = this._getStore(collection)
    const all = store.getAll()
    if (Object.keys(criteria).length === 0) return all
    const [indexOrField, criteriaValue] = Object.entries(criteria)[0]
    // Resolve index name to actual field name (IndexedDB does this internally)
    const fieldMap = this._indexFieldMap.get(collection)
    const field = fieldMap ? (fieldMap.get(indexOrField) ?? indexOrField) : indexOrField
    return all.filter(r => this._matchesRange(r[field], criteriaValue))
  }

  async count(collection, criteria = {}) {
    this._requireOpen()
    const store = this._getStore(collection)
    const all = store.getAll()
    if (Object.keys(criteria).length === 0) return store.count()
    const [indexOrField, criteriaValue] = Object.entries(criteria)[0]
    const fieldMap = this._indexFieldMap.get(collection)
    const field = fieldMap ? (fieldMap.get(indexOrField) ?? indexOrField) : indexOrField
    return all.filter(r => this._matchesRange(r[field], criteriaValue)).length
  }

  async bulkWrite(collection, records) {
    this._requireOpen()
    const store = this._getStore(collection)
    for (const record of records) {
      store.put(record)
    }
  }

  async bulkDelete(collection, keys) {
    this._requireOpen()
    const store = this._getStore(collection)
    for (const key of keys) {
      store.delete(key)
    }
  }

  /**
   * Execute operations atomically with rollback-on-failure semantics.
   * All changes are staged on a snapshot and committed only on success.
   *
   * @param {object[]} operations
   * @returns {Promise<void>}
   */
  async transaction(operations) {
    this._requireOpen()

    // Take snapshots of every affected store
    const storeNames = [...new Set(operations.map(op => op.collection))]
    const snapshots = new Map()
    for (const name of storeNames) {
      const store = this._getStore(name)
      snapshots.set(name, store.snapshot())
    }

    // Apply operations to a copy of each store
    const tempStores = new Map()
    for (const name of storeNames) {
      const sourceStore = this._getStore(name)
      const tempStore = new InMemoryStore({
        keyPath: sourceStore.keyPath,
        autoIncrement: sourceStore.autoIncrement,
      })
      tempStore.restore(sourceStore.snapshot())
      tempStores.set(name, tempStore)
    }

    let errorCaught = null

    for (const op of operations) {
      const store = tempStores.get(op.collection)
      try {
        switch (op.method) {
          case 'put':
            store.put(op.record)
            break
          case 'delete':
            store.delete(op.key)
            break
          default:
            errorCaught = buildError(ERROR_CODES.TRANSACTION_FAILED, `Unknown operation: ${op.method}`)
        }
      } catch (rawError) {
        errorCaught = rawError
      }
    }

    if (errorCaught) {
      // Rollback: discard temp stores, originals are untouched
      throw errorCaught
    }

    // Commit: replace originals with committed state
    for (const name of storeNames) {
      this._getStore(name).restore(tempStores.get(name).snapshot())
    }
  }

  // --- Internal ---

  _requireOpen() {
    if (!this._isOpen) {
      throw buildError(ERROR_CODES.ADAPTER_NOT_OPEN, 'Database is not open')
    }
  }

  _getStore(name) {
    const store = this._stores.get(name)
    if (!store) {
      throw buildError(ERROR_CODES.STORE_NOT_FOUND, `Store "${name}" does not exist`)
    }
    return store
  }
}

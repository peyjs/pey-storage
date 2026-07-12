// In-memory storage adapter for testing
// Implements the exact same interface as StorageAdapter
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
}

// ---------------------------------------------------------------------------
// Adapter class
// ---------------------------------------------------------------------------

/**
 * In-memory substitute for StorageAdapter.
 * Uses the same public method names and return types.
 */
export default class InMemoryStorageAdapter {
  constructor() {
    /** @type {Map<string, InMemoryStore>} */
    this._stores = new Map()
    this._isOpen = false
  }

  async open(config = {}) {
    if (this._isOpen) return
    const storesConfig = config.stores || []
    for (const storeDef of storesConfig) {
      this._stores.set(storeDef.name, new InMemoryStore(storeDef))
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
    const store = this._getStore(collection)
    return store.get(key)
  }

  async write(collection, record) {
    const store = this._getStore(collection)
    store.put(record)
  }

  async delete(collection, key) {
    const store = this._getStore(collection)
    store.delete(key)
  }

  async query(collection, criteria = {}) {
    const store = this._getStore(collection)
    const all = store.getAll()
    if (Object.keys(criteria).length === 0) return all
    const [indexName, rangeValue] = Object.entries(criteria)[0]
    return all.filter(r => r[indexName] === rangeValue)
  }

  async count(collection, criteria = {}) {
    const store = this._getStore(collection)
    const all = store.getAll()
    if (Object.keys(criteria).length === 0) return store.count()
    const [indexName, rangeValue] = Object.entries(criteria)[0]
    return all.filter(r => r[indexName] === rangeValue).length
  }

  async bulkWrite(collection, records) {
    const store = this._getStore(collection)
    for (const record of records) {
      store.put(record)
    }
  }

  async bulkDelete(collection, keys) {
    const store = this._getStore(collection)
    for (const key of keys) {
      store.delete(key)
    }
  }

  async transaction(operations) {
    for (const op of operations) {
      const store = this._getStore(op.collection)
      switch (op.method) {
        case 'put':
          store.put(op.record)
          break
        case 'delete':
          store.delete(op.key)
          break
        default:
          throw buildError(ERROR_CODES.TRANSACTION_FAILED, `Unknown operation: ${op.method}`)
      }
    }
  }

  // --- Internal ---

  _getStore(name) {
    const store = this._stores.get(name)
    if (!store) {
      throw buildError(ERROR_CODES.STORE_NOT_FOUND, `Store "${name}" does not exist`)
    }
    return store
  }
}

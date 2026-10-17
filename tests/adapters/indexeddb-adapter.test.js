// IndexedDB adapter tests — schema-upgrade path (indexes on existing stores)
// Uses fake-indexeddb (in-memory implementation) so the upgrade flow
// (version bump → onupgradeneeded → index creation) can run without a browser.

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import IndexedDBStorageAdapter from '../../adapters/indexeddb-adapter.js'
import { ERROR_SOURCE } from '../../lib/constants.js'

const DB_NAME = 'test-upgrade-db'

const V1_STORES_CONFIG = [
  {
    name: 'users',
    keyPath: 'id',
    autoIncrement: false,
    indexes: [],
  },
]

const V2_STORES_CONFIG = [
  {
    name: 'users',
    keyPath: 'id',
    autoIncrement: false,
    indexes: [{ name: 'ageIdx', field: 'age', unique: false }],
  },
]

const V3_STORES_CONFIG = [
  {
    name: 'users',
    keyPath: 'id',
    autoIncrement: false,
    indexes: [
      { name: 'ageIdx', field: 'age', unique: false },
      { name: 'nameIdx', field: 'name', unique: true },
    ],
  },
]

describe('IndexedDBStorageAdapter schema upgrade', () => {
  let adapter

  beforeEach(() => {
    // Fresh in-memory IndexedDB factory per test — no shared mutable state.
    // The adapter reads the indexedDB and IDBKeyRange globals at call time.
    globalThis.indexedDB = new IDBFactory()
    globalThis.IDBKeyRange = IDBKeyRange
    adapter = new IndexedDBStorageAdapter()
  })

  afterEach(async () => {
    try {
      await adapter.close()
    } catch {
      // ignore
    }
  })

  it('should_create_index_on_existing_store_when_schema_version_is_bumped', async () => {
    // Version 1: store exists without any index
    await adapter.open({ databaseName: DB_NAME, schemaVersion: 1, stores: V1_STORES_CONFIG })
    await adapter.write('users', { id: 'u1', name: 'ali', age: 30 })
    await adapter.write('users', { id: 'u2', name: 'sara', age: 41 })

    // Version 2: same existing store, now declares an index
    await adapter.close()
    adapter = new IndexedDBStorageAdapter()
    await adapter.open({ databaseName: DB_NAME, schemaVersion: 2, stores: V2_STORES_CONFIG })

    // Records written before the upgrade must be reachable via the new index
    const matched = await adapter.query('users', { ageIdx: 30 })
    assert.deepEqual(matched, [{ id: 'u1', name: 'ali', age: 30 }])

    const empty = await adapter.query('users', { ageIdx: 99 })
    assert.deepEqual(empty, [])

    const total = await adapter.count('users', { ageIdx: { gte: 0 } })
    assert.equal(total, 2)
  })

  it('should_not_throw_on_idempotent_reopen_with_redeclared_indexes_when_version_is_bumped_again', async () => {
    // Upgrade v1 → v2 (index on existing store), then upgrade again to v3
    // with the old index redeclared — must not throw ConstraintError
    await adapter.open({ databaseName: DB_NAME, schemaVersion: 1, stores: V1_STORES_CONFIG })
    await adapter.close()

    adapter = new IndexedDBStorageAdapter()
    await adapter.open({ databaseName: DB_NAME, schemaVersion: 2, stores: V2_STORES_CONFIG })
    await adapter.close()

    adapter = new IndexedDBStorageAdapter()
    await adapter.open({ databaseName: DB_NAME, schemaVersion: 3, stores: V3_STORES_CONFIG })

    const matched = await adapter.query('users', { ageIdx: 30 })
    assert.equal(matched.length, 0)
    const total = await adapter.count('users', {})
    assert.equal(total, 0)
  })

  it('should_open_same_schema_version_without_upgrade_when_database_already_exists', async () => {
    // Reopening at the same version fires no upgrade — must succeed and
    // keep previously written records intact
    await adapter.open({ databaseName: DB_NAME, schemaVersion: 2, stores: V2_STORES_CONFIG })
    await adapter.write('users', { id: 'u1', name: 'ali', age: 30 })
    await adapter.close()

    adapter = new IndexedDBStorageAdapter()
    await adapter.open({ databaseName: DB_NAME, schemaVersion: 2, stores: V2_STORES_CONFIG })

    const record = await adapter.read('users', 'u1')
    assert.deepEqual(record, { id: 'u1', name: 'ali', age: 30 })
  })

  it('should_reject_query_with_STRUCTURED_error_when_index_is_missing_on_existing_store', async () => {
    // Pre-fix failure mode: querying an index that does not exist on the
    // older DB (version 1 opened without it) still yields a structured
    // standard error, not a crash
    await adapter.open({ databaseName: DB_NAME, schemaVersion: 1, stores: V1_STORES_CONFIG })
    await adapter.write('users', { id: 'u1', name: 'ali', age: 30 })

    await assert.rejects(
      adapter.query('users', { ageIdx: 30 }),
      (err) => {
        assert.equal(err.code, 'UNKNOWN_ERROR')
        assert.equal(err.source, ERROR_SOURCE)
        assert.equal(err.type, 'operational')
        return true
      }
    )
  })
})

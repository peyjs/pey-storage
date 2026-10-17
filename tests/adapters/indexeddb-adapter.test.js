// IndexedDB adapter tests — schema-upgrade path (indexes on existing stores)
// Uses fake-indexeddb (in-memory implementation) so the upgrade flow
// (version bump → onupgradeneeded → index creation) can run without a browser.

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import IndexedDBStorageAdapter from '../../adapters/indexeddb-adapter.js'
import { ERROR_CODES, ERROR_SOURCE } from '../../lib/constants.js'

const DB_NAME = 'test-upgrade-db'

// Two indexes with the same name — makes createIndex throw during upgrade
const DUPLICATE_INDEX_CONFIG = [
  {
    name: 'users',
    keyPath: 'id',
    autoIncrement: false,
    indexes: [
      { name: 'dupIdx', field: 'age', unique: false },
      { name: 'dupIdx', field: 'name', unique: false },
    ],
  },
]

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
    await adapter.write('users', { id: 'u1', name: 'ali', age: 30 })
    await adapter.write('users', { id: 'u2', name: 'sara', age: 41 })
    await adapter.close()

    // nameIdx is declared with unique: true — records must have distinct names
    adapter = new IndexedDBStorageAdapter()
    await adapter.open({ databaseName: DB_NAME, schemaVersion: 3, stores: V3_STORES_CONFIG })

    const byAge = await adapter.query('users', { ageIdx: { gte: 41 } })
    assert.deepEqual(byAge, [{ id: 'u2', name: 'sara', age: 41 }])

    const byName = await adapter.query('users', { nameIdx: 'sara' })
    assert.deepEqual(byName, [{ id: 'u2', name: 'sara', age: 41 }])

    const byAgeCount = await adapter.count('users', { ageIdx: { gte: 41 } })
    assert.equal(byAgeCount, 1)
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

  it('should_fall_back_to_full_scan_when_criteria_key_is_not_a_declared_index', async () => {
    // Criteria keys that are not configured indexes resolve to the record
    // field — matching the in-memory adapter (exact match and ranges)
    await adapter.open({ databaseName: DB_NAME, schemaVersion: 1, stores: V2_STORES_CONFIG })
    await adapter.write('users', { id: 'u1', name: 'ali', age: 30 })
    await adapter.write('users', { id: 'u2', name: 'sara', age: 41 })

    const byName = await adapter.query('users', { name: 'sara' })
    assert.deepEqual(byName, [{ id: 'u2', name: 'sara', age: 41 }])

    const byAgeRange = await adapter.query('users', { age: { gte: 35 } })
    assert.deepEqual(byAgeRange, [{ id: 'u2', name: 'sara', age: 41 }])

    const byAgeRangeCount = await adapter.count('users', { age: { gte: 35 } })
    assert.equal(byAgeRangeCount, 1)
  })

  it('should_map_missing_store_to_STORE_NOT_FOUND_when_read_targets_unknown_collection', async () => {
    // Raw NotFoundError from IndexedDB must surface as the documented
    // STORE_NOT_FOUND standard error, not UNKNOWN_ERROR
    await adapter.open({ databaseName: DB_NAME, schemaVersion: 1, stores: V2_STORES_CONFIG })

    await assert.rejects(
      adapter.read('nonexistent_store', 'u1'),
      (err) => {
        assert.equal(err.code, ERROR_CODES.STORE_NOT_FOUND)
        assert.equal(err.source, ERROR_SOURCE)
        assert.equal(err.type, 'operational')
        return true
      }
    )
  })

  it('should_reject_open_with_STANDARD_error_and_leave_adapter_closed_when_upgrade_fails', async () => {
    // Duplicate index names make createIndex throw inside onupgradeneeded —
    // the failure must abort the upgrade transaction and surface a standard
    // error instead of resolving a half-migrated connection
    const brokenAdapter = new IndexedDBStorageAdapter()
    await assert.rejects(
      brokenAdapter.open({ databaseName: 'bad-upgrade-db', schemaVersion: 1, stores: DUPLICATE_INDEX_CONFIG }),
      (err) => {
        assert.equal(err.code, ERROR_CODES.TRANSACTION_FAILED)
        assert.equal(err.source, ERROR_SOURCE)
        assert.equal(err.type, 'operational')
        return true
      }
    )

    // No open connection remains after the failed upgrade
    await assert.rejects(
      brokenAdapter.read('users', 'u1'),
      (err) => {
        assert.equal(err.code, ERROR_CODES.ADAPTER_NOT_OPEN)
        return true
      }
    )

    // The same factory remains usable for a fresh, valid open
    const recoveryAdapter = new IndexedDBStorageAdapter()
    await recoveryAdapter.open({ databaseName: 'good-upgrade-db', schemaVersion: 1, stores: V2_STORES_CONFIG })
    await recoveryAdapter.close()
  })

  it('should_resolve_null_when_read_is_called_with_an_invalid_null_key', async () => {
    // IDB store.get(null) cannot be constructed — must behave like the
    // in-memory adapter and resolve null, not throw
    await adapter.open({ databaseName: DB_NAME, schemaVersion: 1, stores: V2_STORES_CONFIG })
    await adapter.write('users', { id: 'u1', name: 'ali', age: 30 })

    const record = await adapter.read('users', null)
    assert.equal(record, null)
  })
})

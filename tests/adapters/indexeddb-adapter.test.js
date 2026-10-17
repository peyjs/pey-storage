// IndexedDB adapter tests — schema-upgrade path (indexes on existing stores)
// Uses fake-indexeddb (in-memory implementation) so the upgrade flow
// (version bump → onupgradeneeded → index creation) can run without a browser.

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import IndexedDBStorageAdapter from '../../adapters/indexeddb-adapter.js'
import { ERROR_CODES, ERROR_SOURCE } from '../../lib/constants.js'

const DB_NAME = 'test-upgrade-db'

// Duplicate index name within one store — rejected before any upgrade work
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

// Inconsistent index definition — missing field
const MISSING_FIELD_CONFIG = [
  {
    name: 'users',
    keyPath: 'id',
    autoIncrement: false,
    indexes: [{ name: 'blankIdx', field: '', unique: false }],
  },
]

// Valid config, but incompatible with data already in the database:
// unique index over duplicate existing values — a genuinely failing upgrade
const UNIQUE_VIOLATION_CONFIG = [
  {
    name: 'users',
    keyPath: 'id',
    autoIncrement: false,
    indexes: [{ name: 'nameIdx', field: 'name', unique: true }],
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

  it('should_resolve_null_when_read_is_called_with_an_invalid_null_key', async () => {
    // IDB store.get(null) cannot be constructed — must behave like the
    // in-memory adapter and resolve null, not throw
    await adapter.open({ databaseName: DB_NAME, schemaVersion: 1, stores: V2_STORES_CONFIG })
    await adapter.write('users', { id: 'u1', name: 'ali', age: 30 })

    const record = await adapter.read('users', null)
    assert.equal(record, null)
  })

  it('should_reject_open_with_SCHEMA_UPGRADE_FAILED_when_stores_config_has_duplicate_index_names', async () => {
    // Pre-upgrade validation: duplicate/inconsistent schema config must be
    // reported as a standard error before the upgrade mutates the database
    const brokenAdapter = new IndexedDBStorageAdapter()
    await assert.rejects(
      brokenAdapter.open({ databaseName: 'validated-db', schemaVersion: 1, stores: DUPLICATE_INDEX_CONFIG }),
      (err) => {
        assert.equal(err.code, ERROR_CODES.SCHEMA_UPGRADE_FAILED)
        assert.equal(err.source, ERROR_SOURCE)
        assert.equal(err.type, 'operational')
        return true
      }
    )
    await assert.rejects(
      brokenAdapter.read('users', 'u1'),
      (err) => {
        assert.equal(err.code, ERROR_CODES.ADAPTER_NOT_OPEN)
        return true
      }
    )
  })

  it('should_reject_open_with_SCHEMA_UPGRADE_FAILED_when_index_definition_is_inconsistent', async () => {
    const brokenAdapter = new IndexedDBStorageAdapter()
    await assert.rejects(
      brokenAdapter.open({ databaseName: 'validate-field-db', schemaVersion: 1, stores: MISSING_FIELD_CONFIG }),
      (err) => {
        assert.equal(err.code, ERROR_CODES.SCHEMA_UPGRADE_FAILED)
        assert.equal(err.source, ERROR_SOURCE)
        return true
      }
    )
  })

  it('should_reject_open_with_SCHEMA_UPGRADE_FAILED_when_stores_config_is_not_an_array', async () => {
    // A non-array stores config (e.g. an object or a number) must surface as
    // a structured SCHEMA_UPGRADE_FAILED error, not an unstructured TypeError
    const brokenAdapter = new IndexedDBStorageAdapter()
    await assert.rejects(
      brokenAdapter.open({ databaseName: 'non-array-db', schemaVersion: 1, stores: { name: 'users' } }),
      (err) => {
        assert.equal(err.code, ERROR_CODES.SCHEMA_UPGRADE_FAILED)
        assert.equal(err.source, ERROR_SOURCE)
        assert.equal(err.type, 'operational')
        return true
      }
    )
  })

  it('should_reject_open_with_SCHEMA_UPGRADE_FAILED_when_unique_index_conflicts_with_existing_records', async () => {
    // A genuinely failing upgrade: unique index over duplicate values that
    // already exist in the database — the upgrade transaction aborts and a
    // structured SCHEMA_UPGRADE_FAILED error surfaces, nothing leaks open
    await adapter.open({ databaseName: 'unique-fail-db', schemaVersion: 1, stores: V1_STORES_CONFIG })
    await adapter.write('users', { id: 'u1', name: 'ali', age: 30 })
    await adapter.write('users', { id: 'u2', name: 'ali', age: 41 })
    await adapter.close()

    adapter = new IndexedDBStorageAdapter()
    await assert.rejects(
      adapter.open({ databaseName: 'unique-fail-db', schemaVersion: 2, stores: UNIQUE_VIOLATION_CONFIG }),
      (err) => {
        assert.equal(err.code, ERROR_CODES.SCHEMA_UPGRADE_FAILED)
        assert.equal(err.source, ERROR_SOURCE)
        assert.equal(err.type, 'operational')
        assert.equal(err.detail.store, 'users')
        // Nested cause recorded as mapped code/type only — no raw DOMException
        // text may leak through detail.cause
        assert.equal(err.detail.cause.source, undefined)
        assert.equal(err.detail.cause.message, undefined)
        assert.equal(err.detail.cause.type, 'operational')
        assert.ok(err.detail.cause.code)
        return true
      }
    )

    // No open connection remains after the failed upgrade
    await assert.rejects(
      adapter.read('users', 'u1'),
      (err) => {
        assert.equal(err.code, ERROR_CODES.ADAPTER_NOT_OPEN)
        return true
      }
    )

    // The database stays usable (upgrade rolled back to version 1)
    const recoveryAdapter = new IndexedDBStorageAdapter()
    await recoveryAdapter.open({ databaseName: 'unique-fail-db', schemaVersion: 1, stores: V1_STORES_CONFIG })
    const kept = await recoveryAdapter.read('users', 'u1')
    assert.deepEqual(kept, { id: 'u1', name: 'ali', age: 30 })
  })

  it('should_persist_nothing_when_transaction_fails_mid_operation', async () => {
    // A put whose record cannot produce a valid key (null id → DataError)
    // throws while the transaction is in progress — the failure is caught
    // and mapped via mapError (operational, context 'transaction'), already-
    // issued writes are rolled back, and nothing persists
    await adapter.open({ databaseName: DB_NAME, schemaVersion: 1, stores: V2_STORES_CONFIG })
    await adapter.write('users', { id: 'u1', name: 'ali', age: 30 })

    await assert.rejects(
      adapter.transaction([
        { method: 'put', collection: 'users', record: { id: 'u2', name: 'bob', age: 22 } },
        { method: 'put', collection: 'users', record: { id: null, name: 'bad', age: 1 } },
        { method: 'put', collection: 'users', record: { id: 'u3', name: 'carl', age: 33 } },
      ]),
      (err) => {
        assert.equal(err.type, 'operational')
        assert.equal(err.source, ERROR_SOURCE)
        // detail.context proves the error came through the transaction's
        // mapError catch path (tx aborted by this failure), not another layer
        assert.equal(err.detail.context, 'transaction')
        assert.ok(err.code)
        return true
      }
    )

    // Nothing from the failed transaction persisted
    const u2 = await adapter.read('users', 'u2')
    assert.equal(u2, null)
    const u3 = await adapter.read('users', 'u3')
    assert.equal(u3, null)

    // Pre-existing records are untouched
    const u1 = await adapter.read('users', 'u1')
    assert.deepEqual(u1, { id: 'u1', name: 'ali', age: 30 })
  })
})

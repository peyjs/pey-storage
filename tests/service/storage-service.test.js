// Tests for StorageService — plugin-layer orchestration.
// Uses InMemoryStorageAdapter as the test double.

import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import StorageService from '../../lib/storage-service.js'
import InMemoryStorageAdapter from '../../adapters/in-memory-adapter.js'

/** Create a fresh service with in-memory adapter */
function createService(storesConfig = []) {
  const adapter = new InMemoryStorageAdapter()
  const service = new StorageService(adapter, storesConfig)
  return { service, adapter }
}

const STORES = [
  { name: 'users', keyPath: 'id', autoIncrement: false },
  { name: 'tasks', keyPath: 'id', autoIncrement: true },
]

describe('StorageService — CRUD operations', () => {
  it('should_write_and_read_a_record', async () => {
    const { service } = createService(STORES)
    await service.write('users', { id: 'u1', name: 'Alice' })
    const record = await service.read('users', 'u1')
    assert.deepEqual(record, { id: 'u1', name: 'Alice' })
  })

  it('should_return_null_when_reading_a_nonexistent_key', async () => {
    const { service } = createService(STORES)
    const record = await service.read('users', 'missing')
    assert.strictEqual(record, null)
  })

  it('should_delete_a_record_by_key', async () => {
    const { service } = createService(STORES)
    await service.write('users', { id: 'u1', name: 'Alice' })
    await service.delete('users', 'u1')
    const record = await service.read('users', 'u1')
    assert.strictEqual(record, null)
  })

  it('should_query_all_records_with_empty_criteria', async () => {
    const { service } = createService(STORES)
    await service.write('users', { id: 'u1', name: 'Alice' })
    await service.write('users', { id: 'u2', name: 'Bob' })
    const results = await service.query('users', {})
    assert.strictEqual(results.length, 2)
  })

  it('should_return_nonzero_count_after_writes', async () => {
    const { service } = createService(STORES)
    await service.write('users', { id: 'u1', name: 'Alice' })
    await service.write('users', { id: 'u2', name: 'Bob' })
    const count = await service.count('users')
    assert.strictEqual(count, 2)
  })
})

describe('StorageService — bulk operations', () => {
  it('should_bulk_write_multiple_records', async () => {
    const { service } = createService(STORES)
    const records = [
      { id: 'u1', name: 'Alice' },
      { id: 'u2', name: 'Bob' },
      { id: 'u3', name: 'Charlie' },
    ]
    await service.bulkWrite('users', records)
    const count = await service.count('users')
    assert.strictEqual(count, 3)
  })

  it('should_bulk_delete_multiple_records', async () => {
    const { service } = createService(STORES)
    await service.write('users', { id: 'u1', name: 'Alice' })
    await service.write('users', { id: 'u2', name: 'Bob' })
    await service.bulkDelete('users', ['u1', 'u2'])
    const count = await service.count('users')
    assert.strictEqual(count, 0)
  })
})

describe('StorageService — transaction', () => {
  it('should_execute_multiple_operations_atomically', async () => {
    const { service } = createService(STORES)
    await service.write('users', { id: 'u1', name: 'Alice' })

    await service.transaction([
      { collection: 'users', method: 'put', record: { id: 'u2', name: 'Bob' } },
      { collection: 'users', method: 'delete', key: 'u1' },
    ])

    const u1 = await service.read('users', 'u1')
    const u2 = await service.read('users', 'u2')
    assert.strictEqual(u1, null)
    assert.deepEqual(u2, { id: 'u2', name: 'Bob' })
  })

  it('should_validate_collections_before_transaction_execution', async () => {
    const { service } = createService(STORES)
    try {
      await service.transaction([
        { collection: 'nonexistent', method: 'put', record: { id: 1 } },
      ])
      assert.fail('should have thrown')
    } catch (err) {
      assert.strictEqual(err.code, 'STORE_NOT_FOUND')
    }
  })
})

describe('StorageService — store validation', () => {
  it('should_reject_write_for_unknown_collection', async () => {
    const { service } = createService(STORES)
    try {
      await service.write('nonexistent', { id: 1 })
      assert.fail('should have thrown')
    } catch (err) {
      assert.strictEqual(err.code, 'STORE_NOT_FOUND')
    }
  })

  it('should_reject_read_for_unknown_collection', async () => {
    const { service } = createService(STORES)
    try {
      await service.read('nonexistent', 1)
      assert.fail('should have thrown')
    } catch (err) {
      assert.strictEqual(err.code, 'STORE_NOT_FOUND')
    }
  })

  it('should_reject_query_for_unknown_collection', async () => {
    const { service } = createService(STORES)
    try {
      await service.query('nonexistent', {})
      assert.fail('should have thrown')
    } catch (err) {
      assert.strictEqual(err.code, 'STORE_NOT_FOUND')
    }
  })

  it('should_reject_bulk_write_for_unknown_collection', async () => {
    const { service } = createService(STORES)
    try {
      await service.bulkWrite('nonexistent', [{ id: 1 }])
      assert.fail('should have thrown')
    } catch (err) {
      assert.strictEqual(err.code, 'STORE_NOT_FOUND')
    }
  })
})

describe('StorageService — exportData', () => {
  it('should_export_all_stores_with_metadata', async () => {
    const { service } = createService(STORES)
    await service.write('users', { id: 'u1', name: 'Alice' })

    const result = await service.exportData()

    assert.ok(result.metadata)
    assert.strictEqual(result.metadata.format, 'pey-storage-export')
    assert.ok(result.metadata.exportedAt)
    assert.ok(Array.isArray(result.metadata.collections))
    assert.strictEqual(typeof result.data, 'object')
  })

  it('should_export_only_specified_collections', async () => {
    const { service } = createService(STORES)
    await service.write('users', { id: 'u1', name: 'Alice' })
    await service.write('tasks', { id: 1, title: 'Task 1' })

    const result = await service.exportData(['users'])

    assert.ok(!result.data.tasks)
    assert.strictEqual(result.data.users.length, 1)
  })

  it('should_reject_export_for_unknown_collection_in_collections_param', async () => {
    const { service } = createService(STORES)
    try {
      await service.exportData(['nonexistent'])
      assert.fail('should have thrown')
    } catch (err) {
      assert.strictEqual(err.code, 'STORE_NOT_FOUND')
    }
  })
})

describe('StorageService — importData', () => {
  it('should_import_with_merge_mode_when_records_do_not_exist', async () => {
    const { service } = createService(STORES)
    const payload = {
      data: {
        users: [{ id: 'u1', name: 'Alice' }],
      },
    }

    const result = await service.importData(payload, 'merge')

    assert.strictEqual(result.imported, 1)
    assert.strictEqual(result.skipped.length, 0)
    const record = await service.read('users', 'u1')
    assert.deepEqual(record, { id: 'u1', name: 'Alice' })
  })

  it('should_skip_existing_records_in_merge_mode', async () => {
    const { service } = createService(STORES)
    await service.write('users', { id: 'u1', name: 'Alice' })

    const payload = {
      data: {
        users: [{ id: 'u1', name: 'Alice' }],
      },
    }

    const result = await service.importData(payload, 'merge')

    assert.strictEqual(result.imported, 0)
    assert.strictEqual(result.skipped.length, 1)
  })

  it('should_replace_all_records_in_replace_mode', async () => {
    const { service } = createService(STORES)
    await service.write('users', { id: 'u1', name: 'Alice' })

    const payload = {
      data: {
        users: [{ id: 'u1', name: 'Bob' }],
      },
    }

    const result = await service.importData(payload, 'replace')

    assert.strictEqual(result.imported, 1)
    const record = await service.read('users', 'u1')
    assert.deepEqual(record, { id: 'u1', name: 'Bob' })
  })

  it('should_report_errors_for_missing_key_in_merge_mode', async () => {
    const { service } = createService(STORES)
    const payload = {
      data: {
        users: [{ name: 'NoKey' }],
      },
    }

    const result = await service.importData(payload, 'merge')

    assert.strictEqual(result.imported, 0)
    assert.strictEqual(result.errors.length, 1)
    assert.strictEqual(result.errors[0].reason, 'missing-key')
  })

  it('should_reject_invalid_import_payload', async () => {
    const { service } = createService(STORES)
    try {
      await service.importData(null)
      assert.fail('should have thrown')
    } catch (err) {
      assert.strictEqual(err.code, 'IMPORT_INVALID_PAYLOAD')
    }
  })

  it('should_reject_import_payload_without_data_field', async () => {
    const { service } = createService(STORES)
    try {
      await service.importData({ foo: 'bar' })
      assert.fail('should have thrown')
    } catch (err) {
      assert.strictEqual(err.code, 'IMPORT_INVALID_PAYLOAD')
    }
  })

  it('should_reject_import_for_unknown_collection', async () => {
    const { service } = createService(STORES)
    const payload = {
      data: {
        nonexistent: [{ id: 1 }],
      },
    }
    try {
      await service.importData(payload, 'merge')
      assert.fail('should have thrown')
    } catch (err) {
      assert.strictEqual(err.code, 'STORE_NOT_FOUND')
    }
  })
})

describe('StorageService — deactivated service', () => {
  it('should_throw_SERVICE_UNAVAILABLE_after_deactivation', async () => {
    const { service } = createService(STORES)
    service._setDeactivated()

    try {
      await service.read('users', 'u1')
      assert.fail('should have thrown')
    } catch (err) {
      assert.strictEqual(err.code, 'SERVICE_UNAVAILABLE')
    }
  })

  it('should_throw_SERVICE_UNAVAILABLE_for_all_methods_after_deactivation', async () => {
    const { service } = createService(STORES)
    service._setDeactivated()

    const methods = ['read', 'write', 'delete', 'query', 'count', 'bulkWrite', 'bulkDelete', 'transaction', 'exportData', 'importData']
    for (const method of methods) {
      try {
        switch (method) {
          case 'read':
            await service.read('users', 'u1')
            break
          case 'write':
            await service.write('users', { id: 1 })
            break
          case 'delete':
            await service.delete('users', 'u1')
            break
          case 'query':
            await service.query('users', {})
            break
          case 'count':
            await service.count('users')
            break
          case 'bulkWrite':
            await service.bulkWrite('users', [])
            break
          case 'bulkDelete':
            await service.bulkDelete('users', [])
            break
          case 'transaction':
            await service.transaction([])
            break
          case 'exportData':
            await service.exportData()
            break
          case 'importData':
            await service.importData({ data: {} })
            break
        }
        assert.fail(`${method} should have thrown`)
      } catch (err) {
        assert.strictEqual(err.code, 'SERVICE_UNAVAILABLE', `method ${method} did not throw SERVICE_UNAVAILABLE`)
      }
    }
  })
})

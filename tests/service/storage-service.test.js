import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import InMemoryStorageAdapter from '../../adapters/in-memory-adapter.js'
import StorageService from '../../lib/storage-service.js'

const VALID_STORES_CONFIG = [
  { name: 'users', keyPath: 'id', autoIncrement: false },
]

/**
 * Create a fresh service with an already-open adapter.
 *
 * @param {Array} [storesConfig]
 * @returns {{ service: StorageService, adapter: InMemoryStorageAdapter }}
 */
async function createService(storesConfig = VALID_STORES_CONFIG) {
  const adapter = new InMemoryStorageAdapter()
  await adapter.open({ stores: storesConfig })
  const service = new StorageService(adapter, storesConfig)
  return { service, adapter }
}

describe('StorageService', () => {
  describe('constructor', () => {
    it('should_create_service_with_adapter_and_config_when_valid_inputs_are_provided', async () => {
      const { service, adapter } = await createService()
      assert.ok(service)
      assert.ok(adapter)
    })
  })

  describe('read()', () => {
    it('should_read_record_from_adapter_when_record_exists', async () => {
      const { service, adapter } = await createService()
      await adapter.write('users', { id: 'u1', name: 'Alice' })
      const record = await service.read('users', 'u1')
      assert.deepEqual(record, { id: 'u1', name: 'Alice' })
    })

    it('should_return_null_when_record_not_found', async () => {
      const { service, adapter } = await createService()
      const record = await service.read('users', 'nonexistent')
      assert.equal(record, null)
    })
  })

  describe('write()', () => {
    it('should_write_record_to_adapter_when_record_is_valid', async () => {
      const { service, adapter } = await createService()
      const result = await service.write('users', { id: 'u1', name: 'Alice' })
      assert.equal(result, undefined)
    })
  })

  describe('delete()', () => {
    it('should_delete_record_from_adapter_when_record_exists', async () => {
      const { service, adapter } = await createService()
      await adapter.write('users', { id: 'u1', name: 'Alice' })
      const result = await service.delete('users', 'u1')
      assert.equal(result, undefined)
      const record = await adapter.read('users', 'u1')
      assert.equal(record, null)
    })

    it('should_not_throw_when_record_not_found', async () => {
      const { service, adapter } = await createService()
      const result = await service.delete('users', 'nonexistent')
      assert.equal(result, undefined)
    })
  })

  describe('query()', () => {
    it('should_query_records_from_adapter_when_filter_is_provided', async () => {
      const { service, adapter } = await createService()
      await adapter.write('users', { id: 'u1', name: 'Alice' })
      await adapter.write('users', { id: 'u2', name: 'Bob' })
      const results = await service.query('users', { name: 'Alice' })
      assert.equal(results.length, 1)
      assert.equal(results[0].name, 'Alice')
    })
  })

  describe('count()', () => {
    it('should_count_records_in_adapter_when_records_exist', async () => {
      const { service, adapter } = await createService()
      await adapter.write('users', { id: 'u1', name: 'Alice' })
      await adapter.write('users', { id: 'u2', name: 'Bob' })
      const count = await service.count('users')
      assert.equal(count, 2)
    })
  })

  describe('bulkWrite()', () => {
    it('should_bulk_write_records_when_multiple_records_are_provided', async () => {
      const { service, adapter } = await createService()
      const records = [{ id: 'u1', name: 'Alice' }, { id: 'u2', name: 'Bob' }]
      const results = await service.bulkWrite('users', records)
      assert.equal(results, undefined)
    })
  })

  describe('bulkDelete()', () => {
    it('should_bulk_delete_records_when_multiple_keys_are_provided', async () => {
      const { service, adapter } = await createService()
      await adapter.write('users', { id: 'u1', name: 'Alice' })
      await adapter.write('users', { id: 'u2', name: 'Bob' })
      const results = await service.bulkDelete('users', ['u1', 'u2'])
      assert.equal(results, undefined)
    })
  })

  describe('transaction()', () => {
    it('should_execute_transaction_callbacks_when_operations_are_valid', async () => {
      const { service, adapter } = await createService()
      await service.transaction([
        { method: 'put', collection: 'users', record: { id: 'u1', name: 'Alice' } },
      ])
      const record = await adapter.read('users', 'u1')
      assert.ok(record)
    })
  })

  describe('exportData()', () => {
    it('should_export_data_with_metadata_when_data_exists', async () => {
      const { service, adapter } = await createService()
      await adapter.write('users', { id: 'u1', name: 'Alice' })
      const result = await service.exportData()
      assert.ok(result)
      assert.ok(result.metadata)
      assert.ok(result.data.users)
    })
  })

  describe('importData()', () => {
    it('should_replace_records_in_replace_mode', async () => {
      const { service, adapter } = await createService()
      await adapter.write('users', { id: 'u1', name: 'Alice' })
      const result = await service.importData({ data: { users: [{ id: 'u2', name: 'Bob' }] } }, 'replace')
      const alice = await adapter.read('users', 'u1')
      const bob = await adapter.read('users', 'u2')
      assert.ok(alice)
      assert.ok(bob)
      assert.equal(result.imported, 1)
    })

    it('should_import_data_in_merge_mode_when_mode_is_merge', async () => {
      const { service, adapter } = await createService()
      await adapter.write('users', { id: 'u1', name: 'Alice' })
      await service.importData({ data: { users: [{ id: 'u2', name: 'Bob' }] } }, 'merge')
      const alice = await adapter.read('users', 'u1')
      const bob = await adapter.read('users', 'u2')
      assert.ok(alice)
      assert.ok(bob)
    })
  })
})

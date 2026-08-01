import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import InMemoryStorageAdapter from '../../adapters/in-memory-adapter.js'
import StorageService from '../../lib/storage-service.js'
import { ERROR_CODES } from '../../lib/constants.js'

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

    it('should_throw_STORE_NOT_FOUND_when_collection_is_unknown', async () => {
      const { service } = await createService()
      await assert.rejects(
        service.read('nonexistent_store', 'u1'),
        (err) => {
          assert.equal(err.code, ERROR_CODES.STORE_NOT_FOUND)
          return true
        }
      )
    })
  })

  describe('write()', () => {
    it('should_write_record_to_adapter_when_record_is_valid', async () => {
      const { service, adapter } = await createService()
      const result = await service.write('users', { id: 'u1', name: 'Alice' })
      assert.equal(result, undefined)
    })

    it('should_throw_STORE_NOT_FOUND_when_collection_is_unknown', async () => {
      const { service } = await createService()
      await assert.rejects(
        service.write('nonexistent_store', { id: 'u1' }),
        (err) => {
          assert.equal(err.code, ERROR_CODES.STORE_NOT_FOUND)
          return true
        }
      )
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

    it('should_throw_STORE_NOT_FOUND_when_collection_is_unknown', async () => {
      const { service } = await createService()
      await assert.rejects(
        service.delete('nonexistent_store', 'u1'),
        (err) => {
          assert.equal(err.code, ERROR_CODES.STORE_NOT_FOUND)
          return true
        }
      )
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

    it('should_throw_STORE_NOT_FOUND_when_collection_is_unknown', async () => {
      const { service } = await createService()
      await assert.rejects(
        service.query('nonexistent_store', {}),
        (err) => {
          assert.equal(err.code, ERROR_CODES.STORE_NOT_FOUND)
          return true
        }
      )
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

    it('should_throw_STORE_NOT_FOUND_when_collection_is_unknown', async () => {
      const { service } = await createService()
      await assert.rejects(
        service.count('nonexistent_store'),
        (err) => {
          assert.equal(err.code, ERROR_CODES.STORE_NOT_FOUND)
          return true
        }
      )
    })
  })

  describe('bulkWrite()', () => {
    it('should_bulk_write_records_when_multiple_records_are_provided', async () => {
      const { service, adapter } = await createService()
      const records = [{ id: 'u1', name: 'Alice' }, { id: 'u2', name: 'Bob' }]
      const results = await service.bulkWrite('users', records)
      assert.equal(results, undefined)
      const r1 = await adapter.read('users', 'u1')
      const r2 = await adapter.read('users', 'u2')
      assert.deepEqual(r1, { id: 'u1', name: 'Alice' })
      assert.deepEqual(r2, { id: 'u2', name: 'Bob' })
    })

    it('should_throw_STORE_NOT_FOUND_when_collection_is_unknown', async () => {
      const { service } = await createService()
      await assert.rejects(
        service.bulkWrite('nonexistent_store', []),
        (err) => {
          assert.equal(err.code, ERROR_CODES.STORE_NOT_FOUND)
          return true
        }
      )
    })
  })

  describe('bulkDelete()', () => {
    it('should_bulk_delete_records_when_multiple_keys_are_provided', async () => {
      const { service, adapter } = await createService()
      await adapter.write('users', { id: 'u1', name: 'Alice' })
      await adapter.write('users', { id: 'u2', name: 'Bob' })
      const results = await service.bulkDelete('users', ['u1', 'u2'])
      assert.equal(results, undefined)
      const r1 = await adapter.read('users', 'u1')
      const r2 = await adapter.read('users', 'u2')
      assert.equal(r1, null)
      assert.equal(r2, null)
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

    it('should_throw_STORE_NOT_FOUND_when_collection_in_operations_is_unknown', async () => {
      const { service } = await createService()
      await assert.rejects(
        service.transaction([
          { method: 'put', collection: 'nonexistent_store', record: { id: 'u1' } },
        ]),
        (err) => {
          assert.equal(err.code, ERROR_CODES.STORE_NOT_FOUND)
          return true
        }
      )
    })
  })

  describe('importData()', () => {
    it('should_replace_all_records_when_mode_is_replace', async () => {
      const { service, adapter } = await createService()
      await adapter.write('users', { id: 'u1', name: 'Alice' })
      const result = await service.importData({ data: { users: [{ id: 'u2', name: 'Bob' }] } }, 'replace')
      const alice = await adapter.read('users', 'u1')
      const bob = await adapter.read('users', 'u2')
      assert.ok(alice)
      assert.ok(bob)
      assert.equal(result.imported, 1)
    })

    it('should_import_new_records_and_skip_existing_in_merge_mode', async () => {
      const { service, adapter } = await createService()
      await adapter.write('users', { id: 'u1', name: 'Alice' })
      const result = await service.importData({ data: { users: [{ id: 'u1', name: 'Alice Updated' }, { id: 'u2', name: 'Bob' }] } }, 'merge')
      const alice = await adapter.read('users', 'u1')
      const bob = await adapter.read('users', 'u2')
      assert.deepEqual(alice, { id: 'u1', name: 'Alice' })
      assert.ok(bob)
      assert.equal(result.imported, 1)
      assert.equal(result.skipped.length, 1)
      assert.equal(result.skipped[0].key, 'u1')
    })

    it('should_return_skipped_keys_in_merge_mode_when_existing_records_exist', async () => {
      const { service, adapter } = await createService()
      await adapter.write('users', { id: 'u1', name: 'Alice' })
      await adapter.write('users', { id: 'u2', name: 'Bob' })
      const result = await service.importData({ data: { users: [{ id: 'u1', name: 'Alice Updated' }, { id: 'u2', name: 'Bob Updated' }] } }, 'merge')
      assert.equal(result.imported, 0)
      assert.equal(result.skipped.length, 2)
    })

    it('should_reject_empty_payload_when_payload_is_null', async () => {
      const { service } = await createService()
      await assert.rejects(
        service.importData(null),
        (err) => {
          assert.equal(err.code, ERROR_CODES.IMPORT_INVALID_PAYLOAD)
          return true
        }
      )
    })

    it('should_reject_payload_without_data_property_when_data_is_missing', async () => {
      const { service } = await createService()
      await assert.rejects(
        service.importData({ otherField: 'value' }),
        (err) => {
          assert.equal(err.code, ERROR_CODES.IMPORT_INVALID_PAYLOAD)
          return true
        }
      )
    })

    it('should_report_error_when_record_has_missing_key_in_merge_mode', async () => {
      const { service } = await createService()
      const result = await service.importData({ data: { users: [{ name: 'NoKey' }] } }, 'merge')
      assert.equal(result.imported, 0)
      assert.equal(result.errors.length, 1)
      assert.equal(result.errors[0].reason, 'missing-key')
    })

    it('should_throw_STORE_NOT_FOUND_when_collection_in_import_is_unknown', async () => {
      const { service } = await createService()
      await assert.rejects(
        service.importData({ data: { nonexistent_store: [{ id: 'u1' }] } }),
        (err) => {
          assert.equal(err.code, ERROR_CODES.STORE_NOT_FOUND)
          return true
        }
      )
    })
  })

  describe('importData() — restore mode', () => {
    it('should_delete_all_existing_and_insert_all_payload_records_when_mode_is_restore', async () => {
      const { service, adapter } = await createService()
      // Pre-populate: 3 records
      await adapter.write('users', { id: 'u1', name: 'Alice' })
      await adapter.write('users', { id: 'u2', name: 'Bob' })
      await adapter.write('users', { id: 'u3', name: 'Charlie' })

      // Restore with 2 different records
      const result = await service.importData(
        { data: { users: [{ id: 'u10', name: 'Dave' }, { id: 'u11', name: 'Eve' }] } },
        'restore'
      )

      // All old records deleted, only new ones remain
      assert.equal(result.deleted, 3)
      assert.equal(result.imported, 2)
      assert.equal(result.skipped.length, 0)
      assert.equal(result.errors.length, 0)

      const r1 = await adapter.read('users', 'u1')
      const r10 = await adapter.read('users', 'u10')
      const r11 = await adapter.read('users', 'u11')
      assert.equal(r1, null)
      assert.deepEqual(r10, { id: 'u10', name: 'Dave' })
      assert.deepEqual(r11, { id: 'u11', name: 'Eve' })
    })

    it('should_restore_multiple_collections_in_one_transaction', async () => {
      const { service, adapter } = await createService(
        [
          { name: 'users', keyPath: 'id', autoIncrement: false },
          { name: 'posts', keyPath: 'id', autoIncrement: false },
        ]
      )
      // Pre-populate both collections
      await adapter.write('users', { id: 'u1', name: 'Alice' })
      await adapter.write('posts', { id: 'p1', title: 'Hello' })

      // Restore both collections
      const result = await service.importData(
        {
          data: {
            users: [{ id: 'u10', name: 'Bob' }],
            posts: [{ id: 'p10', title: 'World' }],
          },
        },
        'restore'
      )

      assert.equal(result.deleted, 2) // 1 user + 1 post
      assert.equal(result.imported, 2) // 1 user + 1 post
      assert.equal(result.errors.length, 0)

      const u1 = await adapter.read('users', 'u1')
      const u10 = await adapter.read('users', 'u10')
      const p1 = await adapter.read('posts', 'p1')
      const p10 = await adapter.read('posts', 'p10')
      assert.equal(u1, null)
      assert.deepEqual(u10, { id: 'u10', name: 'Bob' })
      assert.equal(p1, null)
      assert.deepEqual(p10, { id: 'p10', title: 'World' })
    })

    it('should_report_errors_for_records_with_missing_key_in_restore_mode_and_continue', async () => {
      const { service, adapter } = await createService()
      await adapter.write('users', { id: 'u1', name: 'Alice' })

      const result = await service.importData(
        {
          data: {
            users: [
              { id: 'u10', name: 'Dave' },
              { name: 'NoKey' },
            ],
          },
        },
        'restore'
      )

      // One delete + one put should have executed
      assert.equal(result.deleted, 1)
      assert.equal(result.imported, 1)
      assert.equal(result.errors.length, 1)
      assert.equal(result.errors[0].reason, 'missing-key')

      // The valid record should be present
      const r10 = await adapter.read('users', 'u10')
      assert.deepEqual(r10, { id: 'u10', name: 'Dave' })
    })

    it('should_only_target_collections_present_in_payload_data_when_restore', async () => {
      const { service, adapter } = await createService(
        [
          { name: 'users', keyPath: 'id', autoIncrement: false },
          { name: 'posts', keyPath: 'id', autoIncrement: false },
        ]
      )
      // Pre-populate both
      await adapter.write('users', { id: 'u1', name: 'Alice' })
      await adapter.write('posts', { id: 'p1', title: 'Hello' })

      // Restore only 'users' — 'posts' should remain untouched
      const result = await service.importData(
        { data: { users: [{ id: 'u10', name: 'Bob' }] } },
        'restore'
      )

      assert.equal(result.deleted, 1)
      assert.equal(result.imported, 1)

      // Users replaced
      const u1 = await adapter.read('users', 'u1')
      const u10 = await adapter.read('users', 'u10')
      assert.equal(u1, null)
      assert.deepEqual(u10, { id: 'u10', name: 'Bob' })

      // Posts untouched
      const p1 = await adapter.read('posts', 'p1')
      assert.deepEqual(p1, { id: 'p1', title: 'Hello' })
    })

    it('should_do_nothing_when_payload_has_collections_with_no_existing_records_in_restore_mode', async () => {
      const { service, adapter } = await createService()
      // No pre-existing records

      const result = await service.importData(
        { data: { users: [{ id: 'u1', name: 'Alice' }] } },
        'restore'
      )

      assert.equal(result.deleted, 0)
      assert.equal(result.imported, 1)
      assert.equal(result.errors.length, 0)

      const r1 = await adapter.read('users', 'u1')
      assert.deepEqual(r1, { id: 'u1', name: 'Alice' })
    })

    it('should_throw_STORE_NOT_FOUND_when_restore_target_is_unknown_collection', async () => {
      const { service } = await createService()
      await assert.rejects(
        service.importData(
          { data: { nonexistent_store: [{ id: 'u1' }] } },
          'restore'
        ),
        (err) => {
          assert.equal(err.code, ERROR_CODES.STORE_NOT_FOUND)
          return true
        }
      )
    })

    it('should_return_deleted_zero_for_replace_and_merge_modes', async () => {
      const { service, adapter } = await createService()
      await adapter.write('users', { id: 'u1', name: 'Alice' })

      // Replace mode
      let result = await service.importData(
        { data: { users: [{ id: 'u2', name: 'Bob' }] } },
        'replace'
      )
      assert.equal(result.deleted, 0)

      // Merge mode
      result = await service.importData(
        { data: { users: [{ id: 'u3', name: 'Charlie' }] } },
        'merge'
      )
      assert.equal(result.deleted, 0)
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

  describe('deactivated service', () => {
    it('should_throw_SERVICE_UNAVAILABLE_on_read_after_deactivation', async () => {
      const { service } = await createService()
      service._setDeactivated()
      await assert.rejects(
        service.read('users', 'u1'),
        (err) => {
          assert.equal(err.code, ERROR_CODES.SERVICE_UNAVAILABLE)
          assert.equal(err.type, 'operational')
          return true
        }
      )
    })

    it('should_throw_SERVICE_UNAVAILABLE_on_write_after_deactivation', async () => {
      const { service } = await createService()
      service._setDeactivated()
      await assert.rejects(
        service.write('users', { id: 'u1', name: 'Alice' }),
        (err) => {
          assert.equal(err.code, ERROR_CODES.SERVICE_UNAVAILABLE)
          return true
        }
      )
    })

    it('should_throw_SERVICE_UNAVAILABLE_on_delete_after_deactivation', async () => {
      const { service } = await createService()
      service._setDeactivated()
      await assert.rejects(
        service.delete('users', 'u1'),
        (err) => {
          assert.equal(err.code, ERROR_CODES.SERVICE_UNAVAILABLE)
          return true
        }
      )
    })

    it('should_throw_SERVICE_UNAVAILABLE_on_query_after_deactivation', async () => {
      const { service } = await createService()
      service._setDeactivated()
      await assert.rejects(
        service.query('users', {}),
        (err) => {
          assert.equal(err.code, ERROR_CODES.SERVICE_UNAVAILABLE)
          return true
        }
      )
    })

    it('should_throw_SERVICE_UNAVAILABLE_on_bulkWrite_after_deactivation', async () => {
      const { service } = await createService()
      service._setDeactivated()
      await assert.rejects(
        service.bulkWrite('users', []),
        (err) => {
          assert.equal(err.code, ERROR_CODES.SERVICE_UNAVAILABLE)
          return true
        }
      )
    })

    it('should_throw_SERVICE_UNAVAILABLE_on_transaction_after_deactivation', async () => {
      const { service } = await createService()
      service._setDeactivated()
      await assert.rejects(
        service.transaction([]),
        (err) => {
          assert.equal(err.code, ERROR_CODES.SERVICE_UNAVAILABLE)
          return true
        }
      )
    })

    it('should_throw_SERVICE_UNAVAILABLE_on_exportData_after_deactivation', async () => {
      const { service } = await createService()
      service._setDeactivated()
      await assert.rejects(
        service.exportData(),
        (err) => {
          assert.equal(err.code, ERROR_CODES.SERVICE_UNAVAILABLE)
          return true
        }
      )
    })

    it('should_throw_SERVICE_UNAVAILABLE_on_importData_after_deactivation', async () => {
      const { service } = await createService()
      service._setDeactivated()
      await assert.rejects(
        service.importData({ data: {} }),
        (err) => {
          assert.equal(err.code, ERROR_CODES.SERVICE_UNAVAILABLE)
          return true
        }
      )
    })
  })
})

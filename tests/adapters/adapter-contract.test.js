// Shared contract tests for the storage adapter kind.
// Every storage adapter must pass this suite.
// Run this against InMemoryStorageAdapter and any future implementation.

import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'

/**
 * Run all adapter contract tests against a given adapter factory.
 * Each test creates a fresh adapter instance, opens it, runs tests, and closes.
 *
 * @param {string} name — adapter name for test grouping
 * @param {function(): { open(config?: object): Promise<void>, close(): Promise<void>, destroy(): Promise<void>, read(collection: string, key: any): Promise<any>, write(collection: string, record: object): Promise<void>, delete(collection: string, key: any): Promise<void>, query(collection: string, criteria?: object): Promise<object[]>, count(collection: string, criteria?: object): Promise<number>, bulkWrite(collection: string, records: object[]): Promise<void>, bulkDelete(collection: string, keys: any[]): Promise<void>, transaction(operations: object[]): Promise<void> }} adapterFactory
 */
export function runAdapterContractTests(name, adapterFactory) {
  describe(`${name} — storage adapter contract`, () => {
    let adapter

    const storesConfig = [
      { name: 'items', keyPath: 'id', autoIncrement: false, indexes: [{ name: 'tag', field: 'tag', unique: false }] },
      { name: 'auto', keyPath: 'id', autoIncrement: true },
    ]

    beforeEach(async () => {
      adapter = adapterFactory()
      await adapter.open({ stores: storesConfig })
    })

    afterEach(async () => {
      try {
        await adapter.destroy()
      } catch {
        await adapter.close()
      }
    })

    // -- Open / Close / Destroy --

    it('should_open_with_empty_stores_config_when_stores_is_empty_array', async () => {
      const fresh = adapterFactory()
      await fresh.open({ stores: [] })
      await fresh.close()
    })

    it('should_be_able_to_reopen_after_close_when_adapter_supports_idempotent_open', async () => {
      await adapter.close()
      await adapter.open({ stores: storesConfig })
      assert.strictEqual(await adapter.count('items'), 0)
      await adapter.close()
    })

    it('should_remove_all_stores_when_destroy_is_called', async () => {
      await adapter.write('items', { id: 1, tag: 'a' })
      await adapter.destroy()
      const fresh = adapterFactory()
      await fresh.open({ stores: storesConfig })
      assert.strictEqual(await fresh.count('items'), 0)
      await fresh.close()
    })

    // -- Read / Write / Delete --

    it('should_read_a_record_by_key_after_write', async () => {
      await adapter.write('items', { id: 1, tag: 'x' })
      const result = await adapter.read('items', 1)
      assert.deepEqual(result, { id: 1, tag: 'x' })
    })

    it('should_return_null_when_reading_a_nonexistent_key', async () => {
      const result = await adapter.read('items', 999)
      assert.strictEqual(result, null)
    })

    it('should_overwrite_an_existing_record_on_write_with_the_same_key', async () => {
      await adapter.write('items', { id: 1, tag: 'a' })
      await adapter.write('items', { id: 1, tag: 'b' })
      const result = await adapter.read('items', 1)
      assert.deepEqual(result, { id: 1, tag: 'b' })
    })

    it('should_delete_a_record_by_key', async () => {
      await adapter.write('items', { id: 1, tag: 'a' })
      await adapter.delete('items', 1)
      const result = await adapter.read('items', 1)
      assert.strictEqual(result, null)
    })

    it('should_not_error_when_deleting_a_nonexistent_record', async () => {
      await adapter.delete('items', 999)
    })

    // -- Query --

    it('should_query_all_records_when_criteria_is_empty', async () => {
      await adapter.write('items', { id: 1, tag: 'a' })
      await adapter.write('items', { id: 2, tag: 'b' })
      const results = await adapter.query('items', {})
      assert.strictEqual(results.length, 2)
    })

    it('should_filter_by_index_criteria', async () => {
      await adapter.write('items', { id: 1, tag: 'a' })
      await adapter.write('items', { id: 2, tag: 'b' })
      await adapter.write('items', { id: 3, tag: 'a' })
      const results = await adapter.query('items', { tag: 'a' })
      assert.strictEqual(results.length, 2)
    })

    // -- Count --

    it('should_return_zero_count_for_an_empty_store', async () => {
      const count = await adapter.count('items')
      assert.strictEqual(count, 0)
    })

    it('should_return_correct_count_after_multiple_writes', async () => {
      await adapter.write('items', { id: 1, tag: 'a' })
      await adapter.write('items', { id: 2, tag: 'b' })
      await adapter.write('items', { id: 3, tag: 'a' })
      const count = await adapter.count('items')
      assert.strictEqual(count, 3)
    })

    it('should_filter_count_by_criteria', async () => {
      await adapter.write('items', { id: 1, tag: 'a' })
      await adapter.write('items', { id: 2, tag: 'b' })
      await adapter.write('items', { id: 3, tag: 'a' })
      const count = await adapter.count('items', { tag: 'a' })
      assert.strictEqual(count, 2)
    })

    // -- Bulk Operations --

    it('should_bulk_write_multiple_records_atomically', async () => {
      const records = [
        { id: 1, tag: 'a' },
        { id: 2, tag: 'b' },
        { id: 3, tag: 'c' },
      ]
      await adapter.bulkWrite('items', records)
      assert.strictEqual(await adapter.count('items'), 3)
    })

    it('should_bulk_delete_multiple_records_atomically', async () => {
      await adapter.write('items', { id: 1, tag: 'a' })
      await adapter.write('items', { id: 2, tag: 'b' })
      await adapter.write('items', { id: 3, tag: 'c' })
      await adapter.bulkDelete('items', [1, 3])
      assert.strictEqual(await adapter.count('items'), 1)
    })

    // -- Transaction --

    it('should_commit_transaction_when_all_operations_succeed', async () => {
      const operations = [
        { collection: 'items', method: 'put', record: { id: 10, tag: 'x' } },
        { collection: 'items', method: 'delete', key: 1 },
      ]
      await adapter.write('items', { id: 1, tag: 'a' })
      await adapter.transaction(operations)
      const record1 = await adapter.read('items', 1)
      const record10 = await adapter.read('items', 10)
      assert.strictEqual(record1, null)
      assert.deepEqual(record10, { id: 10, tag: 'x' })
    })

    it('should_rollback_transaction_when_an_operation_fails', async () => {
      await adapter.write('items', { id: 1, tag: 'a' })
      assert.strictEqual(await adapter.count('items'), 1)

      const operations = [
        { collection: 'items', method: 'put', record: { id: 2, tag: 'b' } },
        { collection: 'items', method: 'invalid_method' },
      ]

      try {
        await adapter.transaction(operations)
        assert.fail('should have thrown')
      } catch (err) {
        assert.ok(err)
      }

      // Verify rollback: count should still be 1
      assert.strictEqual(await adapter.count('items'), 1)
    })

    // -- Adapter Error Behavior --

    it('should_throw_STORE_NOT_FOUND_when_accessing_unknown_collection', async () => {
      try {
        await adapter.read('nonexistent', 1)
        assert.fail('should have thrown')
      } catch (err) {
        assert.strictEqual(err.code, 'STORE_NOT_FOUND')
      }
    })
  })
}

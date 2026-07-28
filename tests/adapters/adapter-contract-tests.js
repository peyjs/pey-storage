import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import InMemoryStorageAdapter from '../../adapters/in-memory-adapter.js'
import { ERROR_CODES } from '../../lib/constants.js'

const VALID_STORES_CONFIG = [
  {
    name: 'users',
    keyPath: 'id',
    autoIncrement: false,
    indexes: [{ name: 'ageIdx', field: 'age', unique: false }],
  },
]

/**
 * Run the shared adapter contract against the given adapter factory.
 * This allows any adapter implementing the contract to be tested with
 * the same suite.
 *
 * @param {string} adapterName
 * @param {function(): InMemoryStorageAdapter} createAdapter
 */
export function runAdapterContractTests(adapterName, createAdapter) {
  let adapter

  describe(`${adapterName} adapter contract`, () => {
    beforeEach(() => {
      adapter = createAdapter()
    })

    afterEach(async () => {
      try {
        await adapter.close()
      } catch {
        // ignore
      }
    })

    describe('open()', () => {
      it('should_allow_read_operation_when_stores_config_is_provided', async () => {
        await adapter.open({ stores: VALID_STORES_CONFIG })
        const record = await adapter.read('users', null)
        assert.equal(record, null)
      })

      it('should_throw_STORE_NOT_FOUND_on_read_when_no_stores_are_configured', async () => {
        await adapter.open({ stores: [] })
        await assert.rejects(
          adapter.read('users', 'x'),
          (err) => {
            assert.equal(err.code, ERROR_CODES.STORE_NOT_FOUND)
            return true
          }
        )
      })
    })

    describe('close()', () => {
      it('should_throw_ADAPTER_NOT_OPEN_on_read_after_close', async () => {
        await adapter.open({ stores: VALID_STORES_CONFIG })
        await adapter.close()
        await assert.rejects(
          adapter.read('users', 'x'),
          (err) => {
            assert.equal(err.type, 'operational')
            assert.equal(err.code, ERROR_CODES.ADAPTER_NOT_OPEN)
            return true
          }
        )
      })

      it('should_not_throw_when_close_is_called_on_already_closed_adapter', async () => {
        await adapter.close()
      })
    })

    describe('destroy()', () => {
      it('should_throw_ADAPTER_NOT_OPEN_on_read_after_destroy', async () => {
        await adapter.open({ stores: VALID_STORES_CONFIG })
        await adapter.destroy()
        await assert.rejects(
          adapter.read('users', 'x'),
          (err) => {
            assert.equal(err.type, 'operational')
            assert.equal(err.code, ERROR_CODES.ADAPTER_NOT_OPEN)
            return true
          }
        )
      })
    })

    describe('read()', () => {
      beforeEach(async () => {
        adapter = createAdapter()
        await adapter.open({ stores: VALID_STORES_CONFIG })
        await adapter.write('users', { id: 'u1', name: 'Alice' })
      })

      it('should_return_record_when_key_exists_for_read', async () => {
        const record = await adapter.read('users', 'u1')
        assert.deepEqual(record, { id: 'u1', name: 'Alice' })
      })

      it('should_return_null_when_key_does_not_exist', async () => {
        const record = await adapter.read('users', 'nonexistent')
        assert.equal(record, null)
      })

      it('should_return_null_when_key_is_null', async () => {
        const record = await adapter.read('users', null)
        assert.equal(record, null)
      })

      it('should_throw_STORE_NOT_FOUND_when_store_is_not_in_config', async () => {
        await assert.rejects(
          adapter.read('nonexistent_store', 'u1'),
          (err) => {
            assert.equal(err.type, 'operational')
            assert.equal(err.code, ERROR_CODES.STORE_NOT_FOUND)
            return true
          }
        )
      })

      it('should_throw_ADAPTER_NOT_OPEN_when_adapter_is_not_open', async () => {
        await adapter.close()
        await assert.rejects(
          adapter.read('users', 'u1'),
          (err) => {
            assert.equal(err.type, 'operational')
            assert.equal(err.code, ERROR_CODES.ADAPTER_NOT_OPEN)
            return true
          }
        )
      })
    })

    describe('write()', () => {
      beforeEach(async () => {
        adapter = createAdapter()
        await adapter.open({ stores: VALID_STORES_CONFIG })
      })

      it('should_insert_new_record_when_key_does_not_exist', async () => {
        await adapter.write('users', { id: 'u2', name: 'Bob' })
        const record = await adapter.read('users', 'u2')
        assert.deepEqual(record, { id: 'u2', name: 'Bob' })
      })

      it('should_update_existing_record_when_key_exists', async () => {
        await adapter.write('users', { id: 'u1', name: 'Alice Updated' })
        const record = await adapter.read('users', 'u1')
        assert.deepEqual(record, { id: 'u1', name: 'Alice Updated' })
      })

      it('should_return_undefined_when_record_is_written_successfully', async () => {
        const result = await adapter.write('users', { id: 'u3', name: 'Charlie' })
        assert.equal(result, undefined)
      })

      it('should_throw_STORE_NOT_FOUND_when_store_is_not_in_config', async () => {
        await assert.rejects(
          adapter.write('nonexistent_store', { id: 'x1' }),
          (err) => {
            assert.equal(err.type, 'operational')
            assert.equal(err.code, ERROR_CODES.STORE_NOT_FOUND)
            return true
          }
        )
      })
    })

    describe('delete()', () => {
      beforeEach(async () => {
        adapter = createAdapter()
        await adapter.open({ stores: VALID_STORES_CONFIG })
        await adapter.write('users', { id: 'u1', name: 'Alice' })
      })

      it('should_delete_existing_record_and_return_undefined_when_key_exists', async () => {
        const result = await adapter.delete('users', 'u1')
        assert.equal(result, undefined)
        const record = await adapter.read('users', 'u1')
        assert.equal(record, null)
      })

      it('should_return_undefined_when_key_does_not_exist_for_delete', async () => {
        const result = await adapter.delete('users', 'nonexistent')
        assert.equal(result, undefined)
      })
    })

    describe('bulkWrite()', () => {
      beforeEach(async () => {
        adapter = createAdapter()
        await adapter.open({ stores: VALID_STORES_CONFIG })
      })

      it('should_write_multiple_records_when_array_is_provided', async () => {
        const records = [
          { id: 'u1', name: 'Alice' },
          { id: 'u2', name: 'Bob' },
        ]
        await adapter.bulkWrite('users', records)
        const r1 = await adapter.read('users', 'u1')
        const r2 = await adapter.read('users', 'u2')
        assert.deepEqual(r1, { id: 'u1', name: 'Alice' })
        assert.deepEqual(r2, { id: 'u2', name: 'Bob' })
      })

      it('should_return_undefined_when_bulk_write_succeeds', async () => {
        const records = [
          { id: 'u1', name: 'Alice' },
          { id: 'u2', name: 'Bob' },
        ]
        const results = await adapter.bulkWrite('users', records)
        assert.equal(results, undefined)
      })
    })

    describe('bulkDelete()', () => {
      beforeEach(async () => {
        adapter = createAdapter()
        await adapter.open({ stores: VALID_STORES_CONFIG })
        await adapter.write('users', { id: 'u1', name: 'Alice' })
        await adapter.write('users', { id: 'u2', name: 'Bob' })
      })

      it('should_delete_multiple_records_and_return_undefined_when_keys_exist', async () => {
        const results = await adapter.bulkDelete('users', ['u1', 'u2'])
        assert.equal(results, undefined)
        const r1 = await adapter.read('users', 'u1')
        const r2 = await adapter.read('users', 'u2')
        assert.equal(r1, null)
        assert.equal(r2, null)
      })

      it('should_return_undefined_when_some_keys_do_not_exist_for_bulk_delete', async () => {
        const results = await adapter.bulkDelete('users', ['u1', 'nonexistent'])
        assert.equal(results, undefined)
      })
    })

    describe('query()', () => {
      beforeEach(async () => {
        adapter = createAdapter()
        await adapter.open({ stores: VALID_STORES_CONFIG })
        await adapter.write('users', { id: 'u1', name: 'Alice' })
        await adapter.write('users', { id: 'u2', name: 'Bob' })
        await adapter.write('users', { id: 'u3', name: 'Charlie' })
      })

      it('should_return_all_records_when_no_filter_is_provided_to_query', async () => {
        const results = await adapter.query('users')
        assert.equal(results.length, 3)
      })

      it('should_return_matching_records_when_filter_is_provided_to_query', async () => {
        const results = await adapter.query('users', { name: 'Alice' })
        assert.equal(results.length, 1)
        assert.equal(results[0].name, 'Alice')
      })

      it('should_return_empty_array_when_no_records_match_filter_in_query', async () => {
        const results = await adapter.query('users', { name: 'Zebra' })
        assert.equal(results.length, 0)
      })
    })

    describe('count()', () => {
      beforeEach(async () => {
        adapter = createAdapter()
        await adapter.open({ stores: VALID_STORES_CONFIG })
        await adapter.write('users', { id: 'u1', name: 'Alice' })
        await adapter.write('users', { id: 'u2', name: 'Bob' })
      })

      it('should_return_total_count_when_records_exist', async () => {
        const count = await adapter.count('users')
        assert.equal(count, 2)
      })

      it('should_return_zero_when_store_has_no_records', async () => {
        adapter = createAdapter()
        await adapter.open({ stores: VALID_STORES_CONFIG })
        const count = await adapter.count('users')
        assert.equal(count, 0)
      })

      it('should_return_matching_count_when_filter_is_provided_to_count', async () => {
        const count = await adapter.count('users', { name: 'Alice' })
        assert.equal(count, 1)
      })
    })

    // ------------------------------------------------------------------
    // Range query tests — shared across all adapter implementations
    // ------------------------------------------------------------------

    describe('query() — range criteria', () => {
      beforeEach(async () => {
        adapter = createAdapter()
        await adapter.open({ stores: VALID_STORES_CONFIG })
        await adapter.write('users', { id: 'u1', name: 'Alice', age: 20 })
        await adapter.write('users', { id: 'u2', name: 'Bob', age: 25 })
        await adapter.write('users', { id: 'u3', name: 'Charlie', age: 30 })
      })

      it('should_return_records_within_gte_lte_range', async () => {
        const results = await adapter.query('users', { ageIdx: { gte: 20, lte: 25 } })
        assert.equal(results.length, 2)
        assert.ok(results.some(r => r.name === 'Alice'))
        assert.ok(results.some(r => r.name === 'Bob'))
      })

      it('should_return_records_within_gt_lt_range', async () => {
        const results = await adapter.query('users', { ageIdx: { gt: 20, lt: 30 } })
        assert.equal(results.length, 1)
        assert.equal(results[0].name, 'Bob')
      })

      it('should_return_records_within_gte_lt_range', async () => {
        const results = await adapter.query('users', { ageIdx: { gte: 20, lt: 30 } })
        assert.equal(results.length, 2)
        assert.ok(results.some(r => r.name === 'Alice'))
        assert.ok(results.some(r => r.name === 'Bob'))
      })

      it('should_return_records_within_gt_lte_range', async () => {
        const results = await adapter.query('users', { ageIdx: { gt: 20, lte: 30 } })
        assert.equal(results.length, 2)
        assert.ok(results.some(r => r.name === 'Bob'))
        assert.ok(results.some(r => r.name === 'Charlie'))
      })

      it('should_return_records_with_gte_only', async () => {
        const results = await adapter.query('users', { ageIdx: { gte: 25 } })
        assert.equal(results.length, 2)
      })

      it('should_return_records_with_lte_only', async () => {
        const results = await adapter.query('users', { ageIdx: { lte: 25 } })
        assert.equal(results.length, 2)
      })

      it('should_return_records_with_gt_only', async () => {
        const results = await adapter.query('users', { ageIdx: { gt: 25 } })
        assert.equal(results.length, 1)
        assert.equal(results[0].name, 'Charlie')
      })

      it('should_return_records_with_lt_only', async () => {
        const results = await adapter.query('users', { ageIdx: { lt: 25 } })
        assert.equal(results.length, 1)
        assert.equal(results[0].name, 'Alice')
      })

      it('should_return_empty_array_when_range_matches_no_records', async () => {
        const results = await adapter.query('users', { ageIdx: { gte: 50, lte: 60 } })
        assert.equal(results.length, 0)
      })
    })

    describe('count() — range criteria', () => {
      beforeEach(async () => {
        adapter = createAdapter()
        await adapter.open({ stores: VALID_STORES_CONFIG })
        await adapter.write('users', { id: 'u1', name: 'Alice', age: 20 })
        await adapter.write('users', { id: 'u2', name: 'Bob', age: 25 })
        await adapter.write('users', { id: 'u3', name: 'Charlie', age: 30 })
      })

      it('should_return_count_within_gte_lte_range', async () => {
        const count = await adapter.count('users', { ageIdx: { gte: 20, lte: 25 } })
        assert.equal(count, 2)
      })

      it('should_return_count_within_gt_lt_range', async () => {
        const count = await adapter.count('users', { ageIdx: { gt: 20, lt: 30 } })
        assert.equal(count, 1)
      })

      it('should_return_count_with_gte_only', async () => {
        const count = await adapter.count('users', { ageIdx: { gte: 25 } })
        assert.equal(count, 2)
      })

      it('should_return_count_with_lte_only', async () => {
        const count = await adapter.count('users', { ageIdx: { lte: 25 } })
        assert.equal(count, 2)
      })

      it('should_return_zero_when_range_matches_no_records', async () => {
        const count = await adapter.count('users', { ageIdx: { gte: 50, lte: 60 } })
        assert.equal(count, 0)
      })
    })

    describe('transaction()', () => {
      beforeEach(async () => {
        adapter = createAdapter()
        await adapter.open({ stores: VALID_STORES_CONFIG })
      })

      it('should_execute_writes_and_commit_on_success', async () => {
        await adapter.transaction([
          { method: 'put', collection: 'users', record: { id: 'u1', name: 'Alice' } },
        ])
        const record = await adapter.read('users', 'u1')
        assert.deepEqual(record, { id: 'u1', name: 'Alice' })
      })

      it('should_throw_error_and_rollback_writes_when_invalid_method_is_provided', async () => {
        await adapter.transaction([
          { method: 'put', collection: 'users', record: { id: 'u1', name: 'Alice' } },
        ])
        await assert.rejects(
          adapter.transaction([
            { method: 'put', collection: 'users', record: { id: 'u2', name: 'Bob' } },
            { method: 'invalid_method', collection: 'users', record: { id: 'u3', name: 'Fail' } },
          ]),
          (err) => {
            assert.ok(err)
            return true
          }
        )
        const record = await adapter.read('users', 'u2')
        assert.equal(record, null)
      })
    })
  })
}

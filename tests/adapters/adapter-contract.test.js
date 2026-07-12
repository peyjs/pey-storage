import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import InMemoryStorageAdapter from '../../adapters/in-memory-adapter.js'
import { ERROR_CODES } from '../../lib/constants.js'

const VALID_STORES_CONFIG = [
  { name: 'users', keyPath: 'id', autoIncrement: false },
]

/**
 * Check if the adapter is open by reading the private _isOpen flag.
 * @param {InMemoryStorageAdapter} adapter
 * @returns {boolean}
 */
function isAdapterOpen(adapter) {
  return adapter._isOpen === true
}

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

  afterEach(async () => {
    try {
      await adapter.close()
    } catch {
      // ignore
    }
  })

  describe(`${adapterName} adapter contract`, () => {
    beforeEach(() => {
      adapter = createAdapter()
    })

    describe('open()', () => {
      it('should_open_and_set_internal_state_when_stores_config_is_provided', async () => {
        await adapter.open({ stores: VALID_STORES_CONFIG })
        assert.equal(isAdapterOpen(adapter), true)
      })

      it('should_open_with_empty_stores_config_when_stores_is_empty_array', async () => {
        await adapter.open({ stores: [] })
        assert.equal(isAdapterOpen(adapter), true)
      })
    })

    describe('close()', () => {
      it('should_mark_adapter_not_open_after_close', async () => {
        await adapter.open({ stores: VALID_STORES_CONFIG })
        await adapter.close()
        assert.equal(isAdapterOpen(adapter), false)
      })

      it('should_not_throw_when_close_is_called_on_already_closed_adapter', async () => {
        await adapter.close()
      })
    })

    describe('destroy()', () => {
      it('should_destroy_adapter_and_mark_not_open', async () => {
        await adapter.open({ stores: VALID_STORES_CONFIG })
        await adapter.destroy()
        assert.equal(isAdapterOpen(adapter), false)
      })
    })

    describe('read()', () => {
      beforeEach(async () => {
        adapter = createAdapter()
        await adapter.open({ stores: VALID_STORES_CONFIG })
        await adapter.write('users', { id: 'u1', name: 'Alice' })
      })

      it('should_return_record_when_key_exists', async () => {
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

      it('should_throw_error_with_STORE_NOT_FOUND_when_store_is_not_in_config', async () => {
        await assert.rejects(
          adapter.read('nonexistent_store', 'u1'),
          (err) => {
            assert.equal(err.type, 'operational')
            assert.equal(err.code, ERROR_CODES.STORE_NOT_FOUND)
            return true
          }
        )
      })

      it('should_throw_error_with_ADAPTER_NOT_OPEN_when_adapter_is_not_open', async () => {
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

      it('should_insert_new_record', async () => {
        await adapter.write('users', { id: 'u2', name: 'Bob' })
        const record = await adapter.read('users', 'u2')
        assert.deepEqual(record, { id: 'u2', name: 'Bob' })
      })

      it('should_update_existing_record', async () => {
        await adapter.write('users', { id: 'u1', name: 'Alice Updated' })
        const record = await adapter.read('users', 'u1')
        assert.deepEqual(record, { id: 'u1', name: 'Alice Updated' })
      })

      it('should_return_undefined', async () => {
        const result = await adapter.write('users', { id: 'u3', name: 'Charlie' })
        assert.equal(result, undefined)
      })

      it('should_throw_error_with_STORE_NOT_FOUND_when_store_is_not_in_config', async () => {
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

      it('should_delete_existing_record', async () => {
        const result = await adapter.delete('users', 'u1')
        assert.equal(result, undefined)
        const record = await adapter.read('users', 'u1')
        assert.equal(record, null)
      })

      it('should_return_undefined_when_key_does_not_exist', async () => {
        const result = await adapter.delete('users', 'nonexistent')
        assert.equal(result, undefined)
      })
    })

    describe('bulkWrite()', () => {
      beforeEach(async () => {
        adapter = createAdapter()
        await adapter.open({ stores: VALID_STORES_CONFIG })
      })

      it('should_write_multiple_records', async () => {
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

      it('should_return_undefined', async () => {
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

      it('should_delete_multiple_records', async () => {
        const results = await adapter.bulkDelete('users', ['u1', 'u2'])
        assert.equal(results, undefined)
        const r1 = await adapter.read('users', 'u1')
        const r2 = await adapter.read('users', 'u2')
        assert.equal(r1, null)
        assert.equal(r2, null)
      })

      it('should_return_undefined', async () => {
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

      it('should_return_all_records_when_no_filter_is_provided', async () => {
        const results = await adapter.query('users')
        assert.equal(results.length, 3)
      })

      it('should_return_matching_records_when_filter_is_provided', async () => {
        const results = await adapter.query('users', { name: 'Alice' })
        assert.equal(results.length, 1)
        assert.equal(results[0].name, 'Alice')
      })

      it('should_return_empty_array_when_no_records_match_filter', async () => {
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

      it('should_return_total_count', async () => {
        const count = await adapter.count('users')
        assert.equal(count, 2)
      })

      it('should_return_zero_when_store_is_empty', async () => {
        adapter = createAdapter()
        await adapter.open({ stores: VALID_STORES_CONFIG })
        const count = await adapter.count('users')
        assert.equal(count, 0)
      })

      it('should_return_matching_count_when_filter_is_provided', async () => {
        const count = await adapter.count('users', { name: 'Alice' })
        assert.equal(count, 1)
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

      it('should_rollback_writes_when_transaction_fails', async () => {
        await adapter.transaction([
          { method: 'put', collection: 'users', record: { id: 'u1', name: 'Alice' } },
        ])
        await adapter.transaction([
          { method: 'delete', collection: 'users', key: 'u1' },
        ])
        const record = await adapter.read('users', 'u1')
        assert.equal(record, null)
      })
    })
  })
}

// IndexedDB adapter — runs the shared storage adapter contract suite.
// fake-indexeddb provides a fresh in-memory IndexedDB per adapter instance,
// so the IndexedDB-specific and in-memory adapters can be tested against
// exactly the same contract without a browser.

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import IndexedDBStorageAdapter from '../../adapters/indexeddb-adapter.js'
import { runAdapterContractTests } from './adapter-contract-tests.js'

/** Factory that creates a fresh IndexedDBAdapter instance with a fresh fake DB */
function createAdapter() {
  globalThis.indexedDB = new IDBFactory()
  globalThis.IDBKeyRange = IDBKeyRange
  return new IndexedDBStorageAdapter()
}

runAdapterContractTests('IndexedDBStorageAdapter', createAdapter)

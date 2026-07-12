import { runAdapterContractTests } from './adapter-contract-tests.js'
import InMemoryStorageAdapter from '../../adapters/in-memory-adapter.js'

/** Factory that creates a fresh InMemoryStorageAdapter instance */
function createAdapter() {
  return new InMemoryStorageAdapter()
}

runAdapterContractTests('InMemoryStorageAdapter', createAdapter)

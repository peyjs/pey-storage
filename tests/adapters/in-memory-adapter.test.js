// Tests for InMemoryStorageAdapter using the shared adapter contract.

import { describe } from 'node:test'
import InMemoryStorageAdapter from '../../adapters/in-memory-adapter.js'
import { runAdapterContractTests } from './adapter-contract.test.js'

/** Factory that creates a fresh InMemoryStorageAdapter instance */
function createAdapter() {
  return new InMemoryStorageAdapter()
}

runAdapterContractTests('InMemoryStorageAdapter', createAdapter)

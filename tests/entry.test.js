// Tests for the pey.storage entry point (index.js) — two-phase shape
// (prepare / activate) per Bonyan architecture 0.11.
//
// Strategy: the IndexedDBAdapter module is replaced with a fake adapter via
// node:test's built-in mock.module(). Each test gets a fresh adapter instance
// (via new AdapterClass() inside prepare()); the fake class stashes a static
// reference to its last instance so tests can observe open()/close() behavior
// via the fake's own fields, without reaching into StorageService internals.
// per-test behavior of open() is controlled through FakeAdapter.openRejectsWith,
// reset in beforeEach. No real IndexedDB is touched.

import { describe, it, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'

import { ERROR_CODES } from '../lib/constants.js'
import StorageService from '../lib/storage-service.js'

// ---------------------------------------------------------------------------
// Fake adapter — exposes the storage adapter base method set. Only the parts
// the entry point touches (open/close) are exercised here. Tests read state
// from FakeAdapter.lastInstance (the most recent constructor invocation),
// which is test infrastructure, not a production-code internal field.
// ---------------------------------------------------------------------------

class FakeAdapter {
  constructor() {
    this.openCalls = []
    this.closeCalls = 0
    FakeAdapter.lastInstance = this
  }

  async open(config) {
    this.openCalls.push(config)
    if (FakeAdapter.openRejectsWith) throw FakeAdapter.openRejectsWith
    this._isOpen = true
  }

  async close() {
    this.closeCalls++
    this._isOpen = false
  }
}

// Class-level test controls — reset in beforeEach.
FakeAdapter.lastInstance = null
FakeAdapter.openRejectsWith = null

// ---------------------------------------------------------------------------
// Fake event bus — records published events for assertion on type/data only,
// as testing-standard.md requires (id/source/timestamp are the Core's concern).
// ---------------------------------------------------------------------------

function createFakeEventBus() {
  const published = []
  return {
    published,
    publish(type, data) { published.push({ type, data }) },
    subscribe() { /* not exercised; no required dependency */ },
  }
}

// ---------------------------------------------------------------------------
// Replace the real IndexedDBAdapter module with the fake class before any
// import of index.js. In Node v25 with --experimental-test-module-mocks, the
// mock.module API takes an options object with a `defaultExport` field, not a
// factory function. We pass the FakeAdapter class itself; instance state is
// then controlled via the static FakeAdapter.lastInstance / openRejectsWith
// fields, reset in beforeEach.
// ---------------------------------------------------------------------------

mock.module('../adapters/indexeddb-adapter.js', {
  defaultExport: FakeAdapter,
})

// Lazily import index.js once after the mock is registered. index.js's static
// import of indexeddb-adapter.js resolves through mock.module, so `prepare` /
// `activate` here reference an entry module bound to FakeAdapter. Module-level
// state inside index.js (savedContext etc.) is overwritten by each test's own
// prepare() call, so tests stay independent as long as each test calls
// prepare() before reading any closure-backed behavior.
const entryModule = await import('../index.js')
const prepare = entryModule.prepare
const activate = entryModule.activate

// ---------------------------------------------------------------------------
// Helpers — each test builds its own prepareContext. The only mutable cross-
// test state is FakeAdapter.lastInstance / openRejectsWith, both reset in
// beforeEach.
// ---------------------------------------------------------------------------

/**
 * Build a minimal PrepareContext matching core-api-reference.md shape.
 *
 * @param {object} [overrides]
 * @returns {{ config: object, events: object, onShutdown: null, onDeactivated: null }}
 */
function createPrepareContext(overrides = {}) {
  return {
    config: {
      adapter: 'IndexedDBAdapter',
      databaseName: 'test-db',
      schemaVersion: 1,
      stores: [{ name: 'users', keyPath: 'id' }],
      ...(overrides.config || {}),
    },
    events: createFakeEventBus(),
    onShutdown: null,
    onDeactivated: null,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('pey.storage entry point', () => {

  beforeEach(() => {
    FakeAdapter.lastInstance = null
    FakeAdapter.openRejectsWith = null
  })

  describe('prepare() — success path', () => {
    it('should_return_array_with_service_instance_when_adapter_open_succeeds', async () => {
      const ctx = createPrepareContext()

      const services = await prepare(ctx)

      assert.ok(Array.isArray(services), 'prepare() must return an array')
      assert.equal(services.length, 1)
      assert.equal(services[0].name, 'pey.storage.service')
      assert.ok(services[0].object instanceof StorageService)
    })

    it('should_open_adapter_with_assembled_config_when_prepare_succeeds', async () => {
      const ctx = createPrepareContext()

      await prepare(ctx)

      assert.ok(FakeAdapter.lastInstance, 'an adapter instance must have been constructed')
      assert.equal(FakeAdapter.lastInstance.openCalls.length, 1)
    })

    it('should_not_publish_storage_ready_during_prepare_when_only_prepare_runs', async () => {
      const ctx = createPrepareContext()

      await prepare(ctx)

      assert.equal(ctx.events.published.length, 0)
    })

    it('should_assign_lifecycle_hooks_when_prepare_succeeds', async () => {
      const ctx = createPrepareContext()

      await prepare(ctx)

      // Hooks are assigned in prepare(), not activate(), so resources opened in
      // prepare() are reclaimed even if activate() never runs (e.g. the plugin
      // is skipped at settlement or activate() throws ACTIVATION_FAILED).
      assert.equal(typeof ctx.onShutdown, 'function')
      assert.equal(typeof ctx.onDeactivated, 'function')
    })
  })

  describe('prepare() — unknown adapter identifier', () => {
    it('should_throw_ADAPTER_NOT_CONFIGURED_when_adapter_identifier_is_unknown', async () => {
      const ctx = createPrepareContext({ config: { adapter: 'NoSuchAdapter' } })

      await assert.rejects(prepare(ctx), (err) => {
        assert.equal(err.code, ERROR_CODES.ADAPTER_NOT_CONFIGURED)
        assert.equal(err.source, 'pey.storage')
        assert.equal(err.type, 'startup')
        return true
      })
    })
  })

  describe('prepare() — adapter config assembly', () => {
    it('should_pass_plugin_owned_fields_to_adapter_open_when_using_simple_bootstrap_form', async () => {
      const ctx = createPrepareContext()
      // No adapterConfig key at all — simple bootstrap form.

      await prepare(ctx)

      const passed = FakeAdapter.lastInstance.openCalls[0]
      assert.equal(passed.databaseName, 'test-db')
      assert.equal(passed.schemaVersion, 1)
      assert.deepEqual(passed.stores, [{ name: 'users', keyPath: 'id' }])
      // The adapter identifier must NOT leak into adapter.open(...)
      assert.equal(passed.adapter, undefined,
        'config.adapter must not be passed through to adapter.open()')
    })

    it('should_apply_adapterConfig_overrides_when_using_extended_bootstrap_form', async () => {
      const ctx = createPrepareContext({
        config: { adapterConfig: { databaseName: 'override-db' } },
      })

      await prepare(ctx)

      const passed = FakeAdapter.lastInstance.openCalls[0]
      assert.equal(passed.databaseName, 'override-db')
      assert.equal(passed.schemaVersion, 1)
      assert.deepEqual(passed.stores, [{ name: 'users', keyPath: 'id' }])
    })
  })

  describe('prepare() — adapter.open() failures', () => {
    it('should_throw_startup_storage_unavailable_when_adapter_open_rejects_with_unstructured_error', async () => {
      FakeAdapter.openRejectsWith = new Error('boom')
      const ctx = createPrepareContext()

      await assert.rejects(prepare(ctx), (err) => {
        assert.equal(err.code, ERROR_CODES.STORAGE_UNAVAILABLE)
        assert.equal(err.type, 'startup')
        assert.equal(err.source, 'pey.storage')
        return true
      })
    })

    it('should_rethrow_with_type_startup_when_adapter_open_rejects_with_structured_storage_error', async () => {
      const structured = {
        code: 'QUOTA_EXCEEDED',
        message: 'Quota exceeded',
        source: 'pey.storage',
        type: 'operational',
        timestamp: new Date().toISOString(),
        detail: null,
      }
      FakeAdapter.openRejectsWith = structured
      const ctx = createPrepareContext()

      await assert.rejects(prepare(ctx), (err) => {
        assert.equal(err.code, 'QUOTA_EXCEEDED')
        assert.equal(err.source, 'pey.storage')
        assert.equal(err.type, 'startup', 'type must be coerced to startup')
        assert.equal(err.message, 'Startup error: Quota exceeded')
        return true
      })
    })
  })

  describe('prepare() — lifecycle hooks assigned in prepare phase', () => {
    it('should_close_adapter_when_onShutdown_runs_without_activate', async () => {
      const ctx = createPrepareContext()
      await prepare(ctx)
      const fakeAdapter = FakeAdapter.lastInstance

      // activate() is intentionally NOT called — onShutdown must still close
      // the adapter, since hooks are wired in prepare().
      await ctx.onShutdown()

      assert.equal(fakeAdapter.closeCalls, 1)
    })

    it('should_close_adapter_when_onDeactivated_runs_without_activate', async () => {
      const ctx = createPrepareContext()
      await prepare(ctx)
      const fakeAdapter = FakeAdapter.lastInstance

      await ctx.onDeactivated()

      assert.equal(fakeAdapter.closeCalls, 1)
    })

    it('should_make_service_throw_SERVICE_UNAVAILABLE_when_read_called_after_onShutdown_without_activate', async () => {
      const ctx = createPrepareContext()
      const services = await prepare(ctx)
      const service = services[0].object

      await ctx.onShutdown()

      // Manifest-visible behavior: read() must reject with SERVICE_UNAVAILABLE
      // after deactivate, instead of executing. This exercises _setDeactivated()
      // without reaching into internals. activate() is not called — hooks must
      // work without it.
      await assert.rejects(service.read('users', 'u1'), (err) => {
        assert.equal(err.code, ERROR_CODES.SERVICE_UNAVAILABLE)
        return true
      })
    })
  })

  describe('activate() — publishes ready event', () => {
    it('should_publish_storage_ready_once_with_version_and_stores_when_called_after_prepare_succeeds', async () => {
      const ctx = createPrepareContext()
      await prepare(ctx)

      await activate({})

      assert.equal(ctx.events.published.length, 1)
      const evt = ctx.events.published[0]
      assert.equal(evt.type, 'storage:ready')
      assert.equal(evt.data.version, '0.2.0')
      assert.deepEqual(evt.data.stores, ['users'])
    })

    // Guards against architecture drift: activate(services) must not read from
    // `services`. A Proxy trap as `services` would throw if any property were
    // accessed during activate(); the publish path only uses the closure-saved
    // prepareContext (events/storesConfig), never `services` directly.
    it('should_ignore_unexpected_service_keys_when_activate_runs', async () => {
      const ctx = createPrepareContext()
      await prepare(ctx)

      const trappedServices = new Proxy({}, {
        get(_t, prop) {
          throw new Error(`activate() must not read services.${String(prop)}`)
        },
      })

      await activate(trappedServices)

      assert.equal(ctx.events.published.length, 1)
      assert.equal(ctx.events.published[0].type, 'storage:ready')
    })
  })

  describe('manifest / code agreement', () => {
    it('should_expose_exactly_the_declared_service_name_when_prepare_succeeds', async () => {
      const ctx = createPrepareContext()
      const services = await prepare(ctx)
      assert.equal(services[0].name, 'pey.storage.service',
        'name must match the manifest provides[0].name exactly')
    })

    it('should_publish_only_the_declared_storage_ready_event_when_activate_runs', async () => {
      const ctx = createPrepareContext()
      await prepare(ctx)

      await activate({})

      // Every published event must be one declared in the manifest.
      for (const evt of ctx.events.published) {
        assert.equal(evt.type, 'storage:ready',
          'only storage:ready (declared in manifest.events) may be published')
      }
    })
  })
})

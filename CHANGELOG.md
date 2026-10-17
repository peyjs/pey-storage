# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.0] — 2026-10-17

### Added
- Added the `SCHEMA_UPGRADE_FAILED` error code: schema configuration is validated before any upgrade work and an aborted upgrade reports this code with the underlying cause summarized in `detail`. Schema upgrade behavior is documented in `docs/reference.md`.
- Added a full-store scan fallback for `query()` and `count()` criteria keys that are not live database indexes, so results are identical to the in-memory adapter. See `docs/reference.md` for the performance note.
- Added the shared adapter contract test run against the IndexedDB adapter in Node (`fake-indexeddb` added as a devDependency).

### Changed
- Changed write and transaction primitives (`write`, `delete`, `bulkWrite`, `bulkDelete`, `transaction`) to reject with a standard error when a transaction aborts or a synchronous write fails, and to abort safely so the primary error is never masked.
- Changed schema-upgrade failure handling to abort the versionchange transaction, close the intermediate connection, and reject `open()` exactly once with a sanitized cause (error codes only, no raw error text).
- Changed `open()` to guard `navigator` access so the adapter also runs in non-browser environments.

### Fixed
- Fixed configured indexes not being created for **existing** stores on a schema upgrade; index creation is idempotent, so re-declared indexes no longer error.
- Fixed transaction rollback for mid-operation failures — nothing from an aborted transaction persists.
- Fixed `read(collection, null)` to resolve `null` and raw `NotFoundError` (unknown store) to surface as the documented `STORE_NOT_FOUND`.

## [0.4.0] — 2026-08-01

### Added
- New `'restore'` mode for `importData()` — only targets collections present in `payload.data`, reads all existing keys via `query(collection, {})`, builds a single atomic operation array (one `delete` per existing key + one `put` per valid payload record) sent to `adapter.transaction()` in one call. Returns `{ imported, skipped, deleted, errors }` with `deleted: number` (actual count of records removed). Invalid records (missing key) are reported in `errors` (reason: `'missing-key'`) and excluded from the write without aborting the transaction.
- Counts derived from actual operation array (`put` → imported, `delete` → deleted) instead of parallel payload iteration.
- 7 new service tests for restore mode: basic restore, multi-collection atomic restore, missing-key error recovery, partial collection targeting, empty-store restore, unknown collection rejection, deleted=0 for replace/merge.

### Changed
- `importData()` return type now includes `deleted: number` for all modes (0 for replace/merge, actual count for restore).
- business rule updated to reference v0.4.0 and note that encryption remains a no-op.

### Documentation
- `docs/reference.md` documents `'restore'` mode behavior, constraints (memory footprint for large stores — unconfirmed, no benchmark), and new Business Rules 4–6 (restore mode, scale limit, deactivated service).
- `manifest.json` updated `importData` description, mode type, and `returns` to include `deleted: number`.

## [0.3.0] — 2026-07-28

### Added
- Range filter support on `query()` and `count()` — accepts `{ field: { gte, lte, gt, lt } }` in addition to `{ field: value }` exact match. `indexeddb-adapter.js` uses `IDBKeyRange.bound()` with positional booleans and 4-argument form for combined operators; `in-memory-adapter.js` mirrors the behavior with a `_matchesRange()` helper and `_indexFieldMap` to resolve index names to field names.
- 15 new adapter contract tests covering all range operator combinations (single and combined operators for both `query` and `count`).

### Changed
- `hasRangeOperators()` now guards `IDBKeyRange` calls: `{ field: {} }` (empty object with no gte/lte/gt/lt) returns zero/empty consistently in both adapters instead of producing inconsistent behavior.
- `store.index(indexName)` in the IndexedDB adapter is now wrapped in try/catch with `reject(mapError(...))` + `return`, preventing raw IndexedDB errors from leaking.
- `BUILDING` business rule updated to reference v0.3.0 and note that encryption remains a no-op.

### Documentation
- `docs/reference.md` documents range operators, empty-object `{}` behavior, and examples for both `query()` and `count()`.
- `manifest.json` updated `query` and `count` descriptions to include range format.

## [0.2.0] — 2026-07-19

### Added
- `tests/entry.test.js` — 16 tests covering `prepare()` (`success` / `unknown adapter identifier` / `adapter config assembly (simple + extended form)` / `adapter.open() failures (unstructured + structured)` / `lifecycle hooks assigned in prepare phase, including without activate`) and `activate()` (publishes `storage:ready` once with version + stores; ignores unexpected `services` keys via Proxy trap). Uses `node:test`'s `mock.module` (`--experimental-test-module-mocks` flag added to `npm test`).

### Changed
- Migrated entry point from single-phase `setup(context)` to the two-phase `prepare(prepareContext)` / `activate(services)` lifecycle per Bonyan architecture `0.11`.
- Manifest `architecture` bumped from `0.10` to `0.11`; `version` bumped from `0.1.0` to `0.2.0`. The consumer-facing contract (provides / events / dependencies / config) is unchanged.
- Module-level closure (`savedContext`, `storesConfig`, `adapterRef`, `serviceRef`) introduced so `activate()` — which receives only `services` — can read config, events, and store names without dipping into `StorageService` internals.
- The adapter-scoped config passed to `adapter.open(...)` is now assembled explicitly from plugin-owned `databaseName` / `schemaVersion` / `stores` merged with Core-injected `prepareContext.config.adapterConfig` (extended bootstrap form only). The whole `prepareContext.config` is no longer passed through to the adapter.
- Lifecycle hooks (`onShutdown` / `onDeactivated`) are now assigned in `prepare()` immediately after `adapter.open(...)`, rather than in `activate()`. This prevents an open adapter from leaking if `activate()` never runs (e.g. `ACTIVATION_FAILED` or settlement skip).

### Removed
- The `setup()` export. It is not aliased — consumers and tests must call `prepare()` then `activate({})` instead.

### Documentation
- `README.md` and `docs/reference.md` updated to reflect the two-phase entry point, the `prepareContext.config.adapter` injection path, and the `0.2.0` / `0.11` version pair. `docs/reference.md` gains a new `## Lifecycle` section.

## [0.1.0] — 2026-07-12

### Added
- Initial release.
- Generic key-value storage service with 10 methods: `read`, `write`, `delete`, `query`, `count`, `bulkWrite`, `bulkDelete`, `transaction`, `exportData`, `importData`.
- IndexedDB adapter (`indexeddb-adapter.js`) and in-memory test substitute (`in-memory-adapter.js`).
- Adapter contract test suite (`adapter-contract-tests.js`).
- Service-level test suite (`storage-service.test.js`).
- Standardized error handling: `buildError`, `buildStartupError`, `buildCriticalError`, `mapError`.
- Error codes: `STORE_NOT_FOUND`, `RECORD_NOT_FOUND`, `ADAPTER_NOT_OPEN`, `ADAPTER_NOT_CONFIGURED`, `QUOTA_EXCEEDED`, `STORAGE_UNAVAILABLE`, `TRANSACTION_FAILED`, `IMPORT_INVALID_PAYLOAD`, `SERVICE_UNAVAILABLE`.
- `storage:ready` domain event published after successful adapter open.
- Import modes: `replace` (atomic via `bulkWrite`) and `merge` (per-record check with skipped/error tracking).
- Transaction rollback support: operations snapshot and discard on failure.
- Service deactivation guard: all methods return `SERVICE_UNAVAILABLE` after `onDeactivated`/`onShutdown`.
- Configurable stores with `name`, `keyPath`, `autoIncrement`, and `indexes`.
- Export format version constant (`EXPORT_FORMAT_VERSION = '1.0.0'`) independent of plugin and schema versions.
- Startup-phase error normalization: adapter `STORAGE_UNAVAILABLE` errors caught in `setup()` and re-wrapped as `startup` type.

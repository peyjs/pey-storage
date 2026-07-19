# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

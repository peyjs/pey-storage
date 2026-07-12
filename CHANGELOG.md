# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

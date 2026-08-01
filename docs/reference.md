# pey.storage — Full Reference

## Purpose

Generic key-value storage plugin backed by a swappable adapter (currently IndexedDB). Provides CRUD, query, count, bulk, transaction, and import/export operations through a single service. Swapping the underlying storage engine requires configuration changes only — no code changes.

## Structure

```
pey.storage/
├── manifest.json          — Plugin identity, provides, events, config
├── index.js               — Entry point: prepare(), activate(), lifecycle hooks, service registration
├── lib/
│   ├── constants.js       — Plugin name, version, error codes, event names, export format version
│   ├── error.js           — Standard Bonyan error builders (buildError, buildStartupError, buildCriticalError, mapError)
│   └── storage-service.js — Plugin-layer service: orchestration, validation, merge/replace logic, export/import
├── adapters/
│   ├── indexeddb-adapter.js   — IndexedDB-backed adapter implementation
│   └── in-memory-adapter.js   — Test substitute with same interface
└── tests/
    ├── adapters/
    │   ├── adapter-contract-tests.js   — Shared contract tests for all storage adapters
    │   └── in-memory-adapter.test.js   — In-memory adapter specific tests
    └── service/
        └── storage-service.test.js     — Service method tests
```

## Dependencies

No required or optional dependencies. This is the first plugin in startup order and has no service dependencies.

## Lifecycle

Per Bonyan architecture `0.11`, the entry point is split into two phases:

- **`prepare(prepareContext)`** — resolves the storage adapter by `prepareContext.config.adapter`, instantiates the adapter and the `StorageService`, opens the adapter with an assembled adapter-scoped config (plugin-owned `databaseName` / `schemaVersion` / `stores` from `manifest.config`, merged with any `prepareContext.config.adapterConfig` overrides), assigns `onShutdown` / `onDeactivated` to the **same** `prepareContext` object (so resources opened here are reclaimed even if `activate()` never runs — e.g. `ACTIVATION_FAILED` or settlement skip), and returns `[{ name: SERVICE_NAME, object: service }]`. Any failure here is a startup failure: structured errors are re-thrown with `type: 'startup'`, unstructured errors are wrapped via `buildStartupError(STORAGE_UNAVAILABLE)`.
- **`activate(_services)`** — receives only `services` (this plugin declares no dependencies and therefore does not read any key from it). Reads `events` and `storesConfig` from the module-level closure saved during `prepare()`, and publishes `storage:ready` exactly once with `{ version, stores: storesConfig.map(s => s.name) }`. Lifecycle hooks are *not* assigned here — see `prepare()`. 

The Core guarantees that `prepareContext` is the same object reference across both phases, so saving it in `prepare()` and reading back in `activate()` is safe.

## Public API

**Service:** `pey.storage.service`

### `read(collection, key)`

Read a single record by key from a collection. Returns the record object or `null` if not found.

```js
const user = await service.read('users', 'u1')
// user => { id: 'u1', name: 'Alice' } or null
```

### `write(collection, record)`

Insert or update a single record. The key is resolved from `record[keyPath]` or auto-generated.

```js
await service.write('users', { id: 'u1', name: 'Alice' })
```

### `delete(collection, key)`

Delete a single record by key. Returns without error if the record does not exist.

```js
await service.delete('users', 'u1')
```

### `query(collection, criteria)`

Query records with a raw index/range filter. Criteria supports exact match and range operators:

**Exact match:**
```js
const results = await service.query('users', { name: 'Alice' })
```

**Range filter** (on an indexed field):
```js
// age between 20 and 30 (inclusive)
const results = await service.query('users', { ageIdx: { gte: 20, lte: 30 } })

// age > 25
const results = await service.query('users', { ageIdx: { gt: 25 } })

// age < 20
const results = await service.query('users', { ageIdx: { lt: 20 } })
```

Operators: `gte` (≥), `lte` (≤), `gt` (>), `lt` (<). Any combination is valid (e.g. `{ gte, lt }`).

**Empty criteria value:** `{ field: {} }` (i.e. an empty object with no gte/lte/gt/lt keys) matches **no records** — both the in-memory adapter and the IndexedDB adapter return an empty array. This is intentional; IDB cannot construct a valid `IDBKeyRange` from `{}`.

### `count(collection, criteria?)`

Count records in a collection, optionally filtered by a raw range query criteria. Supports the same exact match and range formats as `query()`.

```js
const total = await service.count('users')
const filtered = await service.count('users', { name: 'Alice' })

// Count records where age >= 20
const adults = await service.count('users', { ageIdx: { gte: 20 } })
```

Operators: `gte` (≥), `lte` (≤), `gt` (>), `lt` (<).

**Empty criteria value:** `{ field: {} }` returns **zero** — consistent with `query()` returning an empty array.

### `bulkWrite(collection, records)`

Bulk insert or update multiple records atomically.

```js
await service.bulkWrite('users', [
  { id: 'u1', name: 'Alice' },
  { id: 'u2', name: 'Bob' },
])
```

### `bulkDelete(collection, keys)`

Bulk delete multiple records atomically.

```js
await service.bulkDelete('users', ['u1', 'u2'])
```

### `transaction(operations)`

Run multiple raw operations atomically. If any operation fails, all changes are rolled back.

```js
await service.transaction([
  { method: 'put', collection: 'users', record: { id: 'u1', name: 'Alice' } },
  { method: 'delete', collection: 'users', key: 'u2' },
])
```

### `exportData(collections?)`

Export all records (optionally scoped to specific collections) into a JSON-compatible payload with metadata (format, export format version, timestamp, collections).

```js
const { metadata, data } = await service.exportData()
const scoped = await service.exportData(['users'])
```

### `importData(payload, mode)`

Import a previously exported payload. Mode controls conflict resolution:

- **`'replace'`** — all records are written atomically via `bulkWrite`. Overwrites existing keys and inserts new ones. Does not delete records absent from the payload.
- **`'merge'`** — each record is checked individually; new keys are inserted, existing keys are skipped and reported in `result.skipped`. Merge is not fully atomic per operation because each record must be read before deciding.
- **`'restore'`** — only collections present in `payload.data` are targeted. For each target collection, **all existing keys are read first**, then a single operation array is built: one `delete` for each existing key + one `put` for each valid payload record. The entire array is sent to `adapter.transaction()` in one call — **fully atomic**. Invalid records (missing key) are reported in `errors` (reason: `'missing-key'`) and excluded from the write; they do NOT abort the transaction. Result includes `deleted: number` (count of records removed) and `imported: number` (count of valid records written).

```js
const result = await service.importData(
  { data: { users: [{ id: 'u1', name: 'Alice' }] } },
  'merge'
)
// result => { imported: 1, skipped: [], errors: [] }

// Restore example: replace entire 'users' collection with payload
const restoreResult = await service.importData(
  { data: { users: [{ id: 'u1', name: 'Alice' }, { id: 'u2', name: 'Bob' }] } },
  'restore'
)
// restoreResult => { imported: 2, skipped: [], deleted: <count of previously existing users>, errors: [] }
```

## Events

| Event | When | Data |
|---|---|---|
| `storage:ready` | Published after the adapter successfully opens and all configured stores are created or migrated. | `{ version: string, stores: string[] }` |

## Errors Reference

| Code | Type | When |
|---|---|---|
| `STORE_NOT_FOUND` | operational | Collection/store name is not in the configured stores list (read, write, delete, query, count, bulkWrite, bulkDelete, transaction, importData) |
| `RECORD_NOT_FOUND` | operational | Record not found by key (read) |
| `ADAPTER_NOT_OPEN` | operational | Adapter has been closed or destroyed; any operation after that fails |
| `ADAPTER_NOT_CONFIGURED` | startup | The adapter identifier in `prepareContext.config.adapter` is not found in the plugin's `ADAPTERS` map during `prepare()` — e.g. an unknown adapter name was supplied through `bootstrap.json` under `adapters.storage` |
| `QUOTA_EXCEEDED` | operational | Storage quota exceeded (write, bulkWrite, transaction) |
| `STORAGE_UNAVAILABLE` | critical / startup | Thrown by the adapter as `critical` when IndexedDB is unavailable (private browsing, disabled). When this error surfaces through `prepare()` during plugin startup, it is re-wrapped as `startup` type (see `index.js`). |
| `TRANSACTION_FAILED` | operational | A transaction operation fails (invalid method, constraint violation) |
| `IMPORT_INVALID_PAYLOAD` | operational | Import payload is null, not an object, or missing the `data` property |
| `SERVICE_UNAVAILABLE` | operational | Storage service has been deactivated (any method) |

## Config

The adapter name is configured in `bootstrap.json` → `adapters.storage` and delivered to the plugin as `prepareContext.config.adapter`. It is resolved by the Core, not declared in the plugin's own config. Plugin-level config lives under `config.<pluginName>` in `bootstrap.json` (the `plugins` array entry only holds `name`, `version`, and `path`).

Plugin-level config includes:

| Key | Type | Required | Default |
|---|---|---|---|
| `databaseName` | string | No | `pey-app-db` |
| `schemaVersion` | number | No | `1` |
| `stores` | array | No | `[]` |
| `stores[].name` | string | Yes (if store defined) | — |
| `stores[].keyPath` | string | Yes (if store defined) | — |
| `stores[].autoIncrement` | boolean | No | `false` |
| `stores[].indexes` | array | No | `[]` |

Each `indexes` entry requires:
- `name` — index name (used in range query criteria)
- `field` — record field this index is on
- `unique` — whether duplicate values are disallowed
Each store entry in `stores` requires:
- `name` — collection/store name used in all service methods
- `keyPath` — field name used as the primary key
- `autoIncrement` — whether keys are auto-generated when missing
- `indexes` (optional) — secondary indexes, each with `name`, `field`, and `unique`

## Business Rules

1. **Store validation:** Every service method validates the collection name against the configured stores list before delegating to the adapter. Unknown collections are rejected immediately with `STORE_NOT_FOUND`.
2. **Import replace mode:** Records are written atomically via the adapter's `bulkWrite`. Existing records with matching keys are overwritten; new records are inserted. Records absent from the payload are not deleted.
3. **Import merge mode:** Each record is checked individually. If the key already exists, the record is skipped and added to `result.skipped`. If the key is new, it is inserted and counted in `result.imported`. Records without a valid key (undefined/null) are added to `result.errors`. Merge is not fully atomic — each record is read before the decision to write or skip.
4. **Import restore mode:** Only collections present in `payload.data` are targeted. For each, all existing records are read via `query(collection, {})`, then a single operation array (one `delete` per existing key + one `put` per valid payload record) is sent to `adapter.transaction()` atomically. Records with missing keys are reported in `errors` and excluded from writes. All operations across all target collections execute in one transaction.
5. **Transaction rollback:** Operations are applied to snapshots. If any operation fails, the snapshot is discarded and no changes are committed.
6. **Restore scale limit:** `restore` reads all existing keys into memory before building operations. Suitable for moderate stores (roughly < 50K records — unconfirmed, no benchmark); very large stores may hit IndexedDB transaction limits.
7. **Deactivated service:** After `onDeactivated` or `onShutdown` is called, all service methods return `SERVICE_UNAVAILABLE` instead of executing.
8. **Encryption:** No-op in v0.4.0. The design allows future transparent encryption without contract change.
9. **Export format version:** Export metadata carries `EXPORT_FORMAT_VERSION` (`1.0.0`) independently of the plugin version or database schema version.

## Constraints

- **No business-domain awareness:** This plugin is fully schema-agnostic. It has no knowledge of transactions, categories, or any business entities — only generic collections.
- **No file/blob handling:** Large binary payloads must not be pushed through the read/write path. File handling is handled by a dedicated capability.
- **No connection health-check:** Not applicable for local, in-browser IndexedDB.
- **No remote synchronization:** This plugin operates only on local storage.
- **No authentication:** This plugin does not handle identity or access control.
- **Restore memory footprint:** The `'restore'` mode reads ALL existing keys into memory before building the operation array. This is suitable for moderate-sized stores (roughly < 50K records — unconfirmed, no benchmark); very large stores may hit IndexedDB transaction limits or cause memory pressure.

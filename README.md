# pey.storage

[![AI](https://img.shields.io/badge/Built%20with-AI-blueviolet)](#)
[![version](https://img.shields.io/badge/version-0.5.0-blue.svg)](#)
[![license](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Bonyan Architecture](https://img.shields.io/badge/bonyan-0.11-56c3bf)](https://github.com/barnevis/bonyan)

Generic key-value storage plugin backed by a swappable adapter (currently IndexedDB).

## Purpose

Provides CRUD, query, bulk, transaction, and import/export operations through a single service. Swapping the underlying storage engine requires configuration changes only — no code changes.

## Quick Start

Register the adapter and plugin in `bootstrap.json`:

```json
{
  "adapters": {
    "storage": "IndexedDBAdapter"
  },
  "plugins": [
    {
      "name": "pey.storage",
      "version": "0.5.0",
      "path": "plugins/pey.storage"
    }
  ],
  "config": {
    "pey.storage": {
      "databaseName": "pey-app-db",
      "stores": [
        { "name": "users", "keyPath": "id" }
      ]
    }
  }
}
```

Use the service:

```js
const service = core.registry.get('pey.storage.service')
const user = await service.read('users', 'u1')
await service.write('users', { id: 'u1', name: 'Alice' })
```

## Configuration

The active adapter name is set in `bootstrap.json` under `adapters.storage` and reaches the plugin as `prepareContext.config.adapter`. Plugin configuration is declared under `config.<pluginName>` (not inside the `plugins` array entry — that section only holds `name`, `version`, and `path`).

Plugin-level config only includes:

| Key | Type | Required | Default |
|---|---|---|---|
| `databaseName` | string | No | `pey-app-db` |
| `schemaVersion` | number | No | `1` |
| `stores` | array | No | `[]` |

Each store entry requires:
- `name` — collection/store name used in all service methods
- `keyPath` — field name used as the primary key
- `autoIncrement` (optional) — whether keys are auto-generated when missing
- `indexes` (optional) — secondary indexes, each with `name`, `field`, and `unique`

## Structure

```
pey.storage/
├── manifest.json          — Plugin identity, provides, events, config
├── index.js               — Entry point: prepare(), activate(), lifecycle hooks
├── lib/
│   ├── constants.js       — Plugin name, version, error codes
│   ├── error.js           — Error builders
│   └── storage-service.js — Service: CRUD, bulk, transaction, import/export
├── adapters/
│   ├── indexeddb-adapter.js   — IndexedDB implementation
│   └── in-memory-adapter.js   — Test substitute
└── tests/
    ├── adapters/            — Adapter contract tests
    └── service/             — Service tests
```

## Documentation

Full reference: [docs/reference.md](docs/reference.md)

- Public API
- Events
- Errors reference
- Config options
- Business rules
- Constraints

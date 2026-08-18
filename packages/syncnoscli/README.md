# SyncNos CLI

[简体中文](README.zh-CN.md)

SyncNos CLI is the on-demand local SQLite companion for SyncNos. It does not run as a daemon, sync data remotely, or stay resident after a command/native-host session ends.

```bash
npm install -g @chiimagnus/syncnoscli
```

Requires Node.js 22 or newer. Local Database paths, migration authority, and recovery rules are maintained in the repository documentation linked below.

Every CLI invocation starts on demand and exits when the command finishes. Browser Native Messaging starts the packaged Host only when needed and the Host exits when its browser pipe closes. Data commands are read-only: they never create, migrate, delete, or modify the database. `doctor` is read-only unless `--fix` is explicitly supplied; `--fix` is limited to proven SyncNos-owned registration/permission repair.

```bash
syncnoscli doctor [--fix]
syncnoscli conversations list [--cursor <cursor>] [--source <source>] [--site <site>] [--page-size <1-200>] [--format json|table]
syncnoscli conversations get <id>
syncnoscli stats
syncnoscli search <query> [--cursor <cursor>] [--source <source>] [--site <site>] [--sort best|recent] [--page-size <1-50>] [--format json|table]
```

Successful data commands print a versioned JSON envelope by default. `--format table` is available for list and search when reading in a terminal; errors always remain structured JSON with a nonzero exit code. The CLI does not accept SQL, write, delete, provider-sync, remote/vector-search, or database-path commands.

The CLI package has its own semantic version; it is not required to equal the WebClipper/WXT version. Compatibility is defined by the canonical Native Host protocol/schema contract shipped from the same source commit.

Architecture and storage authority: [docs/storage.md](https://github.com/chiimagnus/SyncNos/blob/main/docs/storage.md). Local development and packaging: [docs/cli/development.md](https://github.com/chiimagnus/SyncNos/blob/main/docs/cli/development.md). Installation, Native Host, sandbox, and recovery guidance: [docs/cli/local-database.md](https://github.com/chiimagnus/SyncNos/blob/main/docs/cli/local-database.md).

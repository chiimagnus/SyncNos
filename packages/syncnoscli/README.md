# SyncNos CLI

SyncNos CLI is the on-demand local SQLite companion for SyncNos. It does not run as a daemon.

```bash
npm install -g @chiimagnus/syncnoscli
```

给 AI 的提示词：`请你安装SyncNos CLI：npm install -g @chiimagnus/syncnoscli`

Requires Node.js 22 or newer. Once Local data is enabled, the database uses the fixed per-user path: `~/.syncnoscli/syncnos.sqlite` on macOS/Linux and `%USERPROFILE%\.syncnoscli\syncnos.sqlite` on Windows.

Every invocation starts on demand and exits when the command finishes. Data commands are read-only: they never create, migrate, delete, or modify the database.

```bash
syncnoscli doctor [--fix]
syncnoscli conversations list [--cursor <cursor>] [--source <source>] [--site <site>] [--page-size <1-200>] [--format json|table]
syncnoscli conversations get <id>
syncnoscli stats
syncnoscli search <query> [--cursor <cursor>] [--source <source>] [--site <site>] [--sort best|recent] [--page-size <1-200>] [--format json|table]
```

Successful data commands print a versioned JSON envelope by default. `--format table` is available for list and search when reading in a terminal; errors always remain structured JSON with a nonzero exit code. The CLI does not accept SQL, write, delete, provider-sync, or database-path commands.

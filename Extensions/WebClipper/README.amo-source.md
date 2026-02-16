# SyncNos WebClipper (AMO Source Package)

This file describes how to build the submitted Firefox add-on package (`.xpi`) from the source package, as required by AMO reviewers.

## What This Source Package Contains

- Human-readable source files under `src/` (not transpiled / concatenated / minified)
- Build scripts under `scripts/`
- `package.json` and `package-lock.json` for reproducible installs
- Third-party browser bundle (Markdown renderer) under `src/vendor/` with its license file

## Requirements

- OS: macOS / Linux / Windows
- Node.js: tested with `v25.1.0` (recommended: latest Node.js)
- npm: tested with `11.6.2`
- `zip` CLI:
  - macOS: preinstalled
  - Ubuntu/Debian: `sudo apt-get install zip`

## Install

```bash
npm --prefix Extensions/WebClipper install
```

## Build Firefox XPI (Release Package)

This creates:

- `Extensions/WebClipper/dist-firefox/` (loadable folder)
- `Extensions/WebClipper/SyncNos-WebClipper-firefox.xpi` (submission package)

```bash
npm --prefix Extensions/WebClipper run build:firefox
```

Optional (override AMO add-on id / min version):

```bash
FIREFOX_EXTENSION_ID="your-addon-id@your.domain" FIREFOX_MIN_VERSION="142.0" \
  npm --prefix Extensions/WebClipper run build:firefox
```

Notes:

- The build uses `terser` to minify/mangle the final bundles in `dist-firefox/`.
- Firefox compatibility: the built manifest uses `background.scripts` (Firefox) and injects `browser_specific_settings.gecko.data_collection_permissions` (required by AMO).

## Build Chrome/Chromium Dist (Optional)

```bash
npm --prefix Extensions/WebClipper run build
```


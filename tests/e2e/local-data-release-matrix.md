# Local Data release evidence matrix

This file is maintainer release evidence, not user documentation and not npm publish authorization. Only store/officially installed browser builds may fill formal desktop rows. Dev IDs, unpacked builds, repository variables, fake Hosts, and CI mocks are not formal browser evidence.

For a formal desktop row, record the actual installed `runtime.id` (Chromium) or Gecko ID (Firefox), OS/browser versions, UTC observation date, and every check below. Edge additionally requires owner confirmation that the Partner Center product GUID maps to the observed public runtime ID; the GUID itself is not the runtime ID and is not required in this repository. Windows rows must observe the packaged PE shim and verify both one-shot `sendNativeMessage` and `connectNative` disconnect leave no shim/Node child.

Strict Snap/Flatpak observations belong only in `strictSandboxLinux`; `unsupported_strict_sandbox` documents the unsupported portal boundary and is never a formal connection pass.

<!-- syncnos-local-data-release-evidence:start -->
```json
{
  "schemaVersion": 1,
  "releaseReady": false,
  "releaseCommit": null,
  "automatic": {
    "gate": {
      "command": "npm run gate",
      "outcome": "pending",
      "observedAt": null,
      "commitSha": null
    },
    "safariCheck": {
      "command": "npm run check:safari",
      "outcome": "pending",
      "observedAt": null,
      "commitSha": null
    },
    "threeOsCliPackedInstall": {
      "workflow": "syncnoscli-ci.yml",
      "outcome": "pending",
      "observedAt": null,
      "commitSha": null,
      "runUrl": null,
      "checks": {
        "ubuntu": "pending",
        "macos": "pending",
        "windows": "pending"
      }
    },
    "finalBrowserArtifactContract": {
      "command": "npm run build:release-contract-fixtures && npm run test -- tests/build/native-messaging-release-contract.test.ts",
      "outcome": "pending",
      "observedAt": null,
      "commitSha": null
    }
  },
  "desktop": [
    {
      "os": "macos",
      "browser": "chrome",
      "osVersion": null,
      "browserVersion": null,
      "observedAt": null,
      "outcome": "pending",
      "extensionIdentity": null,
      "checks": {
        "globalInstallDoctor": "pending",
        "firstMigration": "pending",
        "secondBrowserExplicitJoin": "pending",
        "captureDeleteMapping": "pending",
        "imageCommentBackup": "pending",
        "cliJsonSearch": "pending",
        "focusRefresh": "pending",
        "extensionUninstallReinstall": "pending",
        "npmUninstallReinstall": "pending"
      }
    },
    {
      "os": "macos",
      "browser": "edge",
      "osVersion": null,
      "browserVersion": null,
      "observedAt": null,
      "outcome": "pending",
      "extensionIdentity": null,
      "partnerCenterProductMappingConfirmed": null,
      "checks": {
        "globalInstallDoctor": "pending",
        "firstMigration": "pending",
        "secondBrowserExplicitJoin": "pending",
        "captureDeleteMapping": "pending",
        "imageCommentBackup": "pending",
        "cliJsonSearch": "pending",
        "focusRefresh": "pending",
        "extensionUninstallReinstall": "pending",
        "npmUninstallReinstall": "pending"
      }
    },
    {
      "os": "macos",
      "browser": "firefox",
      "osVersion": null,
      "browserVersion": null,
      "observedAt": null,
      "outcome": "pending",
      "extensionIdentity": null,
      "checks": {
        "globalInstallDoctor": "pending",
        "firstMigration": "pending",
        "secondBrowserExplicitJoin": "pending",
        "captureDeleteMapping": "pending",
        "imageCommentBackup": "pending",
        "cliJsonSearch": "pending",
        "focusRefresh": "pending",
        "extensionUninstallReinstall": "pending",
        "npmUninstallReinstall": "pending"
      }
    },
    {
      "os": "linux",
      "browser": "chrome",
      "osVersion": null,
      "browserVersion": null,
      "observedAt": null,
      "outcome": "pending",
      "extensionIdentity": null,
      "checks": {
        "globalInstallDoctor": "pending",
        "firstMigration": "pending",
        "secondBrowserExplicitJoin": "pending",
        "captureDeleteMapping": "pending",
        "imageCommentBackup": "pending",
        "cliJsonSearch": "pending",
        "focusRefresh": "pending",
        "extensionUninstallReinstall": "pending",
        "npmUninstallReinstall": "pending"
      }
    },
    {
      "os": "linux",
      "browser": "edge",
      "osVersion": null,
      "browserVersion": null,
      "observedAt": null,
      "outcome": "pending",
      "extensionIdentity": null,
      "partnerCenterProductMappingConfirmed": null,
      "checks": {
        "globalInstallDoctor": "pending",
        "firstMigration": "pending",
        "secondBrowserExplicitJoin": "pending",
        "captureDeleteMapping": "pending",
        "imageCommentBackup": "pending",
        "cliJsonSearch": "pending",
        "focusRefresh": "pending",
        "extensionUninstallReinstall": "pending",
        "npmUninstallReinstall": "pending"
      }
    },
    {
      "os": "linux",
      "browser": "firefox",
      "osVersion": null,
      "browserVersion": null,
      "observedAt": null,
      "outcome": "pending",
      "extensionIdentity": null,
      "checks": {
        "globalInstallDoctor": "pending",
        "firstMigration": "pending",
        "secondBrowserExplicitJoin": "pending",
        "captureDeleteMapping": "pending",
        "imageCommentBackup": "pending",
        "cliJsonSearch": "pending",
        "focusRefresh": "pending",
        "extensionUninstallReinstall": "pending",
        "npmUninstallReinstall": "pending"
      }
    },
    {
      "os": "windows",
      "browser": "chrome",
      "osVersion": null,
      "browserVersion": null,
      "observedAt": null,
      "outcome": "pending",
      "extensionIdentity": null,
      "windowsHost": {
        "launcherKind": "pending",
        "sendNativeMessageNoResidualProcess": "pending",
        "connectNativeDisconnectNoResidualProcess": "pending"
      },
      "checks": {
        "globalInstallDoctor": "pending",
        "firstMigration": "pending",
        "secondBrowserExplicitJoin": "pending",
        "captureDeleteMapping": "pending",
        "imageCommentBackup": "pending",
        "cliJsonSearch": "pending",
        "focusRefresh": "pending",
        "extensionUninstallReinstall": "pending",
        "npmUninstallReinstall": "pending"
      }
    },
    {
      "os": "windows",
      "browser": "edge",
      "osVersion": null,
      "browserVersion": null,
      "observedAt": null,
      "outcome": "pending",
      "extensionIdentity": null,
      "partnerCenterProductMappingConfirmed": null,
      "windowsHost": {
        "launcherKind": "pending",
        "sendNativeMessageNoResidualProcess": "pending",
        "connectNativeDisconnectNoResidualProcess": "pending"
      },
      "checks": {
        "globalInstallDoctor": "pending",
        "firstMigration": "pending",
        "secondBrowserExplicitJoin": "pending",
        "captureDeleteMapping": "pending",
        "imageCommentBackup": "pending",
        "cliJsonSearch": "pending",
        "focusRefresh": "pending",
        "extensionUninstallReinstall": "pending",
        "npmUninstallReinstall": "pending"
      }
    },
    {
      "os": "windows",
      "browser": "firefox",
      "osVersion": null,
      "browserVersion": null,
      "observedAt": null,
      "outcome": "pending",
      "extensionIdentity": null,
      "windowsHost": {
        "launcherKind": "pending",
        "sendNativeMessageNoResidualProcess": "pending",
        "connectNativeDisconnectNoResidualProcess": "pending"
      },
      "checks": {
        "globalInstallDoctor": "pending",
        "firstMigration": "pending",
        "secondBrowserExplicitJoin": "pending",
        "captureDeleteMapping": "pending",
        "imageCommentBackup": "pending",
        "cliJsonSearch": "pending",
        "focusRefresh": "pending",
        "extensionUninstallReinstall": "pending",
        "npmUninstallReinstall": "pending"
      }
    }
  ],
  "safari": {
    "osVersion": null,
    "browserVersion": null,
    "observedAt": null,
    "outcome": "pending",
    "checks": {
      "idbBaseline": "pending",
      "nativePermissionAbsent": "pending",
      "localDatabaseActionAbsent": "pending",
      "installHelpAbsent": "pending"
    }
  },
  "regressions": [
    { "name": "host_missing", "outcome": "pending", "observedAt": null, "notes": null },
    { "name": "damaged_registration", "outcome": "pending", "observedAt": null, "notes": null },
    { "name": "lock_busy", "outcome": "pending", "observedAt": null, "notes": null },
    { "name": "interrupt_recovery", "outcome": "pending", "observedAt": null, "notes": null },
    { "name": "short_cjk_query", "outcome": "pending", "observedAt": null, "notes": null }
  ],
  "strictSandboxLinux": {
    "distribution": null,
    "browser": null,
    "browserVersion": null,
    "observedAt": null,
    "outcome": "pending",
    "notes": null
  }
}
```
<!-- syncnos-local-data-release-evidence:end -->

`releaseReady` must stay `false` while any automatic requirement, formal desktop, Safari, or regression evidence is pending/failed. Before setting automatic evidence to `pass`, set `releaseCommit` to the exact audited commit and bind every automatic record to that same commit. `threeOsCliPackedInstall` may only be marked pass from the canonical `syncnoscli-ci.yml` GitHub Actions run for that commit, with Ubuntu, macOS, and Windows all passing; a local run, repository variable, or single-platform result is not equivalent evidence. Changing `releaseReady` to `true` is not npm publish authorization.

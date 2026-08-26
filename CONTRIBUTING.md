# Contributing to SyncNos WebClipper

SyncNos welcomes focused bug fixes, site adapters, documentation improvements, and product changes that preserve the repository's existing contracts.

This repository maintains **SyncNos WebClipper only**. iOS, macOS, and CLI work belongs in their own repositories unless the task explicitly changes an integration contract owned here.

## Before you start

1. Search existing [issues](https://github.com/chiimagnus/SyncNos/issues) and [pull requests](https://github.com/chiimagnus/SyncNos/pulls) first.
2. Read [`AGENTS.md`](AGENTS.md) before changing code. It is the source of truth for dependency direction, product invariants, commit discipline, and validation commands.
3. Start from [`docs/overview.md`](docs/overview.md) for long-lived product and data-model documentation.
4. Discuss non-trivial behavior changes before investing in an implementation. New site adapters/integrations, storage or schema changes, permission changes, migrations, and release behavior should normally have an agreed issue first. Small documentation, typo, and clearly mechanical maintenance changes may go directly to a PR.
5. Keep the change narrow. Do not mix unrelated cleanup, formatting, localization, or refactors into a functional patch.

A patch can be technically correct and still be declined if it breaks a product invariant, adds an unwanted compatibility path, or expands scope beyond what was agreed.

## Local setup

Use Node.js 22 when possible so local behavior matches GitHub Actions.

```bash
npm ci
npm run dev
```

Other supported development targets are available when the change affects them:

```bash
npm run dev:firefox
npm run dev:zen
npm run dev:safari
```

For Safari/Xcode integration work, use the repository script rather than maintaining generated project output by hand:

```bash
npm run setup:safari:xcode
```

## Architecture and source of truth

Do not duplicate architectural rules here. Follow [`AGENTS.md`](AGENTS.md), including the dependency direction between `ui`, `viewmodels`, `services`, `platform`, `collectors`, and `entrypoints`.

Long-lived product facts belong under [`docs/overview.md`](docs/overview.md) and its linked pages. Version numbers, permissions, schemas, migrations, and other fast-drifting facts should stay in their canonical source file or one canonical document; other docs should link to them.

When documentation and implementation disagree, verify behavior from code and repository scripts first, then correct the stale documentation in the same PR.

## Opening an issue

### Bug reports

A useful bug report should make the failure reproducible and distinguish a product defect from a site change or environment problem. Include:

- a short description of the failure;
- affected surface or site;
- exact reproduction steps;
- expected and actual behavior;
- OS, browser + version, and SyncNos version or commit;
- whether existing local data was modified, lost, or left intact;
- screenshots, recordings, or logs when they materially shorten diagnosis.

Redact private conversation content, account identifiers, cookies, access tokens, OAuth secrets, API keys, and exported backup data before attaching evidence.

### Feature and site-support requests

Describe the user problem before prescribing an implementation. Explain:

- why the capability belongs in SyncNos;
- the intended workflow and default behavior;
- scope and explicit non-goals;
- affected browsers/sites/targets;
- any storage, permission, privacy, migration, or compatibility implications.

For site adapters, identify which page type is in scope and what content must be captured. Avoid asking one issue to cover an open-ended family of unrelated sites.

## Commits

Use **Conventional Commits**, as required by [`AGENTS.md`](AGENTS.md). A commit should represent one verifiable concern.

Typical prefixes include:

- `feat:` — user-visible capability;
- `fix:` — defect correction;
- `refactor:` — behavior-preserving structural change;
- `test:` — test-only change;
- `docs:` — documentation-only change;
- `chore:` — repository maintenance;
- `ci:` / `build:` — automation or build-system change.

Scopes are optional when they add useful context, for example `fix(collectors): ...` or `feat(settings): ...`.

Write a meaningful summary. Do not use placeholder messages such as `-`. Version-only messages should be reserved for explicit release/version automation, not ordinary development commits. Add a commit body when the reason, compatibility decision, or tradeoff is not obvious from the diff.

Examples:

```text
fix(collectors): preserve complete virtualized chat capture
feat(settings): add per-site capture toggle
docs: clarify contributor validation workflow
```

Chinese or English summaries are both acceptable; clarity and auditability matter more than language.

## Pull requests

A PR should be understandable without reconstructing the author's local context.

- Link the agreed issue for non-trivial behavior changes. Documentation and clearly mechanical maintenance may use `N/A` with a short reason.
- Fill every applicable section of the PR template. Use `N/A` instead of silently deleting a required explanation.
- Explain the user-visible or architectural reason for the change, not only the files edited.
- Call out deliberate non-goals, tradeoffs, migrations, permission changes, and compatibility decisions.
- Update any canonical documentation made stale by the patch.
- Remove replaced production paths, dead compatibility branches, and outdated test assumptions instead of leaving parallel implementations behind.
- For visual changes, attach before/after screenshots or a short recording using comparable states.
- Use a draft PR while the patch is not ready for review.

Keep the branch current with `main` and resolve conflicts before requesting final review.

## Validation before review

The repository scripts define the acceptance bar:

| Change | Required local validation |
| --- | --- |
| Normal code change | `npm run compile` and `npm run test` during development |
| Code PR ready for review | `npm run gate:ci` |
| Documentation / GitHub-template-only change | `gate:ci` may be `N/A` when no runtime, build, or dependency files changed; state the reason in the PR |
| Production build, manifest, permission, packaging, or release change | `npm run gate` |
| Browser/site-specific behavior | Exercise the affected browser/site path manually; run the relevant `dev:*` / build command when applicable |
| Visual behavior | Record the affected state before/after or provide equivalent screenshots |

GitHub Actions currently runs `npm ci` and `npm run gate:ci` for non-draft PRs that touch WebClipper code paths. That CI result does **not** replace a required local production build or manual browser validation.

When a change touches a product invariant in [`AGENTS.md`](AGENTS.md), include the relevant boundary scan or targeted test evidence in the PR.

## Data and privacy changes

SyncNos is local-first, so changes involving IndexedDB, backup/restore, sync mappings, OAuth, cached images, permissions, or migrations need explicit failure-path review. State what happens when an external target fails and how existing local data remains recoverable.

Do not commit real credentials, private user content, browser profiles, generated backup archives containing personal data, or captured session material.

## License

Contributions accepted into this repository are distributed under the repository's [GNU Affero General Public License v3](LICENSE.APGLv3).

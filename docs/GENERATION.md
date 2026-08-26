# Documentation Metadata

This file records the source baseline and ownership rules used for the long-term documentation set. It is metadata, not another product guide.

## Repository State

| Field | Value |
| --- | --- |
| Repository | `SyncNos-Webclipper` (origin: `chiimagnus/SyncNos`) |
| Commit hash | `118fa47265787d7dea546e15b2d20f959bf7f1e1` |
| Generated at | `2026-08-26` |
| Canonical entry | `docs/overview.md` |
| Method | Neat Freak full-repository documentation audit |

`Commit hash` is the code/documentation baseline that was audited before this documentation-only branch started. Documentation commits made during the cleanup intentionally do not replace that baseline.

## Audited Scope

The audit covered all tracked Markdown with a long-term repository role:

- `README.md` and `README.zh-CN.md`;
- `PRIVACY.md`;
- root and nested `AGENTS.md`;
- `docs/**/*.md`;
- `.github/PULL_REQUEST_TEMPLATE.md`;
- the former `.github/guide/**/*.md` integration guides and their documentation-only screenshots.

Source facts were checked against CodeGraph plus the relevant manifest/configuration, package scripts, tests, workflows, OAuth/sync services, backup logic, and Safari tooling.

## Current Page Set

| Responsibility | Canonical owner |
| --- | --- |
| Product entry, installation, supported sources, output targets | `README.md`, `README.zh-CN.md` |
| Privacy, permissions, credentials, network destinations | `PRIVACY.md` |
| Long-term documentation navigation and fact ownership | `docs/overview.md` |
| Contribution, Issue, commit, PR, and validation workflow | `docs/CONTRIBUTING.md` |
| Local data, backup, and recovery invariants | `docs/storage.md` |
| Feishu OAuth / DocX setup | `docs/feishu-setup.md` |
| Obsidian Local REST API setup | `docs/obsidian-setup.md` |
| Failure diagnosis | `docs/troubleshooting.md` |
| Repository architecture and product invariants | `AGENTS.md` |
| UI-only non-derivable constraints | `src/ui/AGENTS.md` |
| PR submission checklist | `.github/PULL_REQUEST_TEMPLATE.md` |

## Ownership Policy

- Code, CodeGraph, manifests, workflows, tests, and configuration files own structural or implementation facts that can be derived directly.
- Long-term Markdown keeps user-facing behavior, intent, invariants, operational setup, recovery semantics, and diagnostic knowledge that would otherwise be difficult to reconstruct safely.
- A fact should have one canonical long-term owner. Other pages link to that owner instead of maintaining a second editable copy.
- Do not add durable copies of complete storage-key lists, object-store inventories, design-token inventories, versions, generated directory trees, or similar high-drift implementation details.

## Cleanup Result

The previous Feishu and Obsidian bilingual guides under `.github/guide/` were merged into the canonical `docs/` integration pages and removed. Their Obsidian third-party UI screenshots were also removed because the external plugin UI is not a stable repository contract. `docs/configuration.md` was removed after its durable content was assigned to the existing contribution, architecture, and source-of-truth owners.

No unresolved product-policy decision was inferred from source code. External provider UI and policies can change independently of this repository; the integration pages therefore document only the repository-controlled setup contract and link outward where appropriate.

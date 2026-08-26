## Related issue

Closes #

<!-- Link the agreed issue for non-trivial behavior changes. Use N/A with a short reason only for documentation or clearly mechanical maintenance. -->

## Why

<!-- What user problem, regression, or repository contract does this change address? Explain why the change belongs in SyncNos. -->

## What changed

<!-- Summarize the implementation. Call out anything non-obvious in the diff. -->

## Scope and non-goals

<!-- State what this PR intentionally does not change. This is especially important for site adapters, migrations, compatibility work, and large refactors. -->

## Validation

<!-- Report real results; do not replace local validation with a green CI badge. -->

- `npm run gate:ci`: PASS / NOT RUN —
- `npm run gate`: PASS / N/A — required for production build, manifest, permission, packaging, or release changes
- Targeted tests or boundary scans:

Manual validation:

| Browser / surface | Scenario | Result |
| --- | --- | --- |
|  |  |  |

## Architecture, data, and permissions

<!-- Reference AGENTS.md invariants when relevant. Write N/A where a category is truly unaffected. -->

- Affected layers / dependency boundaries:
- Local storage, schema, backup/restore, or migration impact:
- Browser permission or external-network impact:
- Failure path: what happens to existing local data if capture/sync/external services fail?

## UI evidence

<!-- Visual change: attach comparable before/after screenshots or a short recording. Delete this section only when nothing visual changed. -->

## Risks and tradeoffs

<!-- Deliberate tradeoffs, compatibility decisions, uncertain edges, or follow-up work. "None" is acceptable when justified. -->

## Documentation and cleanup

- [ ] Canonical documentation made stale by this change is updated, or no documentation change is required.
- [ ] Replaced production paths, dead compatibility branches, and outdated test assumptions are removed, or none were introduced/replaced.
- [ ] I reviewed the final diff from top to bottom before requesting review.

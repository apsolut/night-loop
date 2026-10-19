# 013 - CLI bundle budget raised from 32 KiB to 48 KiB

Date: 2026-10-19
Milestone: M8

## Decision
`bun run perf` now allows a 48 KiB minified CLI bundle. The pre-M8 bundle was 18.8 KiB; the
provider adapters, the turn-mode supervisor, doctor login checks, and the receipt additions bring
it to 34.4 KiB, all first-party TypeScript with zero new dependencies.

## Why
The budget exists to catch accidental dependency bloat in a CLI that must start fast inside a
Stop hook. It is advisory-tier evidence (never a revert trigger) and was sized for a Claude-only
binary. Shrinking the adapters to fit would trade clarity for a limit that no longer measures
what it was set for.

## Rejected
- Splitting providers into lazily imported chunks: more files on the control-plane surface for
  a saving that does not change hook latency.

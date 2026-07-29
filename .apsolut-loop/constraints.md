# Constraints

Reload at the start of every plan. Human feedback at checkpoints appends here, dated.

- Smallest blast radius. Fewest files that satisfy the milestone.
- No new dependencies without writing why in `.apsolut-loop/decisions/` first.
- Every "data persisted" claim is asserted against the DB. Never assume a write succeeded.
- Never delete or weaken a test to go green. Quarantining a flaky spec (out of the hard tier
  until determinized) is allowed and is not weakening.
- Only revert on a reproducible red. A non-reproducible red is flake: quarantine it, do not
  revert and do not diagnose against it.
- E2e tests must be deterministic before they gate: wait on state not time (no `waitForTimeout`;
  use `expect.poll` / `toPass` / element waits), fixed clock, seeded RNG, animations disabled,
  fonts bundled with `document.fonts.ready` awaited, fixed viewport, no real network.
- Gates (auth, billing, payment, stripe, .env, migration, schema) are hard stops enforced by the
  PreToolUse hook. The loop halts; a human approves.
- Architectural choices get a one-line entry in `.apsolut-loop/decisions/`.
- No em dashes in any generated prose, docs, or comments.

## Project conventions (fill before first run)
- Frontend framework and charting lib: <FILL>
- Naming and file structure: <FILL>

## Appended by human feedback
<!-- checkpoint feedback lands here, dated -->

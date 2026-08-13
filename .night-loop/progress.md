# Progress Ledger

Update after every accepted milestone. This is how the next session knows where to resume.
The SessionStart hook injects this file into each session.

## Done
- M0 Harness, accepted by night-loop-judge, replacement commit `caee5a9`
- M1 Claude command surface, CERTIFIED by night-loop-judge on 2026-08-14 after two
  adversarial rejections drove five new discriminating e2e tests (workspace default vs
  contract inheritance, status coverage, contract-before-supervisor ordering, no-contract
  fast failure, resume no-upgrade). Judge evidence: 15 consecutive green e2e runs, mutation
  probes red on every criterion carrier. Flake root cause fixed in withFixtureRepo
  (bounded EBUSY retry for Windows cwd-handle release).

## Doing
- M2 Native Claude supervisor, pending independent certification

## Next
- M3 Durable resume and verified halt, pending independent certification
- M4 Unattended safety policy, pending independent certification
- M5 Portable install and CI, pending independent certification
- M6 Cross-OS matrix certification (hard-block until external runners execute)
- M7 Live Claude smoke (hard-block until test authentication is approved)

## Blocked / needs human
<!-- gated milestones and decisions, with the risk surface that could not be auto-verified -->

## Deferred
- Multi-provider adapters for Codex, Grok, and Agy
- Multi-agent delegation, worktree orchestration, multiplexing, and provider competition
- Omni and Observator concepts beyond the event logging required by the single-agent supervisor

## Discovered (from triage)
- 2026-08-13: The prior M1 tracked-workspace contract was invalidated. `.apsolut-agents/` must remain local and ignored.
- 2026-08-13: `.apsolut-agents/` is private contributor tooling used to build NIGHT LOOP, not product scope. The former M1-M5 multi-agent chain was replaced before implementation.

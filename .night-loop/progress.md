# Progress Ledger

Update after every accepted milestone. This is how the next session knows where to resume.
The SessionStart hook injects this file into each session.

## Done
- M0 Harness, accepted by night-loop-judge, replacement commit `caee5a9`

## Doing
- M1 Local apsolut-agents workspace

## Next
- M2 Cross-platform workspace core
- M3 Cross-platform worktrees
- M4 Provider adapters
- M5 Bounded delegation
- M6 Native NIGHT LOOP supervisor
- M7 Portable install and CI
- M8 Cross-OS matrix certification (hard-block until external runners execute)
- M9 Live provider smoke (hard-block until test credentials and spend are approved)

## Blocked / needs human
<!-- gated milestones and decisions, with the risk surface that could not be auto-verified -->

## Deferred
<!-- milestones consciously postponed -->

## Discovered (from triage)
- 2026-08-13: The prior M1 tracked-workspace contract was invalidated. `.apsolut-agents/` must remain local and ignored.

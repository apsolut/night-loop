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

- M2 Native Claude supervisor, CERTIFIED by night-loop-judge on 2026-08-14 after one
  rejection drove four new carriers: PowerShell launcher to fake Claude composition,
  launcher-to-launcher state-transition parity from one seed, verbatim prompt and
  settings-path argv assertions (kills the ASCII-mangling mutants), and an Agent-lane
  gate test plus judge tool-set assertion. Judge added a pwsh-only mutation probe that
  reddened exactly the four launcher-traversing specs.

- M3 Durable resume and verified halt, CERTIFIED by night-loop-judge on 2026-08-14 after
  two rejections that surfaced and fixed two real supervisor bugs: a stop no longer lets a
  mid-backoff supervisor resurrect the run (post-backoff ACTIVE/HALTED re-check with a
  recovery_cancelled event), and HALTED or budget exhaustion now terminates the native
  session via claude stop (terminated_session event). stop now kills the recorded
  supervisor pid before returning. New carriers: stall-counter rise/bound/reset, resume
  argv carries the plugin dir, plugin manifest binds resume/loop/gate/events, and exit
  codes documented in README.

- M4 Unattended safety policy, CERTIFIED by night-loop-judge on 2026-08-14 after one
  rejection. New product path: the morning digest now carries a "Review before production
  cutover" section fed by the gate's REVIEW marker. New carriers: security-surface edit
  allowed-and-flagged into the digest, escape denial under a full contract, repository
  credential scan over git ls-files, secret-free receipt and event tape, structured
  blocked.missing_authority event, and the first specs to reach the Stop hook's shelve-
  and-continue and red-ratchet branches. Judge notes for morning review: gate's allow
  path for auth/billing files, and bypassPermissions under night-loop full.

## Doing
- M5 Portable install and CI, pending independent certification

## Next
- M3 Durable resume and verified halt, pending independent certification
- M4 Unattended safety policy, pending independent certification
- M5 Portable install and CI, pending independent certification
- M6 Cross-OS matrix certification (hard-block until external runners execute)
- M7 Live Claude smoke (hard-block until test authentication is approved)

## Blocked / needs human
<!-- gated milestones and decisions, with the risk surface that could not be auto-verified -->
- Control-plane edit: gate.ts must exempt the night-loop-judge from the Agent worker cap
  or no milestone can be certified under the default workers=1 contract. The build agent
  cannot edit its own armed control plane by design. Exact one-hunk fix and follow-ups in
  decisions/005-judge-exemption-needs-attended-gate-edit.md.

## Deferred
- Multi-provider adapters for Codex, Grok, and Agy
- Multi-agent delegation, worktree orchestration, multiplexing, and provider competition
- Omni and Observator concepts beyond the event logging required by the single-agent supervisor

## Discovered (from triage)
- 2026-08-13: The prior M1 tracked-workspace contract was invalidated. `.apsolut-agents/` must remain local and ignored.
- 2026-08-13: `.apsolut-agents/` is private contributor tooling used to build NIGHT LOOP, not product scope. The former M1-M5 multi-agent chain was replaced before implementation.

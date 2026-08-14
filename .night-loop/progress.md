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

- M5 Portable install and CI, CERTIFIED-except-C2-container-clause-shelved by
  night-loop-judge on 2026-08-14 after two rejections. First rejection: pwsh was
  undocumented and the doctor spec skipped on a stock Windows box. Second rejection:
  the README quick start still invoked pwsh, the non-skippable win32 spec ran doctor
  instead of the quick-start sequence, the carrier passed -ExecutionPolicy Bypass while
  no documented command did, and HOWTO.md contradicted the README. Final fixes: README
  quick start documents the stock powershell command verbatim (with the execution-policy
  flag explained), a win32-gated spec executes setup/start/stop exactly as published and
  binds the README literals to the executed command (README pwsh reversion probed red),
  documentation spec rejects line-leading pwsh and asserts HOWTO.md content, doctor
  emits remediation plus pathResolution.bunOnPath with green-path assertions, HOWTO.md
  install-and-troubleshooting guide added. Judge evidence: four consecutive 51-pass e2e
  runs, spec-title diff proves one addition and zero removals, three mutation probes
  restored byte-exact. Literal `docker run` of the Linux fixture remains unexecuted here.
  Judge carried-forward notes for morning review: cli.test.ts:66 hardcodes pwsh without
  a pwshAvailable gate (red on a stock box without PowerShell 7; CI unaffected since
  windows-latest ships pwsh); the doc-to-execution binding is one-directional (spec
  launcher drift stays green); no spec yet proves a red doctor populates remediation;
  footprint spec reads the git index while the documentation spec reads the filesystem.

## Doing
- Nothing buildable remains locally. M6 and M7 are hard-blocked.

## Next
- M6 Cross-OS matrix certification (hard-block until external runners execute)
- M7 Live Claude smoke (hard-block until test authentication is approved)

## Blocked / needs human
<!-- gated milestones and decisions, with the risk surface that could not be auto-verified -->
- M5 C2 container execution SHELVED to M6: Docker Desktop is not running here. The
  Dockerfile fixture is pinned to bun-v1.3.8 and defaults to doctor, but a literal
  Linux container run is deferred to external runners.
- M6 Cross-OS matrix: needs windows-latest, ubuntu-latest, and macos-latest GitHub runners.
- M7 Live Claude smoke: needs owner-approved test authentication.
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
- 2026-08-14: Claude Git Bash has no bun on PATH, so SessionStart/PreToolUse/Stop printed
  `bun: command not found`. Hooks now go through `.night-loop/hooks/with-bun.sh`.

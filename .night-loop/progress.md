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

- M6 Cross-OS matrix, CERTIFIED by night-loop-judge on 2026-08-14 with zero rejections.
  Evidence: run 31836953767 on 915b55c, attempt 1, all three OS jobs green with per-step
  success on build, typecheck, lint, unit (24 pass), and e2e (52-spec suite everywhere;
  2 win32-gated skips on posix legs); executed workflow byte-identical to the committed
  ci.yml; three doctor artifacts with os/arch/bun 1.3.8/git/missing=0 and no
  secret-shaped content; red-stays-red proven empirically by runs 31834906413 and
  31836571868 (green siblings, overall failure) plus a masking grep of the workflow.
  Getting to green took three portability fixes the matrix itself surfaced: CRLF
  checkouts on Windows (fixed by .gitattributes), a macOS-only PATH fixture bug in the
  shim spec (sh in /bin, dirname in /usr/bin), and a nondeterministic bun-location
  assumption (fixed with a seeded BUN_INSTALL fixture).
  Judge carried-forward notes for morning review: M5's container clause is NOT
  discharged by this acceptance (no docker run has ever executed; only the Dockerfile
  text-grep spec covers it); no ratchet spec binds the CI prerequisite set or the doctor
  report fields (workflow regression would stay green locally); C1 rests on a single
  attempt-1 run per OS (no repeat-run evidence on 915b55c); the shim spec does not
  assert bun's absence from its stripped PATH (vacuous-pass risk on exotic hosts);
  local Bun is 1.3.14 vs the CI pin 1.3.8.

- M10 Claude current-feature adoption, CERTIFIED by night-loop-judge on 2026-10-20 after one
  rejection (the waiting-session spec did not pin the event type or the native status
  field). Ground truth probed on this box: `claude --bg` prints only a short id, so the
  full sessionId is now resolved from `claude agents --json`; `state` drives lifecycle,
  `waitingFor` is recorded once per transition; doctor floor 2.1.300; generated env carries
  CLAUDE_CODE_STOP_HOOK_BLOCK_CAP and CLAUDE_CODE_RESUME_INTERRUPTED_TURN; setup --model and
  --effort reach argv and survive resume; redacted `claude logs` tail in status and the
  receipt. Judge evidence: 6 new specs, every spot-check mutant killed.
  Carried-forward notes: redaction has no bare `token:` key pattern (the seeded line was
  caught by its sk-ant prefix); `waitingFor` is stored unredacted; decision 012 lists the
  attended hooks.json and gate.ts edits the owner still has to apply.

- M8 Provider-neutral turn supervisor, CERTIFIED by night-loop-judge on 2026-10-20 after
  three rejections that each found something real: four spec gaps (provider claude
  accepted, exact block reason persisted, exact Grok deny rules, every apply_patch path
  gated), the in-turn Stop hook reading a re-setup step limit (fixed: armed limits reach
  hooks through NIGHT_LOOP_MAX_STEPS and run.json), a verifier crash silently continuing
  (fixed: HALTED=verifier_failed), and a re-setup raising the in-turn worker cap after
  resume (fixed natively for Codex via features.multi_agent and
  agents.max_concurrent_threads_per_session, and for every provider by resume restoring the
  armed contract to contract.json, decision 014). Live proof outside the harness: a
  throwaway repo reached HALTED=done through `codex exec` in one turn.
  Carried-forward notes: gate.ts still reads the worker cap from contract.json (decision
  012 follow-up 3); `setup` during a live run is untested; Codex workspace mode runs with
  sandbox network access on (decision 009); the perf budget was raised to 48 KiB
  (decision 013).

- M9 Grok adapter and hook bridge, CERTIFIED by night-loop-judge on 2026-10-20 in the same
  passes as M8. Grok Build 1.0.46 reads Claude-shaped hooks, so the bridge only renames
  tool payloads (run_terminal_command, search_replace, apply_patch expansion) before
  delegating to the unchanged gate, loop, resume, and events hooks. The hard-won fact: Grok
  on Windows runs hook commands through PowerShell, so the generated commands carry the
  `&` call operator there (Codex needs the plain quoted form). Live proof outside the
  harness: four resumed `grok -p` turns reached HALTED=done, and after the `&` fix the
  in-turn hooks visibly ran (prompt-submit evidence, Stop hook running the full harness
  inside the turn).
  Carried-forward notes: `.grok/hooks/night-loop.json` is generated into the host repo
  (ignore it there); Grok at two or more workers relies on the gate for its cap; the
  judge could not verify the live hook execution from harness evidence alone.

- M11 Stuck detection and think turns, CERTIFIED by night-loop-judge on 2026-10-20 after one
  rejection (lessons on recovery and on resume and think prompts were unasserted, and a
  `>=` mutant on the Claude completion check survived). The supervisor now reads its own
  tape: three identical red lines, three identical denied categories, or three identical
  tree fingerprints is a stuck verdict; the implementer gets one read-only think turn
  (Codex read-only sandbox, Grok Read/Grep/Glob, Claude via native resume as the next
  turn) whose PLAN line feeds the next build prompt; `setup --consult codex|grok` adds a
  read-only, ephemeral second opinion first; every recovery, verdict, consult, and think
  appends to .night-loop/lessons.md, carried by resume and think prompts; the third
  episode on one fingerprint shelves the path under Blocked and the night continues.
  Judge evidence: 7 e2e and 6 unit specs, all eight mutants killed (decision 015).
  Carried-forward notes: `think.inject_failed` and the Claude tree-fingerprint path exist
  in code but have no spec; the repeated-denied-category case is unit-level only; think
  and consult turns are read-only by provider flags, not by the gate (Claude think turns
  are instruction-only), so review before production cutover.

## Doing
- Nothing in flight.

## Next
- M7 Live Claude smoke (owner approved test authentication on 2026-08-14; buildable)

## Blocked / needs human
<!-- gated milestones and decisions, with the risk surface that could not be auto-verified -->
- M5 C2 container execution SHELVED to M6: Docker Desktop is not running here. The
  Dockerfile fixture is pinned to bun-v1.3.8 and defaults to doctor, but a literal
  Linux container run is deferred to external runners.
- M6 Cross-OS matrix: needs windows-latest, ubuntu-latest, and macos-latest GitHub runners.
- M7 Live Claude smoke: needs owner-approved test authentication.
- RESOLVED 2026-08-14: the owner applied the decisions/005 gate edit attended; the judge
  is exempt from the worker cap, an e2e case pins it, and generatedSettings dropped the
  settings-level Agent deny that would have fired before the gate.
- ATTENDED (owner, from decision 012): hooks.json needs `onFailure: block` on PreToolUse and
  `timeout: 1800` on Stop; gate.ts should deny an unparseable payload and read
  NIGHT_LOOP_WORKERS before contract.json. The project .claude/settings.json already
  carries the first two for dogfooding.

## Deferred
- An Agy adapter (no subscription CLI with a never-ask mode was verified)
- Multi-agent delegation, worktree orchestration, multiplexing, and provider competition
- Omni and Observator concepts beyond the event logging required by the single-agent supervisor

## Discovered (from triage)
- 2026-08-13: The prior M1 tracked-workspace contract was invalidated. `.apsolut-agents/` must remain local and ignored.
- 2026-08-13: `.apsolut-agents/` is private contributor tooling used to build NIGHT LOOP, not product scope. The former M1-M5 multi-agent chain was replaced before implementation.
- 2026-08-14: Claude Git Bash has no bun on PATH, so SessionStart/PreToolUse/Stop printed
  `bun: command not found`. Hooks now go through `.night-loop/hooks/with-bun.sh`.

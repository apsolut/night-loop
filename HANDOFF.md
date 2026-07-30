# Handoff: NIGHT LOOP + first test project (track-screenshots)

Date: 2026-06-14. Two repos in play. Most detail already lives in the repos; this doc is the
pointer + the things not yet written down.

## TL;DR
- **NIGHT LOOP** = an autonomous overnight coding agent built on the Claude Code Max CLI
  (interactive), driven by a **Stop hook**, jailed in Docker, fed by a research-to-spec intake.
  Source repo: `D:\sites\git\night-loop` (renamed and moved from `D:\sites\x\zero-loop`).
  Published public (MIT) at github.com/apsolut/night-loop.
- **track-screenshots** = the FIRST real project NIGHT LOOP is building (a local, fast,
  deterministic visual-change tracker). At `D:\sites\x\track-screenshots`. The loop has already
  built **M0 (harness)** and is on **M1**. Proof the loop actually works.

## Repo 1: NIGHT LOOP (`D:\sites\git\night-loop`) - the product
NOTE 2026-07-29: the loop's state namespace was renamed from `.apsolut/` to `.apsolut-loop/`
so it cannot collide with the apsolut-seshat vault, which owns `.apsolut/`.
NOTE 2026-07-30: renamed again to `.night-loop/` (markers in `.night-loop/state/`) to match
the product name; `apsolut` stays as the GitHub namespace only. Same day, everything that
could collide with a host project's own Claude Code setup was namespaced: the hook scripts
moved out of `.claude/hooks/` into `.night-loop/hooks/` (one shared copy; the identical
`.codex/hooks/` twins were deleted, both settings files point at the shared copy), the
`judge` agent became `night-loop-judge`, and the `intake` skill became `night-loop-intake`.
Paths below referring to
track-screenshots still use the OLD `.apsolut/` layout; that repo has not been migrated.
Read these instead of re-deriving:
- `NIGHT-LOOP.md` - operator guide (run, markers, halt reasons, "run while you sleep" model).
- `CLAUDE.md` - the agent's operating protocol + first-run intake trigger.
- `.night-loop/hooks/loop.ts` - Stop hook = the loop + independent done-verifier. Runs the ratchet
  each turn, forces continuation, shelve-and-continue, halts only on done/all-blocked/budget.
- `.night-loop/hooks/gate.ts` - PreToolUse: blocks escape commands (push/publish/deploy/rm-rf/curl),
  ALLOWS security-surface code (flags to a REVIEW marker), never halts the loop.
- `.night-loop/hooks/resume.ts` - SessionStart: injects progress.md + git state.
- `.night-loop/hooks/lib.ts` - markers + harness runners.
- `.claude/skills/night-loop-intake/SKILL.md` - front half: 5 questions + competitor research -> backlog.yaml.
- `.claude/agents/night-loop-judge.md` - separate-context verifier.
- `scripts/night-loop.sh` - tmux supervisor (Linux/Docker; not usable on the bare Windows host).
- Design docs: `zero-to-hero-build-loop.md`, `autonomous-build-runtime.md`, `overnight-build-prd.md`,
  `idea-to-product-pipeline.md`, `idea-to-product-example.md`, `judge-and-flake-reliability.md`.
  Each carries a "NIGHT LOOP reconciliation" banner explaining drift vs the real files.

### Verified facts that shaped the design (do not re-litigate)
- **Billing (Anthropic help center, effective 2026-06-15):** headless `claude -p` and the Agent
  SDK on subscription plans draw a SEPARATE metered "Agent SDK credit". The flat Max limits are
  reserved for INTERACTIVE use. -> NIGHT LOOP runs the *interactive* CLI + a Stop hook to stay on
  flat billing. Leaving your logged-in machine (cloud VM) pushes you back to metered API.
- **No built-in `/goal` loop** in Claude Code; the loop is the Stop hook + supervisor.
- **Current hook block schema:** PreToolUse uses
  `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny|allow",...}}`
  (or exit 2). Stop hook uses `{"decision":"block","reason":"..."}` (or exit 2) to force continue.
- **Pi (pi.dev)** is BYO-key -> bills metered API, cannot use the Max subscription. Useful only as
  a cheap orchestrator/decider, not a way to get free Max looping.

### KNOWN BUG: FIXED 2026-07-29
`gate.ts` originally blocked `bun install`/`bun add`, which would stop ANY build (every project
needs to install its toolchain). Fixed in track-screenshots first, and now fixed in night-loop
too: the install pattern is removed from ESCAPE_CMDS in `gate.ts` (at the time twin copies
under `.claude/hooks/` and `.codex/hooks/`, since merged into `.night-loop/hooks/gate.ts`),
and the docs that listed dependency install as gated
(`overnight-build-prd.md` Sec 7, the README gate.ts blueprint, `autonomous-build-runtime.md`
SENSITIVE.commands, CLAUDE.md, AGENTS.md) are updated to match.

### Other open items on the product
- GitHub description + topics not set (offered: `claude-code`, `autonomous-agent`, `ai-coding`).
- LICENSE holder is the generic "NIGHT LOOP authors" placeholder.
- The tmux supervisor + Docker path are written but UNTESTED end to end (only the hooks are proven).

## Repo 2: track-screenshots (`D:\sites\x\track-screenshots`) - the test build
- Intake + spec already written: `.apsolut/intake.md`, `.apsolut/backlog.yaml` (M0-M11),
  `.apsolut/constraints.md` (stack + capture-determinism rules), `.apsolut/progress.md` (ledger).
- Product: local, fast visual-change tracker. Define sites + key pages, capture full-page
  screenshots over time, detect changes. Wedge: local + fast (vs Visualping/Percy cloud).
  Stack: Bun, TS strict, Turso/libSQL (`@libsql/client`), Playwright, React+Vite. **No gates.**
- The hard requirement is **idempotent captures** (dismiss cookie/modal, slow-scroll lazy load,
  disable animations, fixed viewport/timezone/locale, wait networkidle + fonts, mask ignore-regions,
  full-page). Test ground truth = a local fixture site (milestone M3).
- **Status: M0 done** (Vite build, tsc, ESLint, Vitest, Playwright e2e+screenshot all green,
  baseline committed). **M1 (Turso schema) in progress.**
- Smoke test of the hooks PASSED under bun on Windows (not-armed silent / gate deny / gate
  allow+review / resume inject / armed ratchet-red block). The loop genuinely runs.

### How to resume the build (attended, Windows host, no tmux)
The loop is currently ARMED (`.apsolut/night-loop/ACTIVE` exists). To run:
1. Open a terminal in `D:\sites\x\track-screenshots`, run `claude`, approve the trust/hooks prompt.
2. Kickoff: "Continue the NIGHT LOOP. Read CLAUDE.md and .apsolut/progress.md, build the next unmet
   milestone (M1 Turso schema), keep going until the harness proves done."
3. Watch that it self-continues after each turn (Stop hook firing = the thing being validated).
4. Stop: delete `.apsolut/night-loop/ACTIVE`, or Ctrl-C.
Note: permission mode is `acceptEdits`; `bun add` / `bunx playwright install` may prompt - approve
while watching, or use `--permission-mode bypassPermissions` only because you are at the keyboard.

## Ideas raised but NOT yet captured in any doc (the user is in idea-collecting mode)
Suggested home: a new `ideas/autonomy-and-deployment.md` in night-loop.
1. **Hooks can run agents** - `prompt` hook type, or a `command` hook shelling to `claude -p` / Pi /
   `ollama`. Keep bounded (hooks are sync + timeout). A different model = real judge independence.
2. **Done-battery (highest value):** in loop.ts CLAIM_DONE branch, before halting run extra checks -
   completion critic ("meets the intake wedge/one job? what's missing?"), security review over the
   REVIEW list, fresh-clone harness run, perf/a11y. Any failure -> reject the done-claim, keep going.
3. **Scheduled reactivation:** the timer must be an OS scheduler (cron / Task Scheduler / supervisor
   sleep-loop), NOT the hook. Best use = scheduled triage every 2-3h to grow the backlog. Guard
   against runaway (do not re-arm if STEP did not advance or budget hit).
4. **Deployment:** the Docker container is already Debian Linux, so tmux/cron work inside it
   regardless of host; Docker Desktop = WSL2 backend. Options: WSL2 on own PC (keeps Max login) /
   dedicated always-on local Linux box (mini-PC or Pi, Ubuntu LTS or Debian = sweet spot) / cloud VM
   (but reintroduces metered billing + ToS-gray Max-on-server).
5. Earlier autonomy upgrades also on the table: async checkpoint->notify->approve->resume;
   stuck-detector + auto-decompose; auto-quarantine via `test:flake-baseline`; external decision CLI
   (model-diverse judge, advisory + asymmetric: can veto, cannot grant a pass the harness denied);
   gate-advocate (AI drafts gated decisions, human ratifies in one tap).
   NOTE: the shelve-and-continue gate model is already DONE (gates never halt; build security code
   against TEST creds; halt only on done/all-blocked/budget).

## Suggested skills for the next session
- `find-docs` or the `claude-api` skill - for any Claude Code CLI / hook / billing specifics
  (always verify against current docs; the billing rules moved in June 2026).
- `apsolut-recall` - if you need prior decisions/context from project memory.
- `sketch` - if capturing the idea list above as a standalone artifact.
- To continue the build: no skill needed - open `claude` in `track-screenshots`; NIGHT LOOP drives
  itself there.

## Redactions
User PII (email) intentionally omitted. No API keys or secrets are stored in either repo
(verified before publishing; `.env` is gitignored, only `.env.example` with placeholders is tracked).

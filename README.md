<p align="center">
  <img src="assets/hero.png" alt="NIGHT LOOP - autonomous overnight coding agent" width="100%">
</p>

# NIGHT LOOP

Autonomous overnight coding agent on the Claude Code Max CLI. Answer about five questions, go to
sleep, and wake up to a built-and-tested MVP. Driven by a Stop hook, jailed in Docker, fed by a
research-to-spec intake. See `NIGHT-LOOP.md` to run it.

> **Safety, read before running.** NIGHT LOOP runs an AI agent **unattended, with permissions
> bypassed**: it writes and executes its own code and shell commands for hours without asking.
> **Run it only inside the provided Docker jail**, with network egress denied by default and **only
> test credentials** present, never real secrets or production systems. Git is the recovery net.
> You are responsible for what it does on your machine. This is early, largely untested WIP; treat
> it as a reference design, not a turnkey product.

## Complete Starter Kit

> **NIGHT LOOP reconciliation (2026-06).** The running system is **NIGHT LOOP**, an autonomous build loop on the **Claude Code Max CLI** (interactive), driven by a **Stop hook**. The real implementation now lives in `.claude/`, `scripts/night-loop.sh`, and `NIGHT-LOOP.md`; this starter kit is the conceptual version. Billing reality: only Claude Code *interactive* uses the flat Max limits; headless `claude -p` and the Agent SDK draw a separate metered credit (from 2026-06-15) and API-key agents bill pay-go. This blueprint predates the real files: the loop is the Stop hook plus `night-loop.sh`, not `/goal` (no built-in `/goal` exists), and the gate uses the current `hookSpecificOutput` / `permissionDecision` schema, not `{"decision":"block"}`. Where this doc and the real files differ, the files win.

Drop these into one repo. This is the control plane for the loop. The agent builds the actual app and its harness in M0/M1. These files are the rails (gates, ratchet, judge separation, durable state) and the contract they enforce.

```
project/
  CLAUDE.md                                  entry point Claude Code reads first
  SETUP.md                                   what to do before the first run
  package.json                               the harness command contract
  .githooks/
    pre-commit                               ratchet enforcement (fast gates)
  .claude/
    settings.json                            registers the PreToolUse gate hook
    hooks/
      gate.ts                                blocks sensitive edits and commands
    agents/
      judge.md                               the verifier, separate context
    skills/
      build-doctrine/SKILL.md                conventions, so they are not re-derived
      triage/SKILL.md                        self-extension: grow the backlog from reality
  .apsolut-loop/
    PRD.md                                   the contract (use the previous artifact)
    constraints.md                           durable rules, reloaded every plan
    progress.md                              the mutable ledger
    decisions/000-template.md                one file per architectural choice
    rubrics/landing.md                       the only fuzzy judge (M11)
    runs/                                    digests land here per checkpoint
  harness/
    digest-template.md                       the morning report format
```

The implementer is the main Claude Code session driven by `CLAUDE.md`. There is no separate implementer file on purpose. The judge is the only subagent, because the one structural rule that matters is the maker not grading its own work.

---

### CLAUDE.md

```markdown
# CLAUDE.md

You are building the project in `.apsolut-loop/PRD.md`. That PRD is the contract and the only definition of done. Read it fully before acting.

## How to run
- The supervisor (`scripts/night-loop.sh`) plus the Stop hook (`.claude/hooks/loop.ts`) keep you looping. Stop condition: PRD Section 3 (all non-gated milestones pass, ratchet 100% green, gated items approved or deferred).
- A separate model checks the stop condition each turn. You do not declare done yourself.

## Non-negotiables (full living list in `.apsolut-loop/constraints.md`, reload every plan)
- Smallest blast radius. Fewest files that satisfy the milestone.
- Never delete or weaken a test to go green.
- Every "data persisted" claim is asserted against the DB, never assumed.
- No new dependencies without stopping to ask.
- Gates (PRD Section 7) are hard stops. The PreToolUse hook blocks you. Write the request to the digest and stop.

## Roles
- You implement. The judge subagent (`.claude/agents/judge.md`) verifies in a separate context.
- To certify a milestone, invoke the judge. Do not self-certify.

## State (you forget between runs; the repo does not)
- Contract: `.apsolut-loop/PRD.md` (spec, do not edit to make work easier)
- Ledger: `.apsolut-loop/progress.md` (done, doing, next) - update after every accepted milestone
- Decisions: `.apsolut-loop/decisions/` - one file per choice, so it is not re-litigated
- Resume: read the last commit and `progress.md`, continue from there

## Harness (build M0 first; nothing is verifiable without it)
Commands the loop and hooks depend on:
`bun run build`, `bun run typecheck`, `bun run lint`, `bun run test:unit`, `bun run test:e2e`, `bun run test:screenshot`, `bun run perf`.
The ratchet has two tiers (see `judge-and-flake-reliability.md`). The HARD tier (auto-reverts on a reproducible red) is the deterministic layers only: `test:unit` plus accepted `@ratchet` e2e specs whose predicate is a data/geometry assertion. The ADVISORY tier (screenshot pixel diff, perf, the M11 LLM rubric) blocks forward acceptance and surfaces in the digest but never reverts already-green work. Both only grow. Never revert on a non-reproducible red.
```

---

### SETUP.md

```markdown
# SETUP

Do these in order before the first unattended run.

## 1. Fill the blanks, or the agent fills them with guesses
- PRD Section 2: frontend framework, charting lib
- PRD Section 10: wall-clock cap per run
- constraints.md: project conventions
- PRD Section 9: decide the ingestion data source, or accept that the run delivers a tested shell around seeded data only

## 2. Wire git to the ratchet
git config core.hooksPath .githooks
chmod +x .githooks/pre-commit

## 3. TEST THE GATE before you trust it overnight
This is the file that makes "stop before touching auth" real. Verify it fires:

echo '{"tool_name":"Bash","tool_input":{"command":"rm -rf /tmp/x"}}' | bun .claude/hooks/gate.ts; echo "exit: $?"
echo '{"tool_name":"Write","tool_input":{"file_path":"src/auth/login.ts"}}' | bun .claude/hooks/gate.ts; echo "exit: $?"

Both must print a GATED message and exit 2. If either exits 0 the gate is not working and you must not run unattended. Verify the hook schema and block mechanism against your current Claude Code version. This is the one file that must be correct.

## 4. Determinize the harness and measure flake (do this as M0 lands, before trusting any e2e spec)
A flaky ratchet reverts good work and lies to the planner, and the cost scales with ratchet size (see `judge-and-flake-reliability.md`). Before any e2e spec is allowed to gate:
- Determinize the test env: fixed injected clock, seeded RNG, animations and transitions disabled, fonts bundled with `document.fonts.ready` awaited, fixed viewport, scrollbars hidden, no real network, and ban `waitForTimeout` in favor of `expect.poll` / `toPass` / state waits.
- Run the baseline: bun run test:flake-baseline. It re-runs the ratchet K times on the unchanged tree. Any spec not green all K times is quarantined out of the hard tier until fixed. Confirm the hard tier reaches p near zero before the first unattended run.

## 5. Start the loop
bash scripts/night-loop.sh
# The supervisor arms the loop and launches an interactive `claude` session in tmux.
# A Stop hook (.claude/hooks/loop.ts) runs the harness after every turn and forces
# continuation until PRD Section 3 holds (all non-gated milestones pass, ratchet green,
# gated items approved or deferred), then halts with the MVP ready. There is no `/goal`.

## 6. Each morning
Read the latest digest. Read THE READ section in full, not just the status line. Approve gated items or give feedback (append it to constraints.md, dated). Resume.

## Safety reality
The PreToolUse hook is a tripwire, not a kernel boundary. For real protection during multi-day unattended runs, also run this in a container or VM with network egress denied by default plus an allowlist, and rely on git as the recovery net (every accepted step is a commit; hard-reset to any checkpoint). Hook plus sandbox plus git is the real stack. The hook alone is not. The container earns its keep a second way: pinned Chromium and pinned fonts are what make screenshot and render specs deterministic, which is what makes the ratchet (and the "resume is idempotent" claim) trustworthy.
```

---

### package.json

```json
{
  "name": "analytics-dashboard",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "echo 'M0: wire real build' && exit 1",
    "typecheck": "tsc --noEmit",
    "lint": "echo 'M0: wire eslint' && exit 1",
    "test:unit": "vitest run",
    "test:e2e": "playwright test",
    "test:screenshot": "playwright test --grep @screenshot",
    "test:e2e:ratchet": "playwright test --grep @ratchet",
    "test:flake-baseline": "bun run scripts/flake-baseline.ts",
    "perf": "echo 'M10: wire perf budget' && exit 1",
    "seed": "bun run scripts/seed.ts"
  }
}
```

`test:flake-baseline` re-runs the whole ratchet K times against the *unchanged* tree (no diff) to measure each spec's real flake rate `p`. Any spec not green all K times is quarantined out of the hard tier until determinized. Run it before the first unattended run and on a schedule; it is the tripwire that keeps the `(1-p)^N` spurious-revert rate (see `judge-and-flake-reliability.md`) inside budget as the ratchet grows.

The `exit 1` placeholders are deliberate. The harness commands exist so the hooks and judge do not error on a missing script, but they fail until M0 wires them. The loop's first job is turning these green. That enforces M0-first without a separate rule.

---

### .githooks/pre-commit

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "[ratchet] fast gates..."
bun run typecheck
bun run lint
bun run test:unit   # the core ratchet; a commit that reds this is rejected
echo "[ratchet] green. commit allowed."
```

Fast gates only, and deterministic by design. The expensive AND noisy layers (full e2e, screenshot diff, perf) run through the judge at milestone acceptance, not on every commit, so the loop stays quick and the commit gate never falsely fires. Keeping only the deterministic layers (typecheck, lint, unit) in the commit path is the commit-time half of the hard-vs-advisory split in `judge-and-flake-reliability.md`. Do not add a noisy spec here.

---

### .claude/settings.json

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit|Bash",
        "hooks": [
          { "type": "command", "command": "bun .claude/hooks/gate.ts" }
        ]
      }
    ]
  }
}
```

Verify this schema against your current Claude Code version. Hooks exist, but the exact keys and the block protocol may have shifted since my knowledge cutoff. The test in SETUP step 3 is how you confirm it actually fires.

---

### .claude/hooks/gate.ts

```typescript
// PreToolUse hook. Receives the tool call on stdin. Blocks sensitive edits and commands.
// This is a tripwire, not a security boundary. Pair it with a sandbox and git.

const SENSITIVE_PATHS = [/auth/i, /billing/i, /payment/i, /stripe/i, /\.env/, /migrat/i, /schema/i];
const SENSITIVE_CMDS = [
  /\brm\b/, /\bdrop\b/i, /git\s+push/, /npm\s+publish/,
  /\b(curl|wget)\b/,
];
// Dependency installs (bun add / npm install) are deliberately NOT blocked: every fresh
// project must install its toolchain, or the loop stalls on its first task.

const raw = await Bun.stdin.text();
let payload: any = {};
try {
  payload = JSON.parse(raw);
} catch {
  // Fail open only on a parse error, and say so. Failing closed would brick every
  // tool call and you would just disable the hook. The sandbox is the real backstop.
  console.error("[gate] could not parse hook payload, allowing. Check the hook schema.");
  process.exit(0);
}

const tool = payload.tool_name ?? payload.tool ?? "";
const ti = payload.tool_input ?? payload.input ?? {};
let hit: string | null = null;

if (tool === "Edit" || tool === "Write" || tool === "MultiEdit") {
  const path = ti.file_path ?? ti.path ?? "";
  if (SENSITIVE_PATHS.some((re) => re.test(path))) hit = `edit to sensitive path: ${path}`;
}
if (tool === "Bash") {
  const cmd = ti.command ?? "";
  if (SENSITIVE_CMDS.some((re) => re.test(cmd))) hit = `sensitive command: ${cmd}`;
}

if (hit) {
  // Block mechanism A: exit code 2 blocks the tool in Claude Code.
  // Block mechanism B (if your version uses JSON decisions), uncomment and exit 0:
  // console.log(JSON.stringify({ decision: "block", reason: `GATED: ${hit}. Write to the digest and stop.` }));
  console.error(`GATED: ${hit}. Stop, write the request to the digest, and wait for human approval.`);
  process.exit(2);
}
process.exit(0);
```

---

### .claude/agents/judge.md

```markdown
---
name: judge
description: Verifies a milestone against its acceptance criteria and the harness output. Adversarial. Invoke to certify a milestone is done. Never let the implementer self-certify.
tools: Bash, Read, Grep
model: opus
---

You are the verifier. You did not write this code and you have no stake in it passing. Your job is to find the reason it is NOT done.

Given a milestone id, do this and nothing else:

1. Read that milestone's acceptance criteria in `.apsolut-loop/PRD.md`.
2. Run the harness for it, sorted into two tiers (see `judge-and-flake-reliability.md`):
   - HARD tier (deterministic, may REJECT): bun run typecheck && bun run lint && bun run test:unit, plus the e2e specs whose predicate is a data or geometry assertion (the number on screen equals the number computed from the seed; an element's boundingBox is where it should be).
   - ADVISORY tier (noisy, may BLOCK forward acceptance, never triggers a revert): bun run test:screenshot (pixel diff), bun run perf (M10), and the M11 rubric.
   - For M11: evaluate the rendered page against `.apsolut-loop/rubrics/landing.md` at temperature 0, with a pinned model id, structured per-criterion PASS/FAIL, k-run quorum (a split verdict escalates to the human, it does not pass or fail unilaterally), and only after the calibration golden-set passes. This verdict is advisory.
3. For each criterion, state PASS or FAIL with the specific evidence: the test name, the asserted value vs expected, the console output. A criterion with no test proving it is a FAIL, not a pass by assumption.
4. Check the ratchet for reproducible regressions only. Did any previously-green HARD-tier spec red? Before treating it as a regression, confirm it is reproducible: it must fail on retry on this diff AND have passed on the unchanged baseline. A non-reproducible red is flake, not a regression: do NOT reject on it, do NOT diagnose against it, flag the spec for quarantine. A confirmed reproducible HARD-tier regression REJECTS the milestone regardless of its own criteria. An ADVISORY-tier failure blocks forward acceptance and is surfaced in the digest, but never reverts already-green work.
5. Verdict: ACCEPT only if every criterion is PASS by evidence and the HARD tier is green with no reproducible regression. A failing ADVISORY layer means BLOCK-AND-SURFACE, not silent accept and not revert. Otherwise REJECT with the precise, reproducible failure so the implementer can act.

Rules:
- Do not propose fixes. You verify, you do not implement.
- "It renders" is not proof of "it shows the right data". The number on screen must equal the number computed from the seed.
- Do not be persuaded by how the code looks or by comments claiming it works. Only harness evidence counts.
- Objective is not deterministic. A pixel diff and a perf number are objective and noisy. Never let a noisy layer auto-revert. Reproducibility is the gate for every revert.
```

---

### .claude/skills/build-doctrine/SKILL.md

```markdown
---
name: build-doctrine
description: How we build in this repo. Conventions, diff discipline, and the eval-first rule. Read before implementing any milestone.
---

# Build Doctrine

## Order
Eval before implementation. For any milestone the acceptance test exists and fails before the feature code is written. A feature with no failing test to turn green is not started.

## Diffs
Smallest blast radius. The correct diff touches the fewest files that satisfy the criterion. If a change wants to touch many files, stop and reconsider the design first.

## Verification
Ground truth over plausibility. "Persisted" is proven by querying the DB. "Shows the data" is proven by asserting the rendered value equals the computed value. Never assume a side effect succeeded.

## Tests
The suite only grows. Never delete or weaken a test to pass. A *reproducible* red ratchet means revert, not edit-the-test. A non-reproducible red (fails on retry but the unchanged baseline was green) is flake, not a regression: quarantine the spec, do not revert and do not diagnose against it. Quarantine relocates an untrustworthy signal out of the hard tier until it is determinized; it weakens nothing. See `judge-and-flake-reliability.md`.

## Decisions
Every architectural choice gets a one-line entry in `.apsolut-loop/decisions/` with the date and the why. Next run reads it instead of re-deciding.

## When stuck
Three attempts at the same failure means stop. Decompose or escalate to the digest. Do not produce diffs that move the signals without converging.
```

---

### .claude/skills/triage/SKILL.md

```markdown
---
name: triage
description: Daily discovery. Reads recent failures, regressions, and gaps and appends actionable findings to the backlog as new milestones. Run on a schedule after M0.
---

# Triage

Grow the backlog from reality, not from yesterday's assumptions.

1. Run the full harness: bun run typecheck && bun run lint && bun run test:unit && bun run test:e2e
2. Read `.apsolut-loop/progress.md` for deferred and blocked items.
3. For each failure, regression, or gap, append a milestone under "Discovered" in `.apsolut-loop/progress.md` with:
   - a behavioral acceptance criterion (checkable, not "fix X")
   - dependencies
   - a gated flag if it touches auth, billing, schema, or external writes
4. Do not fix anything here. Triage discovers and records. The build loop acts on it.
5. New milestones obey every rule in the PRD, including gates.
```

---

### .apsolut-loop/constraints.md

```markdown
# Constraints

Reload at the start of every plan. Human feedback at checkpoints appends here.

- Smallest blast radius. Fewest files that satisfy the milestone.
- No new dependencies without stopping to ask. State the reason.
- Never delete or weaken a test to go green.
- Every "data persisted" claim is asserted against the DB.
- Gates (PRD Section 7) are hard stops enforced by the PreToolUse hook.
- No em dashes in generated prose, docs, or comments.
- Architectural choices get a one-line entry in `.apsolut-loop/decisions/`.

## Project conventions (fill before first run)
- Frontend framework and charting lib: <FILL>
- Naming: <FILL>
- File structure: <FILL>

## Appended by human feedback
<!-- checkpoint feedback lands here, dated -->
```

---

### .apsolut-loop/progress.md

```markdown
# Progress Ledger

Update after every accepted milestone. This is how the next run knows where to resume.

## Done
<!-- accepted milestones, with commit hash -->

## Doing
<!-- current milestone -->

## Next
- M0 Harness
- M1 DB and schema
- M2 Tracked domains CRUD
- M3 Pages and items CRUD
- M4 Analytics views
- M5 Composition and layout
- M6 Edge states
- M7 Auth (GATED)
- M8 Billing (GATED)
- M10 Optimization pass
- M11 Landing page

## Blocked / needs human
- M9 Ingestion: no data source defined. DECISION NEEDED before any ingestion work.

## Deferred
<!-- milestones consciously postponed -->

## Discovered (from triage)
<!-- auto-appended -->
```

---

### .apsolut-loop/decisions/000-template.md

```markdown
# <NNN> - <decision title>

Date: <YYYY-MM-DD>
Milestone: <id>

## Decision
<one line: what we chose>

## Why
<one or two lines: the reason, so it is not re-litigated>

## Rejected
<what we did not do and why>
```

---

### .apsolut-loop/rubrics/landing.md

```markdown
# Landing Page Rubric (M11)

The judge scores the rendered landing page against these. This is the only fuzzy judge in the build and it runs only after the objective layers are green. The final taste call is the human's.

- Above the fold states the product's value in one clear line. PASS/FAIL.
- Visual hierarchy guides the eye to a single primary action. PASS/FAIL.
- No placeholder text, no lorem ipsum, no broken images. PASS/FAIL.
- Responsive: legible and unbroken at 380px and 1280px. PASS/FAIL.
- Loads without console errors. PASS/FAIL.

A FAIL on any item rejects. Do not loop past all-PASS. Flag for human review and move on.
```

---

### harness/digest-template.md

```markdown
# Run {{run_id}} - Checkpoint ({{reason}})

## Shipped since last checkpoint
- {{milestone}}: {{what and how verified}}

## Ratchet
- {{X}}/{{Y}} green. Reverts this batch: {{none | detail}}

## Flake
- Hard-tier flake rate p (from test:flake-baseline): {{p}}. Quarantined this batch: {{none | spec + why}}. Spurious reverts suppressed by reproducibility gating: {{count}}.

## THE READ (do not skip)
The single most important change you must read to stay current:
- {{file:lines}} - {{why it matters, what decision it encodes}}

## Blocked / needs you
- {{gated item or decision, with the risk surface not auto-verified}}

## Next
- {{next 1 to 3 milestones}}

## Open questions / risks the harness cannot see
- {{e.g. ingestion data source still undecided}}
```

---

### .apsolut-loop/PRD.md

Use the PRD from the previous artifact. Save it at this path. It is the contract `CLAUDE.md` and the judge both read. Everything above enforces it; it is the thing being enforced.
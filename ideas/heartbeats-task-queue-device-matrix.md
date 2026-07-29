# Heartbeats, task-queue nights, and a device-matrix UI fix loop

Research date: 2026-07-29. Sources: OpenClaw gateway docs, Hermes Agent (Nous Research)
issue #15400 and reference architecture, ralph-wiggum plugin, loop-engineering writeups,
Playwright v1.61 docs. Links at the bottom. This doc maps what the field converged on in
2025-2026 onto NIGHT LOOP's real files (`.claude/hooks/loop.ts`, `lib.ts`,
`scripts/night-loop.sh`) and proposes three upgrades.

## What the world converged on (and where NIGHT LOOP already stands)

The mid-2026 consensus is "engineer the loop, not the prompt": a loop spec is a trigger,
a goal, an independent verifier, a stopping rule, and a budget. NIGHT LOOP already has
all five (Stop hook trigger, backlog goal, harness verifier, CLAIM_DONE / ALL_BLOCKED
stop rules, NIGHT_LOOP_MAX_STEPS budget). The ralph-wiggum plugin and Claude Code /goal
are the same shape. So the base architecture is validated; the gaps are elsewhere.

Two distinct "heartbeat" meanings coexist in OpenClaw and Hermes, and NIGHT LOOP has
half of each:

1. Scheduled wake-to-act (OpenClaw gateway heartbeat, Hermes heartbeat primitive):
   an external scheduler wakes the agent on an interval; the agent inspects state,
   takes a bounded action or replies a cheap sentinel (HEARTBEAT_OK) that is suppressed.
   Key refinements worth stealing:
   - State inspection before action (Hermes #15400): the wake prompt includes previous
     heartbeat summaries; the agent compares current state to last known state and acts
     only on the delta, never blind-retries.
   - Persistent heartbeat metadata: last run time, actions taken, consecutive-failure
     count, recommended next step, written to a state file each wake.
   - Skip-if-empty and cheap-model ticks to avoid token burn (OpenClaw users reported
     $100+/day from 30-minute full-context idle ticks; isolatedSession dropped a tick
     from ~100K to ~2-5K tokens).
2. Liveness heartbeat (Hermes kanban_heartbeat): the worker pings the dispatcher during
   long operations so the dispatcher can tell "alive and working" from "stuck".
   NIGHT LOOP's STEP bump is exactly this, but it only ticks between turns; a long
   single turn (huge test run, rate-limit stall at the prompt) looks identical to a hang.

The overnight failure modes are well documented now (Khmelinskaya's writeup is the best):
context exhaustion from verbose tool output, instruction dilution across compactions
(fix: rules live in CLAUDE.md, not conversation, which NIGHT LOOP already does), and
crashes with no recovery path. The proven counters: phase the night into 30-60 minute
units with a file handoff between them, an external watchdog with a LOW restart cap
(3, not 200) that runs a cheap diagnostic session over the logs before each restart,
and treating the whole thing "like a CI pipeline, not a conversation".

For task queues, the dominant pattern is boring and file-based: one markdown file per
task in a `tasks/` folder with scope plus checkable acceptance criteria, agent moves the
file to `done/` or `failed/` and picks the next. Sizing norm: 30-60 minutes of agent
work per task. Failure norm: retry once or twice, then mark failed with a note and
continue the night; never halt on one bad task. This matches NIGHT LOOP's
shelve-and-continue rule exactly, just at task granularity instead of milestone
granularity.

## Upgrade 1: Task-queue mode (the "3-4 tasks, run all night" request)

Today NIGHT LOOP has one mode: build `backlog.yaml` to MVP. Add a second arming mode
for existing projects: the operator writes 3-4 task files before bed, the loop drains
the queue.

- Layout: `.apsolut-loop/tasks/queue/NN-slug.md`, `.apsolut-loop/tasks/done/`,
  `.apsolut-loop/tasks/failed/`. Each task file: goal, blast radius (files it may touch),
  acceptance criteria the judge can check, and `max_attempts: 2`.
- Arming: `night-loop.sh --tasks` writes a `TASK_MODE` marker next to `ACTIVE`.
- `loop.ts` branch: when `TASK_MODE` exists, the continuation instruction becomes
  "pick the lowest-numbered file in tasks/queue, implement it, run the ratchet, invoke
  the judge against its acceptance criteria, then move it to done/ (or failed/ with a
  one-paragraph post-mortem after max_attempts)". The ratchet guard (step 5) stays
  unchanged: a red ratchet always outranks the queue.
- Done rule: queue empty is the CLAIM_DONE equivalent. The hook verifies with
  `runFullHarness()` exactly as it does now, so an emptied queue with a red harness is
  rejected the same way a false done-claim is.
- Failure rule: a failed task never blocks the next one (the field's "blocker rule").
  ALL_BLOCKED only fires when queue/ is empty except for failed tasks.

This is small: one marker, one branch in `loop.ts`, one flag in the supervisor, one
template task file. The judge and ratchet are reused as-is.

## Upgrade 2: Heartbeat-grade watchdog (replace blind relaunch)

`night-loop.sh` currently detects a stall by STEP not moving for 20 minutes and
blind-relaunches up to 200 times with the same kickoff. Upgrade it to the
Hermes-style state-inspecting heartbeat:

- Progress signal: watch STEP AND `git rev-parse HEAD` AND the mtime of
  `.apsolut-loop/progress.md`. Any of the three moving means alive. STEP alone misses
  in-turn progress; commits alone miss long red-fixing turns.
- Heartbeat state file `.apsolut-loop/state/HEARTBEAT.json`: `{ lastTick, lastStep,
  lastCommit, consecutiveStalls, lastAction, note }`. Written every supervisor tick.
  This is also the morning-readable "what happened at 3am" record.
- Diagnose before restart: on a stall, before relaunching, run a diagnostic pass over
  the tail of the session log and HEARTBEAT.json ("why did this stall, and what
  one-line kickoff fixes it?") and feed its answer into the resume kickoff instead of
  the generic one. HARD RULE (decision 001): no headless `claude -p` and no API keys,
  because headless draws the metered Agent SDK credit and the loop runs on flat
  subscription billing only. So the diagnostic is plain shell heuristics (grep for
  rate-limit text, tsc hang, OOM, etc.); if a model is genuinely needed, use an
  interactive subscription session driven through tmux, same as the builder.
- Restart cap: drop MAX_RELAUNCH from 200 to a small number of DIAGNOSED restarts
  per distinct cause (the field's number is 3). 200 blind relaunches is exactly the
  runaway-retry hazard GitHub's Copilot agent hit.
- Windows host: the supervisor is tmux/Docker-only today. A `night-loop.ps1` with the
  same marker protocol plus a Task Scheduler trigger gives the bare-Windows host the
  same heartbeat without WSL. The marker files are already OS-neutral.
- Cheap sentinel: when HALTED exists the supervisor already exits; add
  "skip tick work entirely when nothing changed and no stall threshold crossed"
  so the watchdog itself stays near-free (OpenClaw's skip-if-empty lesson).

## Upgrade 3: Device-matrix screenshots plus a fix-or-update loop

The extra the operator wants: every night, render key pages across devices, detect
visual breakage, and have the agent fix code/UI. Playwright supports the whole loop
natively; no new dependency is needed beyond what M0 already installs.

Matrix (projects in `playwright.config.ts`); 3-5 projects is the practical ceiling for
an unattended loop, not a full cross-product:

```ts
projects: [
  { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } } },
  { name: 'mobile-pixel',     use: { ...devices['Pixel 7'] } },        // chromium, touch
  { name: 'mobile-iphone',    use: { ...devices['iPhone 14'] } },     // webkit
  { name: 'tablet-ipad',      use: { ...devices['iPad (gen 7)'] } },  // webkit
]
```

Spread the device first, then override viewport. Gate tier stays chromium-only;
webkit projects are advisory (webkit renders differently per OS, so their baselines
are only valid on the machine, or Docker image, that made them).

Determinism (matches judge-and-flake-reliability.md; this is the exact config the
docs and 2026 guides converge on):

```ts
expect: { toHaveScreenshot: {
  animations: 'disabled', caret: 'hide', scale: 'css',
  maxDiffPixelRatio: 0.01, stylePath: './tests/visual/screenshot.css',
}},
use: { locale: 'en-US', timezoneId: 'UTC', colorScheme: 'light', reducedMotion: 'reduce' },
snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{testFilePath}/{arg}{ext}',
```

Plus: self-hosted woff2 fonts (never CDN), `page.clock.setFixedTime(...)`, mask or
stylePath for volatile regions, never `maxDiffPixels: 0` on text (even identical
machines produce subpixel diffs), and prefer section-level locator screenshots over
full-page (smaller scope, clearer signal, less flake).

The agent-facing loop (this is the part that makes it self-fixing):

1. `bun run test:screenshot` runs the matrix with the JSON reporter
   (`['json', { outputFile: 'test-results/results.json' }]`).
2. Parse: filter tests with `status === 'unexpected'`; each failed result carries
   attachments named `*-expected.png`, `*-actual.png`, `*-diff.png`, and the error
   message contains the parseable "N pixels (ratio X) are different".
3. The agent Reads the diff triplet (multimodal), names the change in plain language,
   then applies the fix-or-update policy below.
4. Fix, re-run only the affected spec and project
   (`playwright test path/to.spec.ts --project=mobile-iphone`), repeat.

Fix-or-update policy (the visual analog of "never weaken a test to go green"; add to
`.apsolut-loop/constraints.md` when this ships):

- Update the baseline ONLY when the diff is a direct, intended consequence of the
  current task's code changes (the diff region maps to files in the current change
  set). Use `--update-snapshots=changed` scoped to that spec and project, never a
  blanket `-u` across the suite.
- Everything else is a regression: diffs in components the task did not touch, layout
  breakage (overflow, overlap, blank regions, missing elements). Fix code, never the
  baseline.
- Tiny scattered diffs are rendering variance: fix determinism (fonts, animation,
  clock), not the threshold and not the baseline. Re-run once; a diff that vanishes is
  flake and goes through `test:flake-baseline`, not a baseline update.
- Every auto-updated baseline lands in the same commit as the source change that
  caused it, and gets a line in the morning digest for human review.
- Tier placement is unchanged from CLAUDE.md: pixel diffs are ADVISORY (inform, never
  revert); the deterministic hard tier can instead gate on `toMatchAriaSnapshot`
  (text-based structure assertions), which is pixel-free and safe to ratchet.

As a nightly task this becomes a standing queue entry (upgrade 1): "run the device
matrix, triage every unexpected diff per the policy, fix regressions, land intended
baseline updates, write the digest section".

## Billing rule for every agent in the loop (decision 001)

All of the above, including any future multi-agent variant (Claude, Codex, Gemini/Agy,
Grok splitting the queue), runs on flat subscription credits only, never metered API:

- Claude: interactive Max CLI session driven by the Stop hook (the whole reason
  NIGHT LOOP is built on the interactive CLI). Never `claude -p`, never the Agent SDK.
- Codex: the Codex CLI signed in with the ChatGPT plan, not an OpenAI API key.
- Gemini (Agy): the Gemini CLI logged in via the Google subscription, not an AI Studio
  key.
- Grok: its subscription plan, not the xAI API.

Practical consequence for multi-agent nights: each CLI gets its own tmux window with
the same marker protocol (its own STEP file and heartbeat entry), and the supervisor
treats a rate-limited window as "paused, back off" rather than routing work to a
metered fallback. Worst case on flat billing is a pause; a metered fallback turns a
stall into a bill.

## Hook currency audit (2026-07-29, against code.claude.com docs)

Checked the shipped hooks and judge against current Claude Code. Everything is
schema-valid; changes applied and facts worth keeping:

- Stop `{"decision":"block","reason"}`, PreToolUse `permissionDecision`
  allow/deny (plus newer ask/defer and `updatedInput`), and SessionStart
  `additionalContext` are all current. No migration needed.
- APPLIED: SessionStart now also emits `initialUserMessage` when ACTIVE exists, so a
  relaunched session self-starts even if the supervisor's tmux send-keys is missed.
  This hardens the crash-relaunch path for free.
- APPLIED: judge.md gained `effort: high` and `maxTurns: 40` (new subagent frontmatter
  fields). `model: opus` remains valid; `fable` is available if judge strength ever
  needs a bump, at the cost of faster limit burn.
- Hook events that exist now and matter for the upgrades above: SessionEnd (write the
  digest on session death), PostToolUseFailure (surface screenshot-diff paths back into
  context, the stevekinney pattern), PreCompact/PostCompact (re-inject constraints after
  compaction, the instruction-dilution fix), SubagentStop, TaskCompleted.
- Native `/goal` and `/loop` exist on Max. `/goal` is a prompt-based Stop hook where a
  model judges the completion condition; NIGHT LOOP keeps its own Stop hook because the
  done-verdict must come from the deterministic harness, not a model's opinion.
  Routines (cloud, scheduled) bill against the subscription, not metered credit, so
  they are decision-001-compatible for future scheduled triage.
- Plugin caveat for the drop-in plan: `${CLAUDE_PLUGIN_ROOT}` is NOT in the current
  docs, and plugin subagents silently ignore `hooks`/`mcpServers`/`permissionMode`.
  So the plugin should ship skills/commands/agents, but the three hook scripts should
  be installed into the host project (an init command copies them and merges
  settings.local.json) rather than assumed to resolve from the plugin root. Verify
  against live docs again when building it.

## Suggested order

1. Task-queue mode (small, pure hook/supervisor change, immediately useful).
2. Device-matrix config plus the fix-or-update policy in constraints.md (config plus
   docs; the loop can start using it the same night).
3. Watchdog heartbeat (touches the supervisor, needs a real overnight run to validate;
   the Windows ps1 variant makes the bare host viable for the first time).

## Sources

- OpenClaw heartbeat: https://docs.openclaw.ai/gateway/heartbeat and
  https://docs.openclaw.ai/automation (cron vs heartbeat table); token-burn report:
  https://www.notebookcheck.net/Free-to-use-AI-tool-can-burn-through-hundreds-of-Dollars-per-day-OpenClaw-has-absurdly-high-token-use.1219925.0.html
- OpenClaw overnight-coding recipe (cron + issue-label state machine):
  https://medium.com/@takamasa1222/keep-openclaw-working-while-you-sleep-92752cd575ce
- Hermes Agent heartbeat contract: https://github.com/NousResearch/hermes-agent/issues/15400
  and https://hermes-agent.nousresearch.com/docs/
- Ralph-wiggum plugin (official Stop-hook loop):
  https://github.com/anthropics/claude-code/tree/main/plugins/ralph-wiggum
- Overnight failure modes and watchdog design:
  https://medium.com/@evekhm/running-claude-code-autonomously-overnight-what-breaks-and-how-to-fix-it-3bee3bd958b5
- 24-hour agent runs: https://towardsdatascience.com/how-to-run-claude-code-agents-for-24-hours/
- Markdown task queues: https://blog.fluckiger.org/posts/2026-05-21-give-your-agents-a-task-queue/
  and https://github.com/tasksmd/tasks.md and https://github.com/MrLesk/Backlog.md
- Loop engineering: https://arxiv.org/abs/2607.00038
- Playwright: https://playwright.dev/docs/test-snapshots ,
  https://playwright.dev/docs/test-projects , https://playwright.dev/docs/emulation ,
  https://playwright.dev/docs/docker ; 2026 visual-regression guide:
  https://testquality.com/playwright-visual-regression-guide/
- Agent visual feedback loops:
  https://github.com/stevekinney/stevekinney.net/blob/main/courses/self-testing-ai-agents/visual-regression-as-a-feedback-loop.md
  and https://egghead.io/ai-driven-design-workflow-playwright-mcp-screenshots-visual-diffs-and-cursor-rules~aulxx

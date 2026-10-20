# NIGHT LOOP Operator Guide

NIGHT LOOP supervises one implementer session: Claude Code by default, or Codex or Grok Build when
`setup --provider` says so (decision 009). Native provider features supply the process, the
resumable conversation, optional workflows, and optional subagents. NIGHT LOOP adds the unattended
contract and the proof layer.

## Runtime flow

```text
setup
  -> contract.json (goal, provider, profile, limits, optional model and effort)
  -> start or full
  -> claude --bg with /goal, settings, plugin, and permission mode
  -> native Claude background session
  -> hooks append events and enforce the outer gate
  -> Stop hook runs the independent ratchet
  -> supervisor resumes a missing or stalled session
  -> HALTED done, blocked, or budget
  -> morning receipt
```

The launcher exits after native Claude accepts the background session. A small detached Bun monitor
polls `claude agents --json`, observes the durable STEP marker, and uses native resume when recovery
is required. No tmux, WSL, shell command concatenation, API key, or second implementer is required.

Turn-based providers follow the same shape with the supervisor driving each turn (decision 010):

```text
start or full
  -> NEXT_PROMPT = compiled goal
  -> detached supervisor
  -> codex exec --json ... or grok -p ... (one headless turn, hooks delivered natively)
  -> turn ends: session id recorded, last message checked for questions
  -> the unchanged Stop hook runs as the verifier
  -> block reason becomes NEXT_PROMPT, or HALTED ends the run
  -> next turn resumes the recorded session
```

A stalled turn (STEP unchanged for the configured ticks) or a non-zero exit is killed as a process
tree and counted against the relaunch budget. Five consecutive turns that end on a question halt the
run as `interaction_required` rather than burning the subscription on a conversation.

## State

Committed control files:

- `.night-loop/backlog.yaml`: checkable product contract
- `.night-loop/progress.md`: Done, Doing, Next, Blocked ledger
- `.night-loop/constraints.md`: durable policy
- `.night-loop/decisions/`: architectural decisions
- `.night-loop/ratchet.json`: exact hard-tier commands

Ignored runtime files:

- `state/contract.json`: attended Night Contract
- `state/run.json`: provider, native session id (short id and UUID for Claude), profile, limits,
  turn count, last `waitingFor`, and the redacted `claude logs` tail
- `state/claude-settings.json`: generated noninteractive settings
- `state/events.jsonl`: SHA-256 chained event tape
- `state/ACTIVE`: supervisor owns an active run
- `state/STEP`: Stop-hook progress counter
- `state/CLAIM_DONE`: implementer completion claim awaiting verification
- `state/ALL_BLOCKED`: only hard-blocked work remains
- `state/HALTED`: done, blocked, budget, or interaction_required
- `state/SUPERVISOR_PID` and `state/PROVIDER_PID`: the detached supervisor and the running turn
- `state/NEXT_PROMPT`: the verifier's block reason queued for the next provider turn
- `state/supervisor.json`: relaunches, last STEP, stall ticks, consecutive interaction turns
- `runs/*-morning.md` and `.json`: verified receipts

Generated into the host project for Grok only: `.grok/hooks/night-loop.json`, rewritten on every
start and resume, pointing at this checkout's hook bridge. Add it to the host's ignore file.

## Question Firewall

NIGHT LOOP handles structured Claude lifecycle events first:

- `PermissionRequest`: allow ordinary in-scope work, deny immutable external actions, never interrupt
  the rest of the build.
- `Elicitation`: cancel unattended MCP input requests.
- `Notification`: record permission, idle, elicitation, and agent-input signals.
- `StopFailure`: record recovery evidence.
- `SubagentStart` and `SubagentStop`: support worker-cap accounting.
- `TaskCreated` and `TaskCompleted`: preserve task evidence.
- `WorktreeCreate` and `WorktreeRemove`: preserve isolation evidence.
- `MessageDisplay` and `UserPromptSubmit`: provide question detection and workflow blocking.

The text interaction sentinel remains a fallback for phrases such as approval requests, edit
permission, confirmation, clarification, and user input. A detected question is evidence, never a
reason to leave the owner-facing command waiting.

## Permission profiles

Workspace is the default. It maps to Claude `dontAsk` plus a generated allowlist. Denied or missing
authority becomes a structured blocked action and the agent continues with reversible work.

Full maps to Claude `bypassPermissions`. It does not change the external gate, environment scrub,
worker cap, step cap, relaunch cap, test-only credential boundary, or production-cutover boundary.

The other providers map the same two profiles onto their own switches, never onto a prompt:

| Profile | Codex CLI | Grok Build |
|---|---|---|
| workspace | `--sandbox workspace-write`, `approval_policy="never"`, network on for installs | `--permission-mode dontAsk`, `--allow` for the seven ordinary tools, `--deny` for push, publish, and forced deletion |
| full | `--sandbox danger-full-access`, `approval_policy="never"` | `--permission-mode bypassPermissions`, the same `--deny` rules |

Both also get `--no-plan`, `--disable-web-search`, `--max-turns 100`, and `--no-subagents` at
`--workers 1` (Grok), or the hook overrides, `--dangerously-bypass-hook-trust`, and the armed
worker cap as `features.multi_agent=false` or `agents.max_concurrent_threads_per_session=N`
(Codex), so the NIGHT LOOP hooks run without a trust dialog and a later attended setup cannot
loosen a resumed run's cap.

The gate denies at least:

- push, publish, deploy, release, and production apply operations
- recursive forced deletion and database or schema drops
- direct network fetch commands during the unattended run
- production-environment writes
- writes to NIGHT LOOP hooks, plugin metadata, generated authority settings, or outside the repo

Security-surface source files may be built against seeded data and test credentials. They are
recorded for human review before production cutover.

## Completion

`/goal` improves Claude's transcript-level persistence, but it does not independently execute the
project harness. NIGHT LOOP therefore keeps the Stop-hook verifier:

1. Every turn runs the ratchet.
2. A red ratchet forces repair before new milestone work.
3. `CLAIM_DONE` triggers the full harness.
4. A red full harness removes the claim and injects the exact failing command.
5. A green full harness writes `HALTED=done` and releases the session.
6. `ALL_BLOCKED` writes `HALTED=blocked` only when no buildable work remains.
7. The configured step or recovery cap writes `HALTED=budget`.

Milestones still require the independent `night-loop-judge`. The judge is verification
infrastructure, not a parallel implementation lane.

## Recovery

The supervisor persists relaunch count, last STEP, and stall ticks. STEP progress resets the stall
counter. A missing native agent or bounded inactivity triggers native resume with deterministic
exponential backoff capped at ten minutes. Stop calls `claude stop <id>`, removes ACTIVE, and keeps
the contract, native session id, ledger, and receipts for later resume.

Claude's `--bg` banner prints only a short id. `status` resolves the full session UUID from
`claude agents --json` and stores both: `stop` and `logs` take the short id, `--resume` takes the
UUID (decision 012). A native `waitingFor` value is recorded once per transition as
`interaction_required` evidence.

For Codex and Grok the supervisor is the turn driver: the provider's pid is recorded while a turn
runs, a stop kills that process tree before the supervisor exits, and resume relaunches the same
provider with the armed profile and the recorded session id.

Resume also writes the armed profile, limits, model, effort, and provider back to
`state/contract.json` when a later attended setup changed them, and records `contract.restored`
in the tape (decision 014). The gate reads that file for its worker cap, so a resumed night can
never be loosened from disk; the new contract applies to the next `start`.

## Stuck detection and think turns

The supervisor keeps a slow brain next to the fast loop (decision 015):

1. After every turn (or poll, for Claude) it runs `detectStuck` over the tape since the last
   think or shelve: three identical `Ratchet is RED` lines, three turns each carrying the same
   `policy.blocked` category, or three identical working-tree fingerprints (git status, diff,
   and untracked contents) mean stuck.
2. A stuck verdict appends `stuck.detected`, a lesson, and schedules a think turn
   (`think.scheduled`). With `--consult`, a read-only consultant runs first (`consult.completed`,
   `state/CONSULT.md`).
3. The think turn is read-only and hook-light: the bridge skips the Stop, resume, and events
   hooks when `NIGHT_LOOP_THINK=1`, so a reasoning turn is never told to keep building. Its
   answer lands in `state/THINK.md`, its `PLAN:` line in `think.completed` and the lessons file,
   and the next build prompt is the verifier reason plus that plan.
4. For Claude the prompt is delivered with `claude --resume <uuid> --bg "<prompt>"`
   (`think.injected`); completion is read from STEP progress.
5. Episodes are counted per fingerprint. The third one shelves the path: a `SHELVED` line under
   Blocked in `progress.md`, `stuck.shelved` in the tape, and an instruction to pick another
   milestone. ACTIVE stays; the night continues.

State added for this: `.night-loop/lessons.md` (committed, appended by the supervisor),
`state/THINK.md`, `state/CONSULT.md`, `pendingThink` on the run, and `thinkEpisodes` plus
`progressFingerprints` in `supervisor.json`.

## Morning Receipt

Run:

```powershell
pwsh -File scripts/night-loop.ps1 morning
```

The command verifies the event hash chain and writes both machine-readable JSON and readable
Markdown. It includes all backlog criteria, exact harness events, judge and claim verdicts,
recoveries, blocked actions, current progress, selected limits, and rollback instructions. Treat a
`TAMPERED` ledger as a failed run.

## Doctor and failure behavior

`doctor` is read-only and noninteractive. It reports OS, architecture, Claude version, Bun version,
Git version, plugin and hook presence, and whether setup has been completed. Claude 2.1.300 is the
minimum (decision 012). Codex 0.160.0 and Grok Build 1.0.46 are the floors for the other providers.

If required authority or real ground truth is missing, the agent records a blocked milestone and
moves on. If the only remaining work is blocked, the run halts as blocked. NIGHT LOOP never invents
production credentials and never asks for them overnight.

## Product boundary

Public NIGHT LOOP drives one implementer per run through its installed subscription CLI: Claude
Code, Codex, or Grok Build (decision 009). It does not route between providers, run them in
competition, install `.apsolut-agents/`, or add a custom multi-agent control plane or worktree
multiplexer. Native workers are optional, bounded accelerators. Future channels or Remote Control
integrations may announce DONE or BLOCKED, but they must never become permission prompts.

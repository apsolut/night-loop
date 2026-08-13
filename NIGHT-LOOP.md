# NIGHT LOOP Operator Guide

NIGHT LOOP supervises one Claude Code implementer session. Native Claude features provide the
background process, resumable conversation, optional workflows, and optional subagents. NIGHT LOOP
adds the unattended contract and the proof layer.

## Runtime flow

```text
setup
  -> contract.json
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

## State

Committed control files:

- `.night-loop/backlog.yaml`: checkable product contract
- `.night-loop/progress.md`: Done, Doing, Next, Blocked ledger
- `.night-loop/constraints.md`: durable policy
- `.night-loop/decisions/`: architectural decisions
- `.night-loop/ratchet.json`: exact hard-tier commands

Ignored runtime files:

- `state/contract.json`: attended Night Contract
- `state/run.json`: current native session id, profile, and limits
- `state/claude-settings.json`: generated noninteractive settings
- `state/events.jsonl`: SHA-256 chained event tape
- `state/ACTIVE`: supervisor owns an active run
- `state/STEP`: Stop-hook progress counter
- `state/CLAIM_DONE`: implementer completion claim awaiting verification
- `state/ALL_BLOCKED`: only hard-blocked work remains
- `state/HALTED`: done, blocked, or budget
- `runs/*-morning.md` and `.json`: verified receipts

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
Git version, plugin and hook presence, and whether setup has been completed. Claude 2.1.139 is the
minimum for native background agents. Claude 2.1.154 is recommended for workflows.

If required authority or real ground truth is missing, the agent records a blocked milestone and
moves on. If the only remaining work is blocked, the run halts as blocked. NIGHT LOOP never invents
production credentials and never asks for them overnight.

## Product boundary

Public NIGHT LOOP is Claude-only. It does not install or call Codex, Grok, Agy, provider adapters,
`.apsolut-agents/`, custom multi-agent control planes, or worktree multiplexers. Native workers are
optional, bounded accelerators. Future channels or Remote Control integrations may announce DONE or
BLOCKED, but they must never become permission prompts.

<p align="center">
  <img src="assets/hero.png" alt="NIGHT LOOP autonomous overnight coding" width="100%">
</p>

# NIGHT LOOP

> Nobody special is needed. The whole point of NIGHT LOOP's design is that sessions are
> disposable. State lives in the repo (progress.md, the working tree, .night-loop/state/),
> not in the session that was killed. The SessionStart hook injects the ledger into any new
> session, so any Claude Code session in this repo can pick it up, including this one,
> right now. The "original orchestrator" is gone and doesn't matter.

A subscription coding agent does the work: Claude Code by default, or OpenAI Codex or xAI Grok Build
when you say so at setup. NIGHT LOOP proves it was safe to leave alone and actually done.

NIGHT LOOP wraps one native Claude Code background session (or one headless Codex or Grok Build
session) with a Night Contract, a zero-question firewall, immutable safety hooks, deterministic
completion checks, crash recovery, and a tamper-evident Morning Receipt.

It is intentionally not a provider router or custom multi-agent control plane: one provider per run,
chosen once while you are present, the same hooks and the same verifier for all three.

## Requirements

- Claude Code 2.1.300 or newer, already authenticated with your Claude subscription
- Optional, only for `--provider codex`: Codex CLI 0.160.0 or newer, signed in with ChatGPT
- Optional, only for `--provider grok`: Grok Build 1.0.46 or newer, signed in with `grok login`
- Bun 1.3.x
- Git
- On Windows: PowerShell. The built-in Windows PowerShell 5.1 works; PowerShell 7 (`pwsh`)
  is also supported. No WSL and no Git Bash are required.
- A trusted Git repository with a deterministic test harness

The floor rose from 2.1.139 on 2026-10-19 (decision 012): fail-closed hooks, bounded retries, and the `--bg` trust check all post-date it.

If anything is missing, `night-loop doctor` reports each failing check with a concrete fix,
and [HOWTO.md](HOWTO.md) carries the full install and troubleshooting guide.

## Quick start

Load this checkout as a Claude Code plugin while developing it:

```powershell
claude --plugin-dir D:\path\to\night-loop
```

Set the attended Night Contract once:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/night-loop.ps1 setup --goal "Build the approved backlog to a testable MVP" --workers 1
```

This is the built-in Windows PowerShell 5.1; no extra shell install is needed. `-ExecutionPolicy Bypass`
is required because the launcher script is unsigned, and it scopes to this single process only.
PowerShell 7 (`pwsh -File scripts/night-loop.ps1 ...`) runs the same launcher identically.

Then start the unattended run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/night-loop.ps1 start
```

POSIX shells use the same Bun core:

```sh
./scripts/night-loop.sh setup --goal "Build the approved backlog to a testable MVP" --workers 1
./scripts/night-loop.sh start
```

`start` uses Claude's `dontAsk` permission mode. For a trusted outer sandbox, this exact shortcut:

```text
night-loop full
```

follows the same code path as:

```text
night-loop start --permissions full
```

and maps to Claude's `bypassPermissions` mode. Full permission never disables NIGHT LOOP's outer
blocks on push, publish, deploy, destructive deletion, unapproved network fetch, production writes,
or control-plane changes.

## Commands

| Command | Behavior |
|---|---|
| `setup` | The only attended command. Records goal, provider, permission profile, limits, worker cap, and optional `--model`, `--effort`, and `--consult`. |
| `start` | Starts one native `claude --bg` session in `dontAsk` mode by default. For Codex or Grok, starts the detached turn supervisor. |
| `full` | Exact alias for `start --permissions full`, with no confirmation. |
| `status` | Combines durable state with `claude agents --json` and a redacted `claude logs` tail, or with the provider process state. |
| `stop` | Calls native `claude stop` (or kills the provider process tree), preserves the session id, contract, logs, and receipt evidence. |
| `resume` | Resumes the recorded session without upgrading permissions, limits, model, or effort. |
| `morning` | Writes Markdown and JSON receipts under `.night-loop/runs/`. |
| `doctor` | Checks the selected provider's version and login, Bun, Git, plugin files, hooks, platform, and configuration status. |

Every command after `setup` is noninteractive.

## Other providers: Codex and Grok Build

Pick the implementer once, at setup. Everything else stays identical: the same contract, the same
gate, the same Stop-hook verifier, the same receipt.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/night-loop.ps1 setup --goal "Build the approved backlog to a testable MVP" --provider codex
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/night-loop.ps1 start
```

| Profile | Claude Code | Codex CLI | Grok Build |
|---|---|---|---|
| `workspace` (default) | `--permission-mode dontAsk` | `--sandbox workspace-write` with `approval_policy="never"` | `--permission-mode dontAsk` with the generated allow and deny rules |
| `full` | `--permission-mode bypassPermissions` | `--sandbox danger-full-access` with `approval_policy="never"` | `--permission-mode bypassPermissions` with the same deny rules |

Claude runs as one background session that the Stop hook keeps working. Codex and Grok run one
headless turn per process, so the detached supervisor runs each turn, then executes the same Stop
hook as a verifier and feeds its exact block reason to the provider as the next prompt. Inside a turn
the NIGHT LOOP hooks also run natively: Codex receives them as config overrides on the command line,
and Grok reads a generated `.grok/hooks/night-loop.json` in the project (add it to your ignore file).
A small bridge in `src/hook-bridge.ts` only renames provider tool payloads to the Claude shape; the
gate, verifier, and resume injection are the same files for every provider.

All three use the owner's flat subscription login. Anthropic, OpenAI, and xAI API key variables are
scrubbed before every launch, and `doctor` is red when Codex is not signed in with ChatGPT or Grok
has no session token.

Exit codes: `0` success, including classified terminal states such as `interaction_required`
reported in the JSON output; `1` a red `doctor` report; `2` invalid arguments or a refused
command, with a JSON `invalid_arguments` object on stderr; `70` a provider launch or resume
failure. The seeded e2e `fixture` subcommand exits `42` when it classifies an interaction
request, so the sentinel is itself testable.

## The trust stack

1. The Night Contract compiles the attended goal and deterministic defaults into the initial
   `/goal` prompt, Claude settings, limits, and worker policy.
2. The Question Firewall handles PermissionRequest and MCP Elicitation events without a human,
   records notification and message signals, and detects question text as a fallback.
3. The PreToolUse gate stays outside both workspace and full permission profiles.
4. The Stop hook runs an independent ratchet. A model-written `CLAIM_DONE` is rejected while any
   exact harness command is red.
5. The native-session supervisor detects a missing or stalled background session and resumes it
   with bounded exponential backoff. For Codex and Grok it runs each headless turn, kills a stalled
   turn, and resumes the recorded session under the same bound.
6. The append-only JSONL event tape is SHA-256 chained. The Morning Receipt verifies the chain and
   reports criteria, tests, verdicts, recoveries, blocked actions, and rollback instructions.

## When it gets stuck: think turns, a second opinion, and lessons

Shelving a blocked milestone keeps the night going, but circling on the same failure used to
look like progress. The supervisor now reads its own event tape (decision 015):

- **Stuck detector.** The same red ratchet line, the same denied action category, or an unchanged
  working tree for three consecutive turns is a stuck verdict. It is deterministic and runs on
  every turn (Codex, Grok) or poll (Claude).
- **Think turn.** A stuck run gets one read-only turn: Codex in a `read-only` sandbox, Grok with
  allow rules for Read, Grep, and Glob only, Claude through native resume as its next turn. The
  prompt carries the evidence and asks for a root cause, three alternatives with costs, and one
  `PLAN:` line. The plan is appended to the next build prompt.
- **Second opinion.** `setup --consult codex` or `--consult grok` runs a fresh, ephemeral,
  read-only session of that other provider first and quotes its answer in the think prompt. It
  never edits and never sees an API key. Claude cannot be the consultant (decision 001).
- **Lessons.** Every recovery, stuck verdict, consult, and think outcome appends one line to
  `.night-loop/lessons.md`; resume and think prompts carry the last twelve. That is the memory
  across nights.
- **Bounds.** Two think turns per stuck fingerprint. The third episode shelves the path under
  Blocked in `progress.md` with the last plan attached and tells the agent to pick another
  milestone. Think turns count against the step cap like any other turn.

## Native parallelism, kept optional

`--workers 1` is the default and disables implementation subagents. `--workers auto` caps native
Claude subagents or workflows at four. An explicit integer caps them from 1 to 16. Workers are an
accelerator only. They never own the primary session, safety hooks, ledger, or independent judge.

NIGHT LOOP does not depend on experimental agent teams, cross-session messaging, Remote Control,
or channels. Cross-session messaging is not available on native Windows today. Remote Control and
channels are appropriate later for DONE or BLOCKED notifications, not execution-time permissions.
The built-in `/batch` and `/autofix-pr` workflows are blocked during unattended runs because their
normal behavior can create branches, push, or open pull requests.

Current Claude references: [goal](https://code.claude.com/docs/en/goal),
[background agents](https://code.claude.com/docs/en/agent-view),
[workflows](https://code.claude.com/docs/en/workflows),
[hooks](https://code.claude.com/docs/en/hooks),
[plugins](https://code.claude.com/docs/en/plugins), and
[permission modes](https://code.claude.com/docs/en/permission-modes).

## Safety reality

Hooks are policy enforcement, not a kernel sandbox. Run `full` only inside a container, VM, or
equivalent outer jail with no production credentials and restricted egress. NIGHT LOOP scrubs
Anthropic, OpenAI, and xAI API key variables before launch and is designed to use the installed
subscription session of whichever provider you selected.
Git remains the recovery net. Review all security-surface notes before production cutover.

## Verification

```sh
bun install --frozen-lockfile
bun run build
bun run typecheck
bun run lint
bun run test:unit
bun run test:e2e
bun run test:screenshot
bun run perf
```

CI defines the same deterministic suite on Windows, Linux, and macOS (certified from live runner
evidence, M6).

### Live smoke against the real Claude Code

```sh
bun run smoke:live            # or: bun run smoke:live --probe-only
```

The runner launches the installed Claude Code twice with every metered key unset: a bounded probe
in an empty folder (must end `done`, answer without a question, and leave no file), then one
seeded backlog task in the jail `.night-loop/state/live-smoke/jail` through the ordinary `setup`,
`start`, supervisor, gate, and Stop-hook path. The script verifies the fixture file, the untouched
local bare remote, the gate denials, and the halt reason itself, then writes a redacted,
credential-scanned record to `.night-loop/research/`. The jail is a git repository, so Claude
treats it as its own project: trust that exact path once in an attended `claude` session, or the
runner exits 4 with that instruction (decision 016). The probe needs no trust step.

See [NIGHT-LOOP.md](NIGHT-LOOP.md) for the operator protocol and
[judge-and-flake-reliability.md](judge-and-flake-reliability.md) for the evidence model.

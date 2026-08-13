<p align="center">
  <img src="assets/hero.png" alt="NIGHT LOOP autonomous overnight coding" width="100%">
</p>

# NIGHT LOOP

Claude Code does the work. NIGHT LOOP proves it was safe to leave alone and actually done.

NIGHT LOOP wraps one native Claude Code background session with a Night Contract, a zero-question
firewall, immutable safety hooks, deterministic completion checks, crash recovery, and a
tamper-evident Morning Receipt.

It is intentionally not a provider router or custom multi-agent control plane.

## Requirements

- Claude Code 2.1.139 or newer, already authenticated with your Claude subscription
- Bun 1.3.x
- Git
- A trusted Git repository with a deterministic test harness

Claude Code 2.1.154 or newer is recommended if you opt into native workflows.

## Quick start

Load this checkout as a Claude Code plugin while developing it:

```powershell
claude --plugin-dir D:\path\to\night-loop
```

Set the attended Night Contract once:

```powershell
pwsh -File scripts/night-loop.ps1 setup --goal "Build the approved backlog to a testable MVP" --workers 1
```

Then start the unattended run:

```powershell
pwsh -File scripts/night-loop.ps1 start
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
| `setup` | The only attended command. Records goal, permission profile, limits, and worker cap. |
| `start` | Starts one native `claude --bg` session in `dontAsk` mode by default. |
| `full` | Exact alias for `start --permissions full`, with no confirmation. |
| `status` | Combines durable state with `claude agents --json`. |
| `stop` | Calls native `claude stop`, preserves the session id, contract, logs, and receipt evidence. |
| `resume` | Resumes the native session without upgrading permissions or limits. |
| `morning` | Writes Markdown and JSON receipts under `.night-loop/runs/`. |
| `doctor` | Checks Claude, Bun, Git, plugin files, hooks, platform, and configuration status. |

Every command after `setup` is noninteractive.

## The trust stack

1. The Night Contract compiles the attended goal and deterministic defaults into the initial
   `/goal` prompt, Claude settings, limits, and worker policy.
2. The Question Firewall handles PermissionRequest and MCP Elicitation events without a human,
   records notification and message signals, and detects question text as a fallback.
3. The PreToolUse gate stays outside both workspace and full permission profiles.
4. The Stop hook runs an independent ratchet. A model-written `CLAIM_DONE` is rejected while any
   exact harness command is red.
5. The native-session supervisor detects a missing or stalled background session and resumes it
   with bounded exponential backoff.
6. The append-only JSONL event tape is SHA-256 chained. The Morning Receipt verifies the chain and
   reports criteria, tests, verdicts, recoveries, blocked actions, and rollback instructions.

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
Claude API key variables before launch and is designed to use the installed subscription session.
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

CI defines the same deterministic suite on Windows, Linux, and macOS. Cross-OS certification and a
live authenticated Claude smoke remain hard-blocked until those external runners and test
authentication are available.

See [NIGHT-LOOP.md](NIGHT-LOOP.md) for the operator protocol and
[judge-and-flake-reliability.md](judge-and-flake-reliability.md) for the evidence model.

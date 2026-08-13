# 004 - Native Claude trust layer

Date: 2026-08-13
Milestones: M1 through M5

## Decision

NIGHT LOOP is a thin trust and certification layer over one native `claude --bg` session. It uses
`/goal`, `dontAsk` by default, an exact `full` alias for `bypassPermissions`, immutable outer hooks,
a bounded native-session monitor, a SHA-256 chained event tape, and a deterministic Morning Receipt.
Optional workers use only native Claude workflows or subagents under the configured cap.

## Why

Claude Code now supplies background sessions, JSON status, stop, resume, goals, workflows, plugins,
and lifecycle hooks. Rebuilding those features would increase failure surface without improving the
core promise: zero questions after setup and independent proof of completion.

## Rejected

- tmux or WSL as supervisor requirements
- provider adapters or custom multi-agent orchestration
- model-authored completion without the independent harness
- channels or Remote Control as permission surfaces
- `/batch` and `/autofix-pr` during unattended runs

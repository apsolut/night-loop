# 016 - Live Claude smoke: trust is per git root, so the jail is trusted once by the owner

Date: 2026-10-20
Milestone: M7

## Decision
`bun run smoke:live` (scripts/live-smoke.ts) is the M7 runner. It launches the real Claude Code
CLI twice: a bounded probe in a fresh plain folder under `.night-loop/state/live-smoke/`, then
one seeded backlog task in the stable jail `.night-loop/state/live-smoke/jail` through the
ordinary `setup`, `start`, and supervisor path. The script, never the agent, verifies the fixture
file, the untouched bare remote, the gate denials, and the halt reason, then writes a redacted and
credential-scanned record to `.night-loop/research/<date>-live-claude-smoke.{json,md}`.

The jail is a git repository, so Claude treats it as its own project and `claude --bg` refuses it
until that exact path has been trusted once in an attended `claude` session. The script detects
that refusal and exits 4 with the one-line remediation. The probe needs nothing: a plain folder
inherits trust from the enclosing checkout.

## Why (probed on 2026-10-20, Claude Code 2.1.304)
- A plain folder under the trusted checkout launches `--bg` and reaches `state: done` in 12 s.
- The same folder with its own `.git` directory is refused: "Workspace not trusted".
- A git worktree (`.git` file) of a throwaway repository nested under the checkout is refused too.
- Exporting `GIT_DIR` and `GIT_WORK_TREE` makes the launch succeed, but the agent's shell then
  resolved git to the enclosing checkout (its `git log` showed this repository's history), so a
  jail built that way would let the agent commit into the real repository. Rejected as unsafe.
- Seeding `~/.claude.json` trust entries programmatically was rejected: the owner's global
  config is out of the workspace and out of scope for an unattended build (decision 005 spirit).

## Rejected
- `claude -p` for the task (skips the trust dialog): excluded by decision 001.
- Running the task inside this checkout itself: the smoke must never commit to the product repo.
- Claude think-turn enforcement in the gate by `run.json.pendingThink.injectedStep`: the think
  prompt is queued behind an in-flight build turn, so the step window is ambiguous. Claude think
  turns stay instruction-only until live evidence shows the delivery order (TODO.md).

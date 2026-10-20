# Live Claude smoke, probe half, 2026-10-20

Probe half of M7 on the maintainer's Windows 11 box against the owner-approved test
authentication. The machine record is `2026-10-20-live-claude-smoke-probe.json`, written by
`bun run smoke:live --probe-only` (scripts/live-smoke.ts) and checked by
test/unit/live-smoke.test.ts; this note is the human-readable transcription of that record and of
the two earlier full-runner attempts whose probe halves passed before the jail launch was refused.
The task half did not run: see "Why the task half is pending" and decision 016. The full JSON
record is only written when both halves complete.

| Field | Value |
|---|---|
| Claude Code | 2.1.304 (Claude Code), floor 2.1.300 |
| Platform | win32 x64 |
| Probe cwd | fresh empty folder under `.night-loop/state/live-smoke/` (no git, trust inherited from the checkout) |
| Launch | `claude --bg --name nl-smoke-probe --permission-mode dontAsk "<probe prompt>"` with every metered key unset |
| Native state | `done` (from `claude agents --json --all`); full-runner attempts 12 s and 14 s, probe-only record: see JSON |
| Checkout untouched | `git status --porcelain` of this checkout identical before and after (probe-only record) |
| Reply | `PROBE-OK` (read from the native transcript, last assistant text block) |
| Interaction requested | false (isInteractionRequest over the reply) |
| Files after | none (readdir of the probe folder) |
| Stopped by timeout | false (bound: 20 min, then `claude stop`) |
| Credential-shaped content | none in the launch output, the reply, or this note |

The same probe was first established by hand earlier the same day (session `nl-trust-probe`,
state `done`, empty folder unchanged), before the runner existed.

## Why the task half is pending

The jail is a git repository, so Claude Code treats it as its own project and `claude --bg`
refuses it: "Workspace not trusted. Run `claude` in <jail> once and accept the trust prompt,
then retry." Nested git roots and worktrees under the trusted checkout are refused the same way;
only plain folders inherit trust. The runner detects the refusal and exits 4 with the one-line
remediation. The attended step and the rerun command are in TODO.md.

Two workarounds were tried and rejected (decision 016): `GIT_DIR`/`GIT_WORK_TREE` in the session
environment launched, but the agent's shell resolved git to this checkout, which would let the
smoke commit into the product repository; and seeding the owner's `~/.claude.json` trust entry
programmatically is outside the workspace and outside an unattended build's authority.

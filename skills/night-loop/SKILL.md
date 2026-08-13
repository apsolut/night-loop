---
name: night-loop
description: Set up, start, inspect, resume, stop, or review an unattended NIGHT LOOP run. Use when the user asks Claude Code to keep building without execution-time questions and prove completion with the project harness.
---

# NIGHT LOOP

NIGHT LOOP wraps one native Claude Code session with a durable contract, safety hooks, and
independent verification. It does not route work to other model providers.

Run every command through the repository's single Bun entry point:

```sh
bun "$CLAUDE_PLUGIN_ROOT/src/cli.ts" <command> [options]
```

Use `setup` while the owner is present. During setup, capture the goal, permission profile,
limits, test-only boundaries, and any hard blocks. After setup, `start`, `full`, `status`,
`resume`, `stop`, and `morning` must never ask the owner a question.

Prefer `start` for workspace permissions. Treat `full` as the exact alias of
`start --permissions full`; it expands Claude's workspace authority but never weakens the
outer block on push, publish, deploy, destructive deletion, unapproved network fetch, or
production writes.

Keep one implementation session active. Native Claude subagents or workflows may be used only
within the configured worker cap. The `night-loop-judge` agent remains separate and verifies
milestones from harness evidence.

Do not claim completion from prose. The Stop hook and full harness decide whether the run is
done. Use the morning receipt to report criteria, exact tests, judge verdicts, recoveries,
blocked actions, and rollback evidence.

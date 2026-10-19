# 011 - The provider hook bridge normalizes payloads and delegates; it never decides

Date: 2026-10-19
Milestone: M9

## Decision
`src/hook-bridge.ts <hook> --provider <id>` reads a Codex or Grok hook payload, rewrites it to
the Claude shape the control-plane hooks expect (`run_terminal_command` to `Bash`,
`search_replace` and `write_file` to `Write`, `apply_patch` expanded into one `Write` per
touched path), sets `CLAUDE_PROJECT_DIR` and `NIGHT_LOOP_MAX_STEPS`, and spawns the unchanged
hook under `.night-loop/hooks/`. The first deny wins and additional context is merged. The
bridge lives in `src/` because the PreToolUse gate marks `.night-loop/hooks/` immutable, so a
build session cannot add files there (decision 005).

## Why
The gate, verifier, and resume injection stay single-sourced and judge-certified. The bridge
only translates names and paths.

## Attended follow-up
The owner may move the bridge under `.night-loop/hooks/` and add it to the gate's
control-plane list in a session where the gate is not armed. Until then it is covered by the
e2e specs that drive it with seeded Codex and Grok payloads.

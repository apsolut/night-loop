# TODO: what only the owner can decide or do

Everything below needs either an attended action (trust, control-plane edit, push) or a
product decision. Everything that did not need you is already built, tested, and committed.
Items are in the order that unblocks the most.

## 1. Trust the smoke jail once, then run the live Claude smoke (M7)

Claude Code refuses `claude --bg` in any directory that is its own git root until that exact
path has been trusted in an attended session, and the smoke jail must be a git root so the
agent can commit (decision 016). One-time step:

```powershell
cd D:\sites\git\night-loop\.night-loop\state\live-smoke\jail
claude          # accept the workspace trust prompt, then /exit
cd D:\sites\git\night-loop
bun run smoke:live
```

What the second command does: a bounded probe in an empty folder (already proven green twice,
see `.night-loop/research/2026-10-20-live-claude-smoke-probe.md`), then one seeded task in the
jail through the real `setup`, `start`, supervisor, gate, and Stop-hook path, with a local bare
remote so the push attempt in the seeded backlog is denied and provably lands nowhere. It writes
`.night-loop/research/<date>-live-claude-smoke.{json,md}`, redacted and credential-scanned. Exit
0 means both halves passed. Then, in a Claude session in this repo, invoke the
`night-loop-judge` subagent for `M7-live-claude-smoke`, record the verdict in
`.night-loop/progress.md`, and commit.

Decision for you: keep the jail inside the checkout (default) or point `--dir` at a folder you
trust elsewhere. Both work; the default keeps everything ignored by git.

## 2. Apply the control-plane patch (decision 012 plus think-turn enforcement)

The build agent may not touch `.night-loop/hooks/` or `hooks/hooks.json` (decision 005), so the
edits are a patch, validated green in a throwaway worktree:

```powershell
git apply .night-loop/attended/decision-012.patch
bun run typecheck; bun run lint; bun run test:unit; bun run test:e2e
git add -A; git commit -m "Apply decision 012: fail-closed gate, armed worker cap, read-only think turns"
```

What it changes:
- `hooks/hooks.json`: `onFailure: block` on PreToolUse, `timeout: 1800` on Stop (a slow full
  harness no longer fails open).
- `.night-loop/hooks/gate.ts`: an unparseable payload is denied instead of allowed; the worker
  cap reads `NIGHT_LOOP_WORKERS` (exported by the armed run) before `contract.json`; with
  `NIGHT_LOOP_THINK=1` (Codex and Grok think and consult turns) Edit, Write, and MultiEdit are
  denied with a `think_turn_read_only` event while Bash reads and the escape rules keep working.
- `test/e2e/gate-attended.test.ts`: four specs pinning each of those behaviors.

Decision for you: whether the think-turn denial should also cover mutating Bash commands.
Today the provider sandbox (Codex read-only, Grok Read/Grep/Glob allow rules) covers that layer.

## 3. Claude think turns: instruction-only until live evidence exists

For Claude the think prompt is delivered with `claude --resume <uuid> --bg "<prompt>"` while a
build turn is usually in flight, so the gate cannot tell the think turn from the tail of that
build turn by step number (decision 016, rejected section). Options, in my order of preference:
- Observe one live stuck episode (the M7 jail can seed one: a ratchet command that always fails)
  and read the transcript to learn whether the queued prompt lands before or after the Stop
  hook's continuation. Then decide the marker.
- Accept instruction-only think turns for Claude and say so in the Morning Receipt.

## 4. Jev, or any model-driven stuck classifier (proposed M12)

Deferred behind an amendment to decision 001 (flat subscription billing only). Jev on the Vercel
AI Gateway is metered per call. The deterministic detector (decision 015) covers repeated red
lines, repeated denied categories, and an unchanged tree. If you want the fuzzy half:
- Amend decision 001 with a per-night cap and a kill switch, or
- Route the classification through the read-only consultant that already exists
  (`setup --consult codex|grok`), which stays on subscription billing.

## 5. Smaller decisions

- CI pins Bun 1.3.8; this box runs 1.3.14. Bump `ci.yml` or keep the older pin deliberately.
- M5's container clause: `docker run` of the Linux fixture has never executed. Start Docker
  Desktop once and run it, or strike the clause.
- `.night-loop/state/ALL_BLOCKED` exists in this checkout from an earlier run of the loop on
  itself. `start` clears it; nothing else reads it. Delete it if it bothers you.
- Push after each commit: `git push origin main` is denied from inside any Claude session by
  design, so it stays yours.

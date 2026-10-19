# Provider surfaces verified on 2026-10-19

Ground truth captured on the maintainer's Windows 11 box from the installed CLIs, not from
marketing pages. Each bullet marked PROBED was executed here; DOCS means read from the
vendor's bundled or published documentation; RESEARCH means a web survey by a research
subagent on the same day.

## Claude Code 2.1.303

- PROBED `claude --bg --name nl-probe --exec "cmd /c echo probe-ok"` prints
  `backgrounded · d4e5f79a · nl-probe` plus four hint lines. No UUID appears, so the
  pre-M10 `parseBackgroundSessionId` returns undefined on a real launch.
- PROBED `claude agents --json --all --cwd <repo>` returns records with `id` (short id used by
  attach, logs, stop, rm), `sessionId` (full UUID, usable with `--resume`), `name`, `kind`
  (`interactive` or `background`), `state` (`working`, `blocked`, `done`, `failed`,
  `stopped`), `status` while alive (`busy`, `waiting`, `idle`), `pid`, `cwd`, `startedAt`.
  `waitingFor` appears when `status` is `waiting`.
- DOCS/RESEARCH changelog 2.1.215 to 2.1.303: hooks accept `onFailure: "block"` (2.1.295);
  PreToolUse and PermissionRequest fail closed on matcher failure (2.1.288) and on Windows
  without Git for Windows (2.1.300); `--bg` exits if workspace trust was never granted
  (2.1.282); `--resume <id> --bg` on a running session delivers the prompt as its next turn
  (2.1.284); `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` raises the eight-continuation cap on
  text-only turns; `CLAUDE_CODE_RESUME_INTERRUPTED_TURN=1` resumes a turn cut by SIGTERM;
  `--effort`, `--fallback-model`, `claude logs <id|name>`, `claude respawn`, `claude rm`.
  Recommended floor for unattended use: 2.1.300.
- DOCS `/goal` is transcript-only and cannot run commands; the Stop-hook verifier stays.
- DOCS `claude plugin eval` runs child `claude -p` sessions; billing for those runs is not
  documented, so it stays out of the unattended loop (decision 001).

## OpenAI Codex CLI 0.162.0

- PROBED `codex login status` prints `Logged in using ChatGPT` on a subscription login.
- PROBED `codex exec --json -c 'approval_policy="never"' -s read-only -C <dir>
  --skip-git-repo-check -o <file> "<prompt>"` emits JSONL: `thread.started {thread_id}`,
  `turn.started`, `item.completed {item: {type: agent_message, text}}`,
  `turn.completed {usage}`. Exit 0. Stdin must be closed or it blocks on
  `Reading additional input from stdin...`.
- PROBED `-s workspace-write` creates files on Windows with no prompt.
- PROBED project `.codex/hooks.json` fires only when the project is trusted
  (`-c 'projects."<abs path>".trust_level="trusted"'`) and hook trust is bypassed
  (`--dangerously-bypass-hook-trust`). Payload is snake_case: `hook_event_name`,
  `session_id`, `cwd`, `model`, `permission_mode`, `tool_name` (`Bash`, `apply_patch`),
  `tool_input` (`command`), `tool_use_id`; Stop adds `stop_hook_active` and
  `last_assistant_message`. No `CLAUDE_PROJECT_DIR` env is set for hooks.
- PROBED hooks also load from config overrides with no project file:
  `-c 'hooks.Stop=[{hooks=[{type="command",command="..."}]}]'`.
- DOCS `codex exec resume <id> "<prompt>"` resumes; `--full-auto` was removed in 0.147;
  Stop hook `{"decision":"block","reason":"..."}` creates a continuation prompt;
  `codex doctor --json` exists; `codex features list` shows `hooks`, `goals`,
  `multi_agent`, `guardian_approval` stable.

## xAI Grok Build 1.0.46

- PROBED `grok -p "<prompt>" --output-format json --permission-mode dontAsk --max-turns 1
  --cwd <dir> --no-subagents --disable-web-search` returns one JSON object with `text`,
  `stopReason`, `sessionId` (UUIDv7), `requestId`, `usage`, `num_turns`, `modelUsage`.
- PROBED with `--trust`, hooks declared in the project `.claude/settings.json` fire in
  headless mode and receive `CLAUDE_PROJECT_DIR`. Payload carries both camelCase and
  snake_case keys (`tool_name`, `tool_input`, `session_id`, `hook_event_name`). Tool names
  are Grok's own: `run_terminal_command` (`command`), `search_replace` (`file_path`,
  `old_string`, `new_string`). Stop payload carries `reason` (`end_turn` or `shutdown`),
  `stopHookActive`, `lastAssistantMessage`.
- PROBED hooks placed in a `GROK_CONFIG_PATH` overlay do not load (overlay keys are
  allowlisted). Project hooks need `.claude/settings.json` or `.grok/hooks/*.json` plus
  folder trust.
- PROBED live loop: `night-loop start` with `--provider grok` ran four resumed headless turns
  under `dontAsk` with the generated allow and deny rules, created the seeded file, claimed
  done, and halted as done after the full harness. Codex did the same in one turn.
- PROBED (2026-10-20) hook command form on Windows, from `.grok/hooks/night-loop.json` in a
  trusted folder: `"C:/.../bun.exe" "C:/.../hook.ts" args` does NOT run (Grok's hook runner
  is PowerShell, where a quoted path is a string expression); `& "C:/.../bun.exe" "..." args`
  runs; a bare unquoted absolute path runs. Codex is the reverse: the quoted form runs and the
  `&` form does not. `~/.grok/logs/hooks.log` holds the discovery trace of the latest session
  (`hooks: loaded from project source ... count=N`) and is the first place to look when a hook
  stays silent.
- DOCS `--resume <id>` for headless resume; `--session-id <uuid>` pre-assigns the id of a
  NEW session; `dontAsk` denies anything not allowlisted; `bypassPermissions` still honors
  deny rules and hooks; Stop hooks may block up to eight continuations per turn; headless
  exit codes 0, 1, 130, 143. Auth lives in `~/.grok/auth.json` from `grok login`
  (OAuth, subscription); `XAI_API_KEY` is only a fallback and must be scrubbed.

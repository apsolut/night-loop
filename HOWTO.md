# NIGHT LOOP HOWTO: install, verify, troubleshoot

This guide covers everything `night-loop doctor` can flag: how to install each
prerequisite, how to read the doctor report, and how to fix the errors people
actually hit. If doctor is red, its `remediation` array points at the matching
section here.

## 1. Install the prerequisites

### Claude Code (2.1.139 or newer)

Follow https://claude.com/claude-code for your platform, then authenticate with
your Claude subscription:

```
claude --version
claude   # first run walks you through login
```

2.1.154 or newer is recommended if you opt into native workflows.

### Bun (1.3.x)

Windows (stock PowerShell 5.1 works, no admin needed):

```powershell
powershell -c "irm bun.sh/install.ps1 | iex"
```

macOS and Linux:

```sh
curl -fsSL https://bun.sh/install | bash
```

The installer adds Bun to your user PATH. Open a NEW terminal (or restart your
editor) afterwards so running processes inherit the updated PATH, then verify:

```
bun --version
```

### Git

https://git-scm.com/downloads, then `git --version`. Any recent version works.

### Windows shell note

The quick start runs on the built-in Windows PowerShell 5.1. PowerShell 7
(`pwsh`) also works but is not required. No WSL and no Git Bash are required.

The documented commands pass `-NoProfile -ExecutionPolicy Bypass` because the
launcher script is unsigned and stock Windows defaults to the Restricted
execution policy. The bypass scopes to that single process; it does not change
your machine policy.

## 2. Verify with doctor

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/night-loop.ps1 doctor    # Windows
./scripts/night-loop.sh doctor                                                       # macOS / Linux
```

The report is JSON:

- `status`: `green` means every check passed; `red` sets exit code 1.
- `checks`: `claude`, `git`, `bun`, `plugin`, `hooks`. Each is a boolean.
- `configured`: whether this repository already has a Night Contract
  (`false` is normal before attended setup).
- `versions`: the exact binaries doctor talked to.
- `pathResolution.bunOnPath`: whether the plain command `bun` resolves on PATH.
  Doctor itself runs under a known Bun binary, so this can be `false` while
  `checks.bun` is `true`. See section 3, first entry, for why that matters.
- `remediation`: empty when everything is healthy; otherwise one actionable
  fix per problem, each pointing back to this file.

Doctor never edits anything. Run it as often as you like.

## 3. Common errors and their fixes

### "PreToolUse:Bash hook error ... bun: command not found"

Symptom: every tool call in a Claude Code session logs a hook error like:

```
PreToolUse:Bash hook error
Failed with non-blocking status code: /usr/bin/bash: line 1: bun: command not found
```

Cause: the editor process that launched Claude Code cannot resolve a Bun
binary. The NIGHT LOOP hooks in `.claude/settings.json` route through
`.night-loop/hooks/with-bun.sh`, which looks for Bun on PATH and then falls
back to `BUN_INSTALL` and the default `~/.bun` install location; the error
appears when none of those resolve (for example, Bun was never installed with
the official installer). Doctor shows the PATH half of this as
`pathResolution.bunOnPath: false`.

Consequence: the failures are non-blocking, which means the safety gate is
silently NOT enforcing anything. Do not arm an overnight run in this state.

Fix: install Bun with the official installer (it registers the PATH entry), or
add Bun's directory to your user PATH manually, then fully restart your editor
so the new PATH is inherited. Verify with `bun --version` in a fresh terminal
and re-run doctor.

### "claude: command not found" or doctor reports checks.claude false

Claude Code is not installed, not on PATH, or older than 2.1.139. Reinstall
from https://claude.com/claude-code and confirm `claude --version` in a fresh
terminal. If the version is current but doctor still fails, your editor is
holding a stale PATH; restart it.

### Hook errors mention "unexpected EOF" or broken quoting

`.claude/settings.json` was hand-edited and a hook command string lost its
quoting. Restore it from git (`git checkout -- .claude/settings.json`) rather
than patching by eye, then let `night-loop setup` re-apply configuration.
Claude Code snapshots hook config at session start, so restart the session
after fixing the file.

### "NIGHT LOOP control-plane files are immutable during a run"

Working as intended. While a run is armed, the gate refuses any write into
`.night-loop/hooks/` and other control-plane files, including from the build
agent itself. Stop the run first (`night-loop stop`) if you genuinely need to
change the control plane, and treat any unexpected occurrence of this message
as a red flag worth reading the event ledger for.

### e2e tests flake with EBUSY on Windows

Windows releases directory handles lazily, so a fixture cleanup can race the
process that just exited. The suite already retries bounded EBUSY errors in
`withFixtureRepo`; if you see it elsewhere, rerun once before suspecting the
code. A reproducible failure is never a flake: revert the change that caused
it, do not weaken the test.

### `pwsh` not found on Windows

`pwsh` is PowerShell 7, a separate install. You do not need it: every
documented command uses the built-in `powershell` 5.1, and `pwsh` is only an
optional alternative that runs the same launcher identically.

## 4. Staying current

- Bun: `bun upgrade` updates in place. NIGHT LOOP targets 1.3.x; check
  `package.json` before jumping a major version.
- Claude Code: `claude update` (or your package manager). Doctor enforces the
  minimum version, not the latest, so update on your own schedule.
- After any upgrade, run doctor once and, before an overnight run, run the
  full harness: `bun run typecheck && bun run lint && bun run test:unit`.

## 5. Where state lives (recovery in one paragraph)

Sessions are disposable by design. Everything needed to resume lives in the
repository: `.night-loop/progress.md` (the ledger), `.night-loop/state/`
(run markers and the event tape), and the git working tree. If your editor
crashes or the machine reboots mid-run, start a new Claude Code session in the
repo; the SessionStart hook injects the ledger and work continues. Nothing of
value is stored in the killed session.

# Claude hooks invoke bun through with-bun.sh

Claude on Windows runs hook commands in Git Bash. That PATH often omits nvm and
~/.bun, so a bare `bun` command fails with "command not found" and skips
SessionStart, PreToolUse, and Stop. Hooks now call
`sh .../with-bun.sh <hook.ts>`, which searches PATH then known install locations.

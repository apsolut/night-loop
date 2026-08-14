# generatedSettings sets worktree.bgIsolation to none

Unattended `claude --bg` sessions refuse checkout edits until EnterWorktree unless
project settings set `worktree.bgIsolation: none`. That prompt is an execution-time
question, so generated Night Contract settings emit the same flag the project
`.claude/settings.json` already carries.

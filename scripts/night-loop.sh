#!/usr/bin/env bash
# NIGHT LOOP supervisor. Drives an INTERACTIVE `claude` session in tmux so it stays on the
# flat interactive Max limits (not the metered headless credit). The Stop hook keeps the
# session working between turns; this script only (re)launches across session ends, pauses,
# and stalls, and stops when the loop halts (done / gate / budget).
#
# Run inside the Docker jail (see Dockerfile). Auth must already be present (mount ~/.claude).
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
NL=".apsolut/night-loop"
SESSION="nightloop"
MAX_RELAUNCH=${NIGHT_LOOP_MAX_RELAUNCH:-200}
STALL_TICKS=${NIGHT_LOOP_STALL_TICKS:-80}   # 80 ticks x 15s = 20 min of no STEP progress
PERM_MODE=${NIGHT_LOOP_PERM_MODE:-acceptEdits}   # use bypassPermissions ONLY inside the jail

mkdir -p "$NL" ".apsolut/runs" ".apsolut/decisions"

KICKOFF=${1:-"Read CLAUDE.md and .apsolut/backlog.yaml, then begin NIGHT LOOP. Build the next unmet milestone, M0 first. Do not stop until the harness proves the build done or a gate halts you."}

# ---- arm the loop (the Stop hook only engages when ACTIVE exists) ----
echo "0" > "$NL/STEP"
rm -f "$NL/HALTED" "$NL/CLAIM_DONE" "$NL/ALL_BLOCKED" "$NL/REVIEW"
touch "$NL/ACTIVE"
echo "[night-loop] armed. perm-mode=$PERM_MODE max-steps=${NIGHT_LOOP_MAX_STEPS:-2000}"

launch() {
  tmux kill-session -t "$SESSION" 2>/dev/null
  # When claude exits (crash / limit), the session command ends and the tmux session dies,
  # which this script detects below. On a normal Stop (done/gate) the Stop hook writes HALTED.
  tmux new-session -d -s "$SESSION" "claude --permission-mode $PERM_MODE; echo EXIT > $NL/CLAUDE_EXIT"
  sleep 5
  tmux send-keys -t "$SESSION" "$KICKOFF" Enter
  echo "[night-loop] launched session."
}

launch
relaunch=0
last_step="-1"
stall=0

while [ -f "$NL/ACTIVE" ]; do
  # Halt requested by the Stop hook (done / blocked / budget): stop cleanly. A single gated
  # milestone never halts; the loop shelves it and keeps building (see .claude/hooks/loop.ts).
  if [ -f "$NL/HALTED" ]; then
    reason="$(cat "$NL/HALTED" 2>/dev/null)"
    echo "[night-loop] HALTED: $reason"
    case "$reason" in
      done)    echo "[night-loop] MVP ready: full harness green. Review and test it." ;;
      blocked) echo "[night-loop] all buildable work is done; shelved milestones await your call (see digest + progress.md Blocked)." ;;
      budget)  echo "[night-loop] step cap hit (NIGHT_LOOP_MAX_STEPS). Inspect, raise the cap, re-run to continue." ;;
    esac
    tmux kill-session -t "$SESSION" 2>/dev/null
    break
  fi

  # Stall / session-end detection.
  cur="$(cat "$NL/STEP" 2>/dev/null || echo 0)"
  if [ "$cur" = "$last_step" ]; then stall=$((stall + 1)); else stall=0; last_step="$cur"; fi

  if ! tmux has-session -t "$SESSION" 2>/dev/null || [ "$stall" -ge "$STALL_TICKS" ]; then
    if ! tmux has-session -t "$SESSION" 2>/dev/null; then why="session-ended (crash/limit)"; else why="stalled ${STALL_TICKS} ticks (rate-limit at prompt?)"; fi
    relaunch=$((relaunch + 1))
    if [ "$relaunch" -gt "$MAX_RELAUNCH" ]; then echo "[night-loop] max relaunch reached, stopping."; break; fi
    # Exponential backoff, capped at 10 min, to ride out rate-limit windows.
    delay=$(( relaunch < 6 ? (1 << relaunch) * 10 : 600 ))
    echo "[night-loop] $why -> resume #$relaunch after ${delay}s"
    stall=0
    sleep "$delay"
    KICKOFF="Resume NIGHT LOOP from .apsolut/progress.md and git state. Continue the next unmet milestone."
    launch
  fi

  sleep 15
done

rm -f "$NL/ACTIVE"
echo "[night-loop] stopped."

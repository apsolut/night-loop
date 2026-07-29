#!/usr/bin/env bun
// SessionStart hook. Each fresh or resumed session forgets everything; this injects the
// durable state (progress ledger + git status) so the loop continues where it left off.
// When the loop is ARMED it also auto-submits the kickoff via initialUserMessage, so a
// relaunched session starts working even if the supervisor's send-keys never lands.
import { readFileSafe, sh, isActive, LOOP_DIR } from "./lib";

await Bun.stdin.text(); // drain payload

const progress = readFileSafe(`${LOOP_DIR}/progress.md`);
const status = sh("git status --porcelain").trim() || "(clean)";
const log = sh("git log --oneline -5").trim() || "(no commits yet)";

const out: Record<string, string> = {
  hookEventName: "SessionStart",
  additionalContext:
    `# NIGHT LOOP resume context\n\n` +
    `## ${LOOP_DIR}/progress.md\n${progress}\n\n` +
    `## git status\n${status}\n\n` +
    `## recent commits\n${log}\n\n` +
    `Continue from here. Build the next unmet milestone in ${LOOP_DIR}/backlog.yaml, M0 first.`,
};

// Only when armed: a manual daytime `claude` session must never get auto-submitted work.
if (isActive()) {
  out.initialUserMessage =
    `Resume NIGHT LOOP from ${LOOP_DIR}/progress.md and git state. Continue the next unmet ` +
    `milestone; fix the ratchet first if it is red.`;
}

console.log(JSON.stringify({ hookSpecificOutput: out }));

#!/usr/bin/env bun
// SessionStart hook. Each fresh or resumed session forgets everything; this injects the
// durable state (progress ledger + git status) so the loop continues where it left off.
import { readFileSafe, sh } from "./lib";

await Bun.stdin.text(); // drain payload

const progress = readFileSafe(".apsolut/progress.md");
const status = sh("git status --porcelain").trim() || "(clean)";
const log = sh("git log --oneline -5").trim() || "(no commits yet)";

console.log(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext:
      `# NIGHT LOOP resume context\n\n` +
      `## .apsolut/progress.md\n${progress}\n\n` +
      `## git status\n${status}\n\n` +
      `## recent commits\n${log}\n\n` +
      `Continue from here. Build the next unmet milestone in .apsolut/backlog.yaml, M0 first.`
  }
}));

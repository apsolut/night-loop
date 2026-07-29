#!/usr/bin/env bun
// PreToolUse hook. NIGHT LOOP is meant to run while you sleep, so this does NOT halt the loop.
// It blocks only truly irreversible / escape actions (which are not part of build-and-test),
// and it ALLOWS security-surface code while flagging it for a morning review. Safety overnight
// comes from the jail + only-test-credentials, not from stopping the loop. Current CC schema.
import { appendMarker } from "./lib";

// Files that touch a security surface: built and tested overnight against TEST creds, then
// flagged for human review before any production cutover. Allowed, not blocked.
const SECURITY_PATHS = [/auth/i, /billing/i, /payment/i, /stripe/i, /migrat/i, /schema/i];

// Escape / irreversible commands: never part of building or testing. Denied; the loop continues.
const ESCAPE_CMDS = [
  /\brm\s+-rf\b/, /\bdrop\s+database\b/i, /git\s+push/, /npm\s+publish/,
  /\b(npm|bun|pnpm|yarn)\s+(add|install|i)\b/, /\b(curl|wget)\b/,
  /\b(vercel|netlify|fly|railway|heroku)\s+(deploy|up|release)\b/i,
];

const raw = await Bun.stdin.text();
let p: any = {};
try { p = JSON.parse(raw); }
catch { console.error("[gate] unparseable payload, allowing. Verify hook schema."); process.exit(0); }

const tool = p.tool_name ?? p.tool ?? "";
const ti = p.tool_input ?? p.input ?? {};

function emit(decision: "deny" | "allow", reason: string, context?: string): never {
  const out: any = { hookEventName: "PreToolUse", permissionDecision: decision };
  if (decision === "deny") out.permissionDecisionReason = reason;
  if (context) out.additionalContext = context;
  console.log(JSON.stringify({ hookSpecificOutput: out }));
  process.exit(0);
}

if (tool === "Bash") {
  const cmd = ti.command ?? "";
  if (ESCAPE_CMDS.some((re) => re.test(cmd))) {
    emit("deny", `Blocked command: ${cmd}. Safety tripwire (destructive / publish / push / deploy / install / ` +
                 `network). This is not part of building or testing; achieve the goal another way, do not retry.`);
  }
}

if (tool === "Edit" || tool === "Write" || tool === "MultiEdit") {
  const path = ti.file_path ?? ti.path ?? "";
  if (SECURITY_PATHS.some((re) => re.test(path))) {
    appendMarker("REVIEW", `security surface touched: ${path}`);
    emit("allow", "", `Security-surface file (${path}). Build and test it against TEST credentials and seeded ` +
                      `data only, never real systems. It is flagged for human review before production cutover.`);
  }
}

process.exit(0); // allow

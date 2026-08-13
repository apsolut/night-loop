#!/usr/bin/env bun
// PreToolUse hook. NIGHT LOOP is meant to run while you sleep, so this does NOT halt the loop.
// It blocks only truly irreversible / escape actions (which are not part of build-and-test),
// and it ALLOWS security-surface code while flagging it for a morning review. Safety overnight
// comes from the jail + only-test-credentials, not from stopping the loop. Current CC schema.
import { resolve } from "node:path";
import { appendEvent, appendMarker, markerPath, ROOT } from "./lib";
import { pathExists, readJsonFile, readLedger } from "../../src/core";

// Files that touch a security surface: built and tested overnight against TEST creds, then
// flagged for human review before any production cutover. Allowed, not blocked.
const SECURITY_PATHS = [/auth/i, /billing/i, /payment/i, /stripe/i, /migrat/i, /schema/i];

// Escape / irreversible commands: never part of building or testing. Denied; the loop continues.
// NOTE: dependency installs (bun add / npm install) are deliberately ALLOWED. Every fresh
// project must install its toolchain; the jail plus the decisions-file rule cover the risk.
const ESCAPE_CMDS = [
  /\brm\s+-[^\s]*r[^\s]*f\b/i,
  /\bRemove-Item\b[^\n]*(?:-Recurse[^\n]*-Force|-Force[^\n]*-Recurse)/i,
  /\b(?:rd|rmdir)\b[^\n]*\/s\b/i,
  /\bgit\s+(?:push|clean\s+-[^\s]*[xXfF])\b/i,
  /\bdrop\s+(?:database|schema|table)\b/i,
  /\b(?:npm|bun|pnpm|yarn)\s+publish\b/i,
  /\b(?:curl|wget|Invoke-WebRequest|Invoke-RestMethod)\b/i,
  /\b(vercel|netlify|fly|railway|heroku)\s+(deploy|up|release)\b/i,
  /\b(?:kubectl\s+apply|terraform\s+apply|docker\s+push|gh\s+release\s+create)\b/i,
  /\b(?:NODE_ENV|ENVIRONMENT|STAGE)\s*=\s*(?:production|prod)\b/i,
];

const CONTROL_PATHS = [
  ".night-loop/hooks/",
  ".night-loop/state/claude-settings.json",
  ".claude-plugin/",
  "hooks/hooks.json",
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
  const normalizedCommand = cmd.replaceAll("\\", "/");
  if (CONTROL_PATHS.some((control) => normalizedCommand.includes(control))) {
    appendEvent("policy.blocked", { tool, category: "control_plane_write", action: "shelve_and_continue" });
    emit("deny", "NIGHT LOOP control-plane files are immutable during a run.");
  }
  if (ESCAPE_CMDS.some((re) => re.test(cmd))) {
    appendEvent("policy.blocked", { tool, category: "external_or_irreversible_action", action: "shelve_and_continue" });
    emit("deny", "NIGHT LOOP blocked an external or irreversible action. Continue with a local, reversible build step.");
  }
}

if (tool === "Edit" || tool === "Write" || tool === "MultiEdit") {
  const path = ti.file_path ?? ti.path ?? "";
  const normalized = path.replaceAll("\\", "/");
  const absolute = resolve(ROOT, path);
  if (!absolute.startsWith(`${resolve(ROOT)}${process.platform === "win32" ? "\\" : "/"}`) ||
      CONTROL_PATHS.some((control) => normalized.includes(control))) {
    appendEvent("policy.blocked", { tool, category: "control_plane_write", action: "shelve_and_continue" });
    emit("deny", "NIGHT LOOP control-plane and out-of-workspace files are immutable during a run.");
  }
  if (SECURITY_PATHS.some((re) => re.test(path))) {
    appendMarker("REVIEW", `security surface touched: ${path}`);
    emit("allow", "", `Security-surface file (${path}). Build and test it against TEST credentials and seeded ` +
                      `data only, never real systems. It is flagged for human review before production cutover.`);
  }
}

if (tool === "Agent" || tool === "Workflow") {
  const contract = markerPath("contract.json");
  const workers = pathExists(contract) ? readJsonFile<any>(contract).limits?.workers ?? 1 : 1;
  const cap = workers === "auto" ? 4 : Number(workers);
  const events = readLedger(markerPath("events.jsonl"));
  const starts = events.filter((event) => event.type === "claude.subagentstart").length;
  const stops = events.filter((event) => event.type === "claude.subagentstop").length;
  if (cap <= 1 || starts - stops >= cap) {
    appendEvent("policy.blocked", { tool, category: "worker_cap", cap, action: "continue_primary" });
    emit("deny", `NIGHT LOOP worker cap is ${cap}. Continue in the primary session.`);
  }
}

process.exit(0); // allow

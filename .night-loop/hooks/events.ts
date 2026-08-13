#!/usr/bin/env bun
import { appendEvent } from "./lib";
import { isInteractionRequest } from "../../src/core";

interface HookPayload {
  hook_event_name?: string;
  hookEventName?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  notification_type?: string;
  message?: string;
  prompt?: string;
  agent_id?: string;
  agent_type?: string;
  task_id?: string;
  [key: string]: unknown;
}

const BLOCKED_COMMANDS = [
  /\bgit\s+push\b/i,
  /\b(?:npm|bun|pnpm|yarn)\s+publish\b/i,
  /\b(?:curl|wget|Invoke-WebRequest|Invoke-RestMethod)\b/i,
  /\b(?:vercel|netlify|fly|railway|heroku)\s+(?:deploy|up|release)\b/i,
  /\b(?:kubectl\s+apply|terraform\s+apply|docker\s+push)\b/i,
  /\brm\s+-[^\s]*r[^\s]*f\b/i,
  /\bRemove-Item\b[^\n]*(?:-Recurse[^\n]*-Force|-Force[^\n]*-Recurse)/i,
  /\bdrop\s+(?:database|schema|table)\b/i,
];

function eventName(payload: HookPayload): string {
  return payload.hook_event_name ?? payload.hookEventName ?? "Unknown";
}

function safeEvidence(payload: HookPayload): Record<string, unknown> {
  const name = eventName(payload);
  const message = typeof payload.message === "string" ? payload.message : "";
  const prompt = typeof payload.prompt === "string" ? payload.prompt : "";
  return {
    event: name,
    tool: payload.tool_name ?? null,
    notificationType: payload.notification_type ?? null,
    agentId: payload.agent_id ?? null,
    agentType: payload.agent_type ?? null,
    taskId: payload.task_id ?? null,
    interactionRequired: isInteractionRequest(`${message}\n${prompt}`),
  };
}

function permissionDecision(behavior: "allow" | "deny", message?: string): never {
  const decision: Record<string, unknown> = { behavior };
  if (message) {
    decision.message = message;
    decision.interrupt = false;
  }
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision,
    },
  }));
  process.exit(0);
}

const raw = await Bun.stdin.text();
let payload: HookPayload;
try {
  payload = JSON.parse(raw) as HookPayload;
} catch {
  appendEvent("hook.invalid_payload", { handler: "events" });
  process.exit(0);
}

const name = eventName(payload);
const normalizedName = name.toLowerCase();
const evidence = safeEvidence(payload);
appendEvent(`claude.${normalizedName}`, evidence);

if (evidence.interactionRequired) {
  appendEvent("interaction_required", { source: name, notificationType: payload.notification_type ?? null });
}

if (name === "PermissionRequest") {
  const command = payload.tool_name === "Bash" && typeof payload.tool_input?.command === "string"
    ? payload.tool_input.command
    : "";
  if (BLOCKED_COMMANDS.some((pattern) => pattern.test(command))) {
    appendEvent("policy.denied", { source: name, category: "external_or_irreversible_action", action: "shelve_and_continue" });
    permissionDecision("deny", "NIGHT LOOP denied an external or irreversible action. Continue locally without asking the owner.");
  }
  appendEvent("permission.auto_allowed", { tool: payload.tool_name ?? null });
  permissionDecision("allow");
}

if (name === "Elicitation") {
  appendEvent("blocked.missing_authority", {
    server: payload.mcp_server_name ?? null,
    action: "shelve_and_continue",
  });
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "Elicitation",
      action: "cancel",
    },
  }));
  process.exit(0);
}

if (name === "UserPromptSubmit") {
  const prompt = typeof payload.prompt === "string" ? payload.prompt : "";
  if (/^\s*\/(?:batch|autofix-pr)\b/i.test(prompt)) {
    appendEvent("policy.denied", { source: name, category: "external_workflow" });
    console.log(JSON.stringify({
      decision: "block",
      reason: "NIGHT LOOP disables workflows that can push or open pull requests during unattended runs.",
    }));
  }
}

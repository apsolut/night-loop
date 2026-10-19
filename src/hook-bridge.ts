#!/usr/bin/env bun
// Provider hook bridge (decision 011). Codex and Grok deliver hook payloads with their own
// tool names; this process rewrites them to the Claude shape, then delegates to the
// UNCHANGED control-plane hook under .night-loop/hooks/. It translates; it never decides.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PLUGIN_ROOT } from "./providers";

type Payload = Record<string, unknown>;

const HOOKS = new Set(["gate", "loop", "resume", "events"]);
const TOOL_ALIASES: Record<string, string> = {
  run_terminal_command: "Bash",
  search_replace: "Write",
  write_file: "Write",
  create_file: "Write",
  edit_file: "Edit",
  read_file: "Read",
  spawn_agent: "Agent",
  spawn_subagent: "Agent",
  Task: "Agent",
};
const CAMEL_EVENTS: Record<string, string> = {
  pre_tool_use: "PreToolUse",
  post_tool_use: "PostToolUse",
  session_start: "SessionStart",
  session_end: "SessionEnd",
  stop: "Stop",
  stop_failure: "StopFailure",
  notification: "Notification",
  user_prompt_submit: "UserPromptSubmit",
  subagent_start: "SubagentStart",
  subagent_stop: "SubagentStop",
};

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function emitDeny(reason: string): never {
  console.log(JSON.stringify({
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason },
  }));
  process.exit(0);
}

const args = Bun.argv.slice(2);
const hook = args[0] ?? "";
const provider = option(args, "--provider") ?? "codex";
if (!HOOKS.has(hook)) {
  console.error("night-loop hook-bridge: usage <gate|loop|resume|events> --provider <codex|grok>");
  process.exit(2);
}

const raw = await Bun.stdin.text();
let payload: Payload = {};
try {
  payload = raw.trim() ? (JSON.parse(raw) as Payload) : {};
} catch {
  if (hook === "gate") emitDeny("NIGHT LOOP could not parse the provider hook payload.");
  process.exit(0);
}

const repo = resolve(
  process.env.CLAUDE_PROJECT_DIR
    || String(payload.cwd ?? payload.workspaceRoot ?? process.cwd()),
);

// Grok also fires Stop at session teardown. There is no turn left to continue, so the
// verifier must not run (and must not count a step) for that fire.
if (hook === "loop" && provider === "grok" && payload.reason !== undefined && payload.reason !== "end_turn") {
  process.exit(0);
}

// The armed run's limit wins over a later attended setup: run.json carries what was armed,
// contract.json may already describe the next night (resume never upgrades limits).
function maxSteps(): string | undefined {
  if (process.env.NIGHT_LOOP_MAX_STEPS) return process.env.NIGHT_LOOP_MAX_STEPS;
  for (const name of ["run.json", "contract.json"]) {
    const path = join(repo, ".night-loop", "state", name);
    if (!existsSync(path)) continue;
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as { limits?: { maxSteps?: number } };
      if (parsed.limits?.maxSteps !== undefined) return String(parsed.limits.maxSteps);
    } catch {
      continue;
    }
  }
  return undefined;
}

export function patchPaths(patch: string): string[] {
  const paths: string[] = [];
  for (const line of patch.split(/\r?\n/)) {
    const match = line.match(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/) ?? line.match(/^\*\*\* Move to: (.+)$/);
    if (match?.[1]) paths.push(match[1].trim());
  }
  return paths;
}

export function normalize(input: Payload, providerId: string): Payload[] {
  const camel = typeof input.hookEventName === "string" ? input.hookEventName : "";
  const base: Payload = {
    ...input,
    hook_event_name: input.hook_event_name ?? CAMEL_EVENTS[camel] ?? camel,
  };
  const name = String(input.tool_name ?? input.toolName ?? "");
  const toolInput = (input.tool_input ?? input.toolInput ?? {}) as Payload;
  if (!name) return [base];
  if (providerId === "codex" && name === "apply_patch") {
    const paths = patchPaths(String(toolInput.command ?? toolInput.patch ?? toolInput.input ?? ""));
    if (paths.length === 0) return [{ ...base, tool_name: name, tool_input: toolInput }];
    return paths.map((file_path) => ({ ...base, tool_name: "Write", tool_input: { file_path } }));
  }
  return [{ ...base, tool_name: TOOL_ALIASES[name] ?? name, tool_input: toolInput }];
}

async function runHook(body: Payload): Promise<string> {
  const env: Record<string, string | undefined> = { ...process.env, CLAUDE_PROJECT_DIR: repo };
  const steps = maxSteps();
  if (steps) env.NIGHT_LOOP_MAX_STEPS = steps;
  const child = Bun.spawn([process.execPath, join(PLUGIN_ROOT, ".night-loop", "hooks", `${hook}.ts`)], {
    cwd: repo,
    env,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
  });
  child.stdin.write(JSON.stringify(body));
  child.stdin.end();
  const [stdout] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  return stdout;
}

if (import.meta.main) {
  const bodies = normalize(payload, provider);
  if (hook !== "gate") {
    process.stdout.write(await runHook(bodies[0] ?? payload));
    process.exit(0);
  }
  const contexts: string[] = [];
  for (const body of bodies) {
    const out = await runHook(body);
    if (!out.trim()) continue;
    let parsed: { hookSpecificOutput?: { permissionDecision?: string; additionalContext?: string } } = {};
    try { parsed = JSON.parse(out) as typeof parsed; } catch { continue; }
    if (parsed.hookSpecificOutput?.permissionDecision === "deny") {
      process.stdout.write(out);
      process.exit(0);
    }
    if (parsed.hookSpecificOutput?.additionalContext) contexts.push(parsed.hookSpecificOutput.additionalContext);
  }
  if (contexts.length > 0) {
    console.log(JSON.stringify({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", additionalContext: contexts.join("\n") },
    }));
  }
  process.exit(0);
}

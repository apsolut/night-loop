// Provider surfaces for the three subscription CLIs (decision 009). Everything here is
// argument arrays and output parsing; no provider process is started in this module.
// Ground truth for every flag lives in .night-loop/research/2026-10-19-provider-surfaces.md.
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type ProviderId = "claude" | "codex" | "grok";
export type ProviderMode = "background" | "turn";
export type PermissionProfile = "workspace" | "full";
export type WorkerLimit = number | "auto";

export const PROVIDER_IDS = ["claude", "codex", "grok"] as const;
export const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Metered credentials are scrubbed for every provider, not only the selected one, so a
// stray key from another vendor can never turn a flat-rate night into a metered one.
export const SECRET_ENV: Record<ProviderId, readonly string[]> = {
  claude: ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BEDROCK_BASE_URL", "ANTHROPIC_VERTEX_PROJECT_ID"],
  codex: ["OPENAI_API_KEY", "CODEX_API_KEY"],
  grok: ["XAI_API_KEY", "GROK_API_KEY"],
};
export const ALL_SECRET_ENV: readonly string[] = Object.values(SECRET_ENV).flat();

export const ALLOWED_TOOLS = ["Read", "Glob", "Grep", "Edit", "Write", "MultiEdit", "Bash"] as const;
// Deny rules the provider enforces natively, in addition to the PreToolUse gate.
export const DENY_RULES = ["Bash(git push *)", "Bash(npm publish *)", "Bash(bun publish *)", "Bash(rm -rf *)"] as const;
// Grok headless turns are capped per process; the supervisor resumes the session afterwards.
export const GROK_MAX_TURNS = 100;
export const VERSION_FLOOR: Record<ProviderId, readonly number[]> = {
  claude: [2, 1, 300],
  codex: [0, 160, 0],
  grok: [1, 0, 46],
};

export interface ProviderContract {
  provider?: ProviderId;
  permissions: PermissionProfile;
  model?: string;
  effort?: string;
  limits: { workers: WorkerLimit; maxSteps: number };
}

export function parseProvider(value: string | undefined): ProviderId {
  if (value === undefined) return "claude";
  if ((PROVIDER_IDS as readonly string[]).includes(value)) return value as ProviderId;
  throw new Error("--provider must be claude, codex, or grok");
}

export function providerMode(provider: ProviderId): ProviderMode {
  return provider === "claude" ? "background" : "turn";
}

export function providerBin(provider: ProviderId): string {
  return process.env[`NIGHT_LOOP_${provider.toUpperCase()}_BIN`] ?? provider;
}

export function providerShim(provider: ProviderId): string | undefined {
  return process.env[`NIGHT_LOOP_${provider.toUpperCase()}_SHIM`];
}

function posixPath(value: string): string {
  return value.replaceAll("\\", "/");
}

// TOML basic strings accept the same escapes JSON emits for the characters that matter
// (quote, backslash, control characters), so JSON.stringify yields a valid TOML string.
function toml(value: string): string {
  return JSON.stringify(value);
}

export type BridgeHook = "gate" | "loop" | "resume" | "events";

// The bridge runs under the same Bun that generated the command, by absolute path, so the
// provider's hook shell never has to resolve bun on its own PATH (decision 007 for Claude).
// Probed 2026-10-20: Codex runs hook commands where a quoted path is a call; Grok on Windows
// runs them through PowerShell, where a quoted path is a string unless `&` precedes it.
export function bridgeCommand(hook: BridgeHook, provider: ProviderId, platform: string = process.platform): string {
  const bridge = join(PLUGIN_ROOT, "src", "hook-bridge.ts");
  const call = provider === "grok" && platform === "win32" ? "& " : "";
  return `${call}"${posixPath(process.execPath)}" "${posixPath(bridge)}" ${hook} --provider ${provider}`;
}

interface HookBinding {
  event: string;
  hook: BridgeHook;
  matcher?: string;
  timeout: number;
}

export const GATE_MATCHER = [
  "Bash", "apply_patch", "Edit", "Write", "MultiEdit", "Agent", "Workflow",
  "run_terminal_command", "search_replace", "write_file", "create_file", "edit_file",
  "spawn_agent", "spawn_subagent", "Task",
].join("|");

const SHARED_BINDINGS: HookBinding[] = [
  { event: "PreToolUse", hook: "gate", matcher: GATE_MATCHER, timeout: 60 },
  { event: "Stop", hook: "loop", timeout: 1800 },
  { event: "SessionStart", hook: "resume", timeout: 60 },
  { event: "UserPromptSubmit", hook: "events", timeout: 30 },
  { event: "SubagentStart", hook: "events", timeout: 30 },
  { event: "SubagentStop", hook: "events", timeout: 30 },
];

export const HOOK_BINDINGS: Record<Exclude<ProviderId, "claude">, HookBinding[]> = {
  codex: [...SHARED_BINDINGS, { event: "PermissionRequest", hook: "events", timeout: 30 }],
  grok: [
    ...SHARED_BINDINGS,
    { event: "Notification", hook: "events", timeout: 30 },
    { event: "StopFailure", hook: "events", timeout: 30 },
  ],
};

// Codex loads hooks from config overrides, so no file is written into the host repository.
export function codexHookOverrides(): string[] {
  return HOOK_BINDINGS.codex.flatMap((binding) => {
    const matcher = binding.matcher ? `matcher=${toml(binding.matcher)},` : "";
    const handler = `{type="command",command=${toml(bridgeCommand(binding.hook, "codex"))},timeout=${binding.timeout}}`;
    return ["-c", `hooks.${binding.event}=[{${matcher}hooks=[${handler}]}]`];
  });
}

// Grok loads project hooks from .grok/hooks/*.json once the folder is trusted (--trust).
export function grokHookFile(): { hooks: Record<string, unknown[]> } {
  const hooks: Record<string, unknown[]> = {};
  for (const binding of HOOK_BINDINGS.grok) {
    hooks[binding.event] = [{
      ...(binding.matcher ? { matcher: binding.matcher } : {}),
      hooks: [{ type: "command", command: bridgeCommand(binding.hook, "grok"), timeout: binding.timeout }],
    }];
  }
  return { hooks };
}

export function grokHookFilePath(repo: string): string {
  return join(repo, ".grok", "hooks", "night-loop.json");
}

export function codexSandbox(permissions: PermissionProfile): "workspace-write" | "danger-full-access" {
  return permissions === "full" ? "danger-full-access" : "workspace-write";
}

export function codexTurnArgs(
  repo: string,
  contract: ProviderContract,
  prompt: string,
  sessionId?: string,
): [string, ...string[]] {
  const args: [string, ...string[]] = [
    "exec",
    "--json",
    "-C",
    repo,
    "--sandbox",
    codexSandbox(contract.permissions),
    "-c",
    'approval_policy="never"',
    "-c",
    "sandbox_workspace_write.network_access=true",
    "--dangerously-bypass-hook-trust",
    "--skip-git-repo-check",
    "--output-last-message",
    join(repo, ".night-loop", "state", "last-message.txt"),
    ...codexHookOverrides(),
  ];
  // The worker cap is enforced natively from the armed contract, so a later attended setup
  // cannot loosen it through the gate's contract.json read (M8 finding, 2026-10-20).
  if (contract.limits.workers === 1) args.push("-c", "features.multi_agent=false");
  else args.push("-c", `agents.max_concurrent_threads_per_session=${contract.limits.workers === "auto" ? 4 : contract.limits.workers}`);
  if (contract.model) args.push("--model", contract.model);
  if (contract.effort) args.push("-c", `model_reasoning_effort=${toml(contract.effort)}`);
  if (sessionId) args.push("resume", sessionId, prompt);
  else args.push(prompt);
  return args;
}

export function grokPermissionMode(permissions: PermissionProfile): "dontAsk" | "bypassPermissions" {
  return permissions === "full" ? "bypassPermissions" : "dontAsk";
}

export function grokTurnArgs(
  repo: string,
  contract: ProviderContract,
  prompt: string,
  session: { resume?: string; create?: string },
): [string, ...string[]] {
  const args: [string, ...string[]] = [
    "-p",
    prompt,
    "--output-format",
    "json",
    "--cwd",
    repo,
    "--trust",
    "--permission-mode",
    grokPermissionMode(contract.permissions),
    "--no-plan",
    "--disable-web-search",
    "--max-turns",
    String(GROK_MAX_TURNS),
  ];
  if (contract.limits.workers === 1) args.push("--no-subagents");
  if (contract.permissions === "workspace") {
    for (const tool of ALLOWED_TOOLS) args.push("--allow", tool);
  }
  for (const rule of DENY_RULES) args.push("--deny", rule);
  if (contract.model) args.push("--model", contract.model);
  if (contract.effort) args.push("--reasoning-effort", contract.effort);
  if (session.resume) args.push("--resume", session.resume);
  else if (session.create) args.push("--session-id", session.create);
  return args;
}

export function parseCodexSessionId(stdout: string): string | undefined {
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.includes("thread.started")) continue;
    try {
      const event = JSON.parse(line) as { type?: string; thread_id?: string };
      if (event.type === "thread.started" && event.thread_id) return event.thread_id;
    } catch {
      continue;
    }
  }
  return undefined;
}

export function parseCodexLastMessage(stdout: string): string {
  let last = "";
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.includes("agent_message")) continue;
    try {
      const event = JSON.parse(line) as { type?: string; item?: { type?: string; text?: string } };
      if (event.type === "item.completed" && event.item?.type === "agent_message") last = event.item.text ?? last;
    } catch {
      continue;
    }
  }
  return last;
}

export function parseGrokResult(stdout: string): { sessionId?: string; text: string } {
  const start = stdout.indexOf("{");
  if (start >= 0) {
    try {
      const parsed = JSON.parse(stdout.slice(start)) as { sessionId?: string; text?: string };
      return { sessionId: parsed.sessionId, text: parsed.text ?? "" };
    } catch {
      // fall through to the tolerant scan below
    }
  }
  return {
    sessionId: stdout.match(/"sessionId"\s*:\s*"([^"]+)"/)?.[1],
    text: stdout.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1] ?? "",
  };
}

export interface TurnOutput {
  sessionId?: string;
  lastMessage: string;
}

export function turnOutput(provider: ProviderId, stdout: string): TurnOutput {
  if (provider === "codex") return { sessionId: parseCodexSessionId(stdout), lastMessage: parseCodexLastMessage(stdout) };
  const grok = parseGrokResult(stdout);
  return { sessionId: grok.sessionId, lastMessage: grok.text };
}

export interface TurnLaunch {
  command: [string, ...string[]];
  env: Record<string, string>;
}

export function turnLaunch(
  provider: Exclude<ProviderId, "claude">,
  repo: string,
  contract: ProviderContract,
  prompt: string,
  session: { resume?: string; create?: string },
): TurnLaunch {
  const args = provider === "codex"
    ? codexTurnArgs(repo, contract, prompt, session.resume)
    : grokTurnArgs(repo, contract, prompt, session);
  const shim = providerShim(provider);
  const command: [string, ...string[]] = shim
    ? [providerBin(provider), shim, ...args]
    : [providerBin(provider), ...args];
  const env: Record<string, string> = provider === "grok" ? { GROK_DISABLE_AUTOUPDATER: "1" } : {};
  return { command, env };
}

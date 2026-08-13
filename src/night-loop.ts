import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  appendLedgerEvent,
  atomicWriteFile,
  atomicWriteJson,
  isInteractionRequest,
  pathExists,
  readJsonFile,
  readLedger,
  runCommand,
  verifyLedger,
} from "./core";

export type PermissionProfile = "workspace" | "full";
export type WorkerLimit = number | "auto";

export interface NightContract {
  schemaVersion: 1;
  goal: string;
  permissions: PermissionProfile;
  limits: {
    maxSteps: number;
    maxRelaunches: number;
    workers: WorkerLimit;
  };
  createdAt: string;
}

export interface RunState {
  schemaVersion: 1;
  runId: string;
  sessionName: string;
  nativeSessionId?: string;
  status: "starting" | "running" | "stopped" | "done" | "blocked" | "budget" | "interaction_required" | "provider_error";
  permissions: PermissionProfile;
  limits: NightContract["limits"];
  startedAt: string;
  updatedAt: string;
}

export interface CommandContext {
  repo: string;
  claudeBin?: string;
  now?: string;
}

interface SupervisorState {
  relaunches: number;
  lastStep: number;
  stalledTicks: number;
}

const SECRET_ENV = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BEDROCK_BASE_URL",
  "ANTHROPIC_VERTEX_PROJECT_ID",
] as const;
const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loopPath(repo: string, ...parts: string[]): string {
  return join(repo, ".night-loop", ...parts);
}

function timestamp(context: CommandContext): string {
  return context.now ?? process.env.NIGHT_LOOP_NOW ?? new Date().toISOString();
}

function claudeBin(context: CommandContext): string {
  return context.claudeBin ?? process.env.NIGHT_LOOP_CLAUDE_BIN ?? "claude";
}

export function permissionMode(profile: PermissionProfile): "dontAsk" | "bypassPermissions" {
  return profile === "full" ? "bypassPermissions" : "dontAsk";
}

export function normalizeCommand(command: string | undefined, args: string[]): { command: string; args: string[] } {
  if (command !== "full") return { command: command ?? "help", args };
  return { command: "start", args: ["--permissions", "full", ...args] };
}

export function parseWorkers(value: string | undefined): WorkerLimit {
  if (value === undefined) return 1;
  if (value === "auto") return value;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 16) {
    throw new Error("workers must be 1, auto, or an integer from 1 to 16");
  }
  return parsed;
}

export function contractPath(repo: string): string {
  return loopPath(repo, "state", "contract.json");
}

export function runStatePath(repo: string): string {
  return loopPath(repo, "state", "run.json");
}

export function eventPath(repo: string): string {
  return loopPath(repo, "state", "events.jsonl");
}

export function readContract(repo: string): NightContract {
  const path = contractPath(repo);
  if (!pathExists(path)) throw new Error("Run night-loop setup before start");
  return readJsonFile<NightContract>(path);
}

export function writeContract(
  context: CommandContext,
  input: { goal: string; permissions?: PermissionProfile; maxSteps?: number; maxRelaunches?: number; workers?: WorkerLimit },
): NightContract {
  const goal = input.goal.trim();
  if (!goal) throw new Error("setup requires a non-empty goal");
  if (/(?:sk-ant-|api[_ -]?key\s*[:=]|auth[_ -]?token\s*[:=]|password\s*[:=]|-----BEGIN [A-Z ]+PRIVATE KEY-----)/i.test(goal)) {
    throw new Error("The goal appears to contain a credential. Store only test credential references, never values");
  }
  const contract: NightContract = {
    schemaVersion: 1,
    goal,
    permissions: input.permissions ?? "workspace",
    limits: {
      maxSteps: input.maxSteps ?? 2000,
      maxRelaunches: input.maxRelaunches ?? 20,
      workers: input.workers ?? 1,
    },
    createdAt: timestamp(context),
  };
  atomicWriteJson(contractPath(context.repo), contract);
  appendLedgerEvent(eventPath(context.repo), "contract.approved", {
    permissions: contract.permissions,
    limits: contract.limits,
    goalHash: Bun.hash(goal).toString(16),
  }, contract.createdAt);
  return contract;
}

export function compileGoal(contract: NightContract): string {
  const workers = contract.limits.workers;
  const workerPolicy = workers === 1
    ? "Do not spawn subagents or workflows."
    : `Native Claude subagents or workflows are optional accelerators. Never exceed ${workers === "auto" ? 4 : workers} active workers.`;
  return [
    `/goal ${contract.goal}`,
    "Begin immediately. Follow CLAUDE.md, .night-loop/backlog.yaml, and .night-loop/constraints.md.",
    "Do not ask the owner questions, request approval, or wait for input after this prompt.",
    "Use deterministic reversible defaults. Record missing authority as blocked and continue with buildable work.",
    workerPolicy,
    "The independent NIGHT LOOP harness, not your own completion claim, decides when the run is done.",
  ].join("\n\n");
}

export function generatedSettings(contract: NightContract): Record<string, unknown> {
  const deny = ["Skill(batch)", "Skill(autofix-pr)"];
  if (contract.limits.workers === 1) deny.push("Agent");
  return {
    permissions: {
      defaultMode: permissionMode(contract.permissions),
      allow: ["Read", "Glob", "Grep", "Edit", "Write", "MultiEdit", "Bash"],
      deny,
    },
    env: {
      NIGHT_LOOP_MAX_STEPS: String(contract.limits.maxSteps),
      NIGHT_LOOP_WORKERS: String(contract.limits.workers),
    },
  };
}

export function parseBackgroundSessionId(output: string): string | undefined {
  const uuid = output.match(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/i)?.[0];
  if (uuid) return uuid;
  return output.match(/(?:session|agent|id)\s*[:#]?\s*([a-z0-9][a-z0-9_-]{5,})/i)?.[1];
}

function runId(now: string): string {
  return now.replace(/[^0-9A-Za-z]+/g, "-").replace(/^-|-$/g, "");
}

function activeMarker(repo: string): string {
  return loopPath(repo, "state", "ACTIVE");
}

function writeRun(repo: string, state: RunState): void {
  atomicWriteJson(runStatePath(repo), state);
}

function supervisorStatePath(repo: string): string {
  return loopPath(repo, "state", "supervisor.json");
}

function readStep(repo: string): number {
  try { return Number(readFileSync(loopPath(repo, "state", "STEP"), "utf8").trim()) || 0; } catch { return 0; }
}

function readRun(repo: string): RunState | undefined {
  return pathExists(runStatePath(repo)) ? readJsonFile<RunState>(runStatePath(repo)) : undefined;
}

function claudeArgs(repo: string, contract: NightContract, prompt: string): [string, ...string[]] {
  const settingsPath = loopPath(repo, "state", "claude-settings.json");
  atomicWriteJson(settingsPath, generatedSettings(contract));
  return [
    "--bg",
    "--name",
    "night-loop",
    "--permission-mode",
    permissionMode(contract.permissions),
    "--settings",
    settingsPath,
    "--plugin-dir",
    PLUGIN_ROOT,
    prompt,
  ];
}

function resumeClaudeArgs(repo: string, contract: NightContract, sessionId: string): [string, ...string[]] {
  const settingsPath = loopPath(repo, "state", "claude-settings.json");
  atomicWriteJson(settingsPath, generatedSettings(contract));
  return [
    "--resume",
    sessionId,
    "--bg",
    "--name",
    "night-loop",
    "--permission-mode",
    permissionMode(contract.permissions),
    "--settings",
    settingsPath,
    "--plugin-dir",
    PLUGIN_ROOT,
    "Resume NIGHT LOOP from durable repository state.",
  ];
}

async function runClaude(context: CommandContext, args: [string, ...string[]]) {
  const shim = process.env.NIGHT_LOOP_CLAUDE_SHIM;
  const command: [string, ...string[]] = shim
    ? [claudeBin(context), shim, ...args]
    : [claudeBin(context), ...args];
  return runCommand(command, { cwd: context.repo, unsetEnv: SECRET_ENV });
}

export async function startNightLoop(
  context: CommandContext,
  permissionOverride?: PermissionProfile,
): Promise<RunState> {
  const previous = readRun(context.repo);
  if (existsSync(activeMarker(context.repo)) && previous?.status === "running") {
    throw new Error("A NIGHT LOOP session is already active");
  }
  const saved = readContract(context.repo);
  const contract = permissionOverride ? { ...saved, permissions: permissionOverride } : saved;
  const now = timestamp(context);
  const state: RunState = {
    schemaVersion: 1,
    runId: runId(now),
    sessionName: "night-loop",
    status: "starting",
    permissions: contract.permissions,
    limits: contract.limits,
    startedAt: now,
    updatedAt: now,
  };
  mkdirSync(loopPath(context.repo, "runs"), { recursive: true });
  atomicWriteFile(loopPath(context.repo, "state", "STEP"), "0\n");
  for (const marker of ["HALTED", "CLAIM_DONE", "ALL_BLOCKED", "REVIEW"]) {
    rmSync(loopPath(context.repo, "state", marker), { force: true });
  }
  atomicWriteFile(activeMarker(context.repo), `${state.runId}\n`);
  writeRun(context.repo, state);
  appendLedgerEvent(eventPath(context.repo), "run.starting", {
    runId: state.runId,
    permissions: state.permissions,
    permissionMode: permissionMode(state.permissions),
    limits: state.limits,
  }, now);

  const result = await runClaude(context, claudeArgs(context.repo, contract, compileGoal(contract)));
  if (isInteractionRequest(`${result.stdout}\n${result.stderr}`)) {
    state.status = "interaction_required";
    state.updatedAt = timestamp(context);
    rmSync(activeMarker(context.repo), { force: true });
    writeRun(context.repo, state);
    appendLedgerEvent(eventPath(context.repo), "interaction_required", {
      source: "launch_output",
      action: "terminate_without_waiting",
    }, state.updatedAt);
    return state;
  }
  if (result.exitCode !== 0) {
    state.status = "provider_error";
    state.updatedAt = timestamp(context);
    rmSync(activeMarker(context.repo), { force: true });
    writeRun(context.repo, state);
    appendLedgerEvent(eventPath(context.repo), "run.launch_failed", {
      exitCode: result.exitCode,
      stderr: result.stderr.slice(0, 500),
    }, state.updatedAt);
    return state;
  }
  state.nativeSessionId = parseBackgroundSessionId(`${result.stdout}\n${result.stderr}`);
  state.status = "running";
  state.updatedAt = timestamp(context);
  writeRun(context.repo, state);
  appendLedgerEvent(eventPath(context.repo), "run.started", {
    nativeSessionId: state.nativeSessionId ?? null,
    sessionName: state.sessionName,
  }, state.updatedAt);
  if (process.env.NIGHT_LOOP_DISABLE_WATCH !== "1") {
    const env = { ...process.env };
    for (const name of SECRET_ENV) delete env[name];
    const supervisor = Bun.spawn([
      process.execPath,
      Bun.main,
      "_supervise",
      "--repo",
      context.repo,
    ], {
      cwd: context.repo,
      env,
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
      detached: true,
    });
    supervisor.unref();
    appendLedgerEvent(eventPath(context.repo), "supervisor.started", { pid: supervisor.pid }, state.updatedAt);
  }
  return state;
}

interface ClaudeAgentRecord {
  id?: string;
  sessionId?: string;
  name?: string;
  status?: string;
  cwd?: string;
  [key: string]: unknown;
}

export async function statusNightLoop(context: CommandContext): Promise<Record<string, unknown>> {
  const local = readRun(context.repo);
  const result = await runClaude(context, ["agents", "--json", "--all", "--cwd", context.repo]);
  let agents: ClaudeAgentRecord[] = [];
  if (result.exitCode === 0) {
    try { agents = JSON.parse(result.stdout) as ClaudeAgentRecord[]; } catch { agents = []; }
  }
  const native = agents.find((agent) => {
    const id = agent.id ?? agent.sessionId;
    return (local?.nativeSessionId && id === local.nativeSessionId) || agent.name === local?.sessionName;
  });
  return {
    status: native?.status ?? local?.status ?? "not_configured",
    run: local ?? null,
    native: native ?? null,
    active: existsSync(activeMarker(context.repo)),
  };
}

export async function stopNightLoop(context: CommandContext): Promise<RunState> {
  const state = readRun(context.repo);
  if (!state) throw new Error("No NIGHT LOOP run state exists");
  let sessionId = state.nativeSessionId;
  if (!sessionId) {
    const status = await statusNightLoop(context);
    const native = status.native as ClaudeAgentRecord | null;
    sessionId = native?.id ?? native?.sessionId;
  }
  const result = sessionId ? await runClaude(context, ["stop", sessionId]) : undefined;
  if (result && result.exitCode !== 0) throw new Error(`Claude stop failed with exit code ${result.exitCode}`);
  rmSync(activeMarker(context.repo), { force: true });
  state.status = "stopped";
  state.updatedAt = timestamp(context);
  writeRun(context.repo, state);
  appendLedgerEvent(eventPath(context.repo), "run.stopped", { nativeSessionId: sessionId ?? null }, state.updatedAt);
  return state;
}

export async function resumeNightLoop(context: CommandContext): Promise<RunState> {
  const state = readRun(context.repo);
  if (!state?.nativeSessionId) throw new Error("No resumable Claude session id exists");
  const contract = readContract(context.repo);
  const preserved: NightContract = { ...contract, permissions: state.permissions, limits: state.limits };
  const result = await runClaude(context, resumeClaudeArgs(context.repo, preserved, state.nativeSessionId));
  state.updatedAt = timestamp(context);
  if (isInteractionRequest(`${result.stdout}\n${result.stderr}`)) {
    state.status = "interaction_required";
    rmSync(activeMarker(context.repo), { force: true });
    writeRun(context.repo, state);
    appendLedgerEvent(eventPath(context.repo), "interaction_required", {
      source: "resume_output",
      action: "terminate_without_waiting",
    }, state.updatedAt);
    return state;
  }
  if (result.exitCode !== 0) {
    state.status = "provider_error";
    writeRun(context.repo, state);
    appendLedgerEvent(eventPath(context.repo), "run.resume_failed", { exitCode: result.exitCode }, state.updatedAt);
    return state;
  }
  state.nativeSessionId = parseBackgroundSessionId(`${result.stdout}\n${result.stderr}`) ?? state.nativeSessionId;
  state.status = "running";
  atomicWriteFile(activeMarker(context.repo), `${state.runId}\n`);
  writeRun(context.repo, state);
  appendLedgerEvent(eventPath(context.repo), "run.resumed", {
    nativeSessionId: state.nativeSessionId,
    permissions: state.permissions,
    limits: state.limits,
  }, state.updatedAt);
  return state;
}

export async function superviseNightLoop(
  context: CommandContext,
  options: { once?: boolean; delay?: (milliseconds: number) => Promise<void> } = {},
): Promise<void> {
  const delay = options.delay ?? ((milliseconds: number) => Bun.sleep(milliseconds));
  const stallLimit = Number(process.env.NIGHT_LOOP_STALL_TICKS ?? 80);
  if (!options.once) await delay(Number(process.env.NIGHT_LOOP_POLL_MS ?? 15000));
  while (existsSync(activeMarker(context.repo))) {
    const state = readRun(context.repo);
    if (!state) return;
    const haltedPath = loopPath(context.repo, "state", "HALTED");
    if (pathExists(haltedPath)) {
      const reason = readFileSync(haltedPath, "utf8").trim();
      state.status = reason === "done" || reason === "blocked" || reason === "budget" ? reason : "stopped";
      state.updatedAt = timestamp(context);
      rmSync(activeMarker(context.repo), { force: true });
      writeRun(context.repo, state);
      return;
    }
    const saved: SupervisorState = pathExists(supervisorStatePath(context.repo))
      ? readJsonFile<SupervisorState>(supervisorStatePath(context.repo))
      : { relaunches: 0, lastStep: -1, stalledTicks: 0 };
    const step = readStep(context.repo);
    saved.stalledTicks = step === saved.lastStep ? saved.stalledTicks + 1 : 0;
    saved.lastStep = step;
    const native = await statusNightLoop(context);
    const live = native.native as ClaudeAgentRecord | null;
    const shouldRecover = !live || saved.stalledTicks >= stallLimit;
    if (shouldRecover) {
      if (saved.relaunches >= state.limits.maxRelaunches) {
        state.status = "budget";
        state.updatedAt = timestamp(context);
        atomicWriteFile(haltedPath, "budget\n");
        rmSync(activeMarker(context.repo), { force: true });
        writeRun(context.repo, state);
        appendLedgerEvent(eventPath(context.repo), "supervisor.exhausted", { relaunches: saved.relaunches }, state.updatedAt);
        return;
      }
      saved.relaunches += 1;
      saved.stalledTicks = 0;
      const backoffSeconds = Math.min(600, 10 * (2 ** Math.min(saved.relaunches, 6)));
      appendLedgerEvent(eventPath(context.repo), "supervisor.recovery", {
        relaunch: saved.relaunches,
        backoffSeconds,
        reason: live ? "stalled" : "session_missing",
      });
      atomicWriteJson(supervisorStatePath(context.repo), saved);
      await delay(process.env.NIGHT_LOOP_TEST_BACKOFF_MS === undefined
        ? backoffSeconds * 1000
        : Number(process.env.NIGHT_LOOP_TEST_BACKOFF_MS));
      await resumeNightLoop(context);
    } else {
      atomicWriteJson(supervisorStatePath(context.repo), saved);
    }
    if (options.once) return;
    await delay(Number(process.env.NIGHT_LOOP_POLL_MS ?? 15000));
  }
}

function versionTuple(value: string): number[] {
  return value.match(/\d+\.\d+\.\d+/)?.[0].split(".").map(Number) ?? [];
}

function atLeast(actual: number[], expected: number[]): boolean {
  for (let index = 0; index < expected.length; index += 1) {
    const left = actual[index] ?? 0;
    const right = expected[index] ?? 0;
    if (left !== right) return left > right;
  }
  return true;
}

export async function doctorNightLoop(context: CommandContext): Promise<Record<string, unknown>> {
  const [claude, git, bun] = await Promise.all([
    runClaude(context, ["--version"]),
    runCommand(["git", "--version"], { cwd: context.repo }),
    runCommand([process.execPath, "--version"], { cwd: context.repo }),
  ]);
  const checks = {
    claude: claude.exitCode === 0 && atLeast(versionTuple(claude.stdout), [2, 1, 139]),
    git: git.exitCode === 0,
    bun: bun.exitCode === 0,
    plugin: pathExists(join(PLUGIN_ROOT, ".claude-plugin", "plugin.json")),
    hooks: ["gate.ts", "loop.ts", "resume.ts", "events.ts"].every((file) => pathExists(join(PLUGIN_ROOT, ".night-loop", "hooks", file))),
  };
  return {
    status: Object.values(checks).every(Boolean) ? "green" : "red",
    checks,
    configured: pathExists(contractPath(context.repo)),
    versions: {
      claude: claude.stdout.trim(),
      git: git.stdout.trim(),
      bun: bun.stdout.trim(),
    },
    platform: { os: process.platform, arch: process.arch },
  };
}

function yamlAcceptance(backlog: string): string[] {
  return backlog.split(/\r?\n/)
    .map((line) => line.match(/^\s+- "(.+)"\s*$/)?.[1])
    .filter((line): line is string => Boolean(line));
}

function markdownEscape(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\r", "").replaceAll("\n", " ");
}

export function morningReceipt(context: CommandContext): { markdown: string; json: string; status: string } {
  const contract = readContract(context.repo);
  const run = readRun(context.repo);
  const events = readLedger(eventPath(context.repo));
  const verified = verifyLedger(events);
  const haltedPath = loopPath(context.repo, "state", "HALTED");
  const halted = pathExists(haltedPath) ? readFileSync(haltedPath, "utf8").trim() : run?.status ?? "not_started";
  const backlog = readFileSync(loopPath(context.repo, "backlog.yaml"), "utf8");
  const progress = readFileSync(loopPath(context.repo, "progress.md"), "utf8");
  const criteria = yamlAcceptance(backlog);
  const blocked = events.filter((event) => /blocked|denied|interaction/.test(event.type));
  const recoveries = events.filter((event) => /resume|relaunch|rejected|failure/.test(event.type));
  const tests = events.filter((event) => event.type.startsWith("harness."));
  const verdicts = events.filter((event) => /judge|claim/.test(event.type));
  const receipt = {
    schemaVersion: 1,
    runId: run?.runId ?? null,
    generatedAt: timestamp(context),
    status: halted,
    permissions: run?.permissions ?? contract.permissions,
    limits: run?.limits ?? contract.limits,
    ledger: { verified, events: events.length, head: events.at(-1)?.hash ?? "GENESIS" },
    criteria,
    tests,
    verdicts,
    recoveries,
    blockedActions: blocked,
    rollback: "Use git log from the receipt, inspect the selected checkpoint, then revert with a new commit.",
    progress,
  };
  const rows = events.map((event) => `| ${markdownEscape(event.id)} | ${event.type} | ${markdownEscape(JSON.stringify(event.data))} |`).join("\n");
  const markdown = [
    "# NIGHT LOOP Morning Receipt",
    "",
    `Status: **${halted}**`,
    `Run: \`${run?.runId ?? "not-started"}\``,
    `Permission profile: \`${run?.permissions ?? contract.permissions}\``,
    `Ledger: **${verified ? "VERIFIED" : "TAMPERED"}**, ${events.length} events, head \`${receipt.ledger.head}\``,
    "",
    "## Acceptance criteria",
    "",
    ...criteria.map((criterion) => `- [ ] ${criterion}`),
    "",
    "## Evidence counts",
    "",
    `- Harness events: ${tests.length}`,
    `- Judge and claim verdicts: ${verdicts.length}`,
    `- Recoveries: ${recoveries.length}`,
    `- Blocked actions and questions: ${blocked.length}`,
    "",
    "## Event tape",
    "",
    "| Event id | Type | Evidence |",
    "|---|---|---|",
    rows || "| none | none | no events recorded |",
    "",
    "## Rollback",
    "",
    receipt.rollback,
    "",
  ].join("\n");
  const base = loopPath(context.repo, "runs", `${run?.runId ?? "latest"}-morning`);
  atomicWriteJson(`${base}.json`, receipt);
  atomicWriteFile(`${base}.md`, markdown);
  return { markdown: `${base}.md`, json: `${base}.json`, status: halted };
}

export function repoContext(repo: string, overrides: Omit<CommandContext, "repo"> = {}): CommandContext {
  return { repo: resolve(repo), ...overrides };
}

export function publicState(state: RunState): Record<string, unknown> {
  return {
    status: state.status,
    runId: state.runId,
    nativeSessionId: state.nativeSessionId ?? null,
    permissions: state.permissions,
    limits: state.limits,
    project: basename(resolve(".")),
  };
}

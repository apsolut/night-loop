import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import {
  appendLedgerEvent,
  atomicWriteFile,
  atomicWriteJson,
  isInteractionRequest,
  isUuid,
  killProcessTree,
  pathExists,
  processAlive,
  readJsonFile,
  readLedger,
  redactSecrets,
  runCommand,
  verifyLedger,
} from "./core";
import {
  ALL_SECRET_ENV,
  PLUGIN_ROOT,
  VERSION_FLOOR,
  grokHookFile,
  grokHookFilePath,
  parseCodexSessionId,
  providerBin,
  providerMode,
  providerShim,
  turnLaunch,
  turnOutput,
  type PermissionProfile,
  type ProviderId,
  type TurnMode,
  type TurnOutput,
  type WorkerLimit,
} from "./providers";
import {
  appendLesson,
  compileConsultPrompt,
  compileThinkPrompt,
  detectStuck,
  extractPlan,
  lessonsPreface,
  readLessons,
  type StuckVerdict,
} from "./reflect";

export type { PermissionProfile, ProviderId, WorkerLimit };

export interface NightContract {
  schemaVersion: 1;
  goal: string;
  provider: ProviderId;
  consult?: Exclude<ProviderId, "claude">;
  permissions: PermissionProfile;
  model?: string;
  effort?: string;
  limits: {
    maxSteps: number;
    maxRelaunches: number;
    workers: WorkerLimit;
  };
  createdAt: string;
}

export interface PendingThink {
  fingerprint: string;
  reason: string;
  episode: number;
  injectedStep?: number;
}

export type RunStatus =
  | "starting"
  | "running"
  | "stopped"
  | "done"
  | "blocked"
  | "budget"
  | "interaction_required"
  | "provider_error";

export interface RunState {
  schemaVersion: 1;
  runId: string;
  provider: ProviderId;
  sessionName: string;
  nativeSessionId?: string;
  nativeShortId?: string;
  sessionEstablished?: boolean;
  status: RunStatus;
  permissions: PermissionProfile;
  limits: NightContract["limits"];
  model?: string;
  effort?: string;
  turns?: number;
  waitingFor?: string | null;
  logsTail?: string[];
  pendingThink?: PendingThink;
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
  interactionTurns?: number;
  progressFingerprints?: string[];
  thinkEpisodes?: Record<string, number>;
}

// Two think turns per stuck fingerprint, then the path is shelved (decision 015).
const THINK_EPISODE_LIMIT = 2;

function stuckWindow(): number {
  return Number(process.env.NIGHT_LOOP_STUCK_TURNS ?? 3);
}

// Consecutive turns that end on a question before the supervisor stops burning the
// subscription on a conversation that is not building anything.
const INTERACTION_TURN_LIMIT = 5;
const LOGS_TAIL_LINES = 40;
const CREDENTIAL_SHAPE = /(?:sk-ant-|api[_ -]?key\s*[:=]|auth[_ -]?token\s*[:=]|password\s*[:=]|ghp_[A-Za-z0-9]{10,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]+PRIVATE KEY-----)/i;

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
  const contract = readJsonFile<NightContract>(path);
  return { ...contract, provider: contract.provider ?? "claude" };
}

export function writeContract(
  context: CommandContext,
  input: {
    goal: string;
    provider?: ProviderId;
    consult?: ProviderId;
    permissions?: PermissionProfile;
    model?: string;
    effort?: string;
    maxSteps?: number;
    maxRelaunches?: number;
    workers?: WorkerLimit;
  },
): NightContract {
  const goal = input.goal.trim();
  if (!goal) throw new Error("setup requires a non-empty goal");
  for (const [name, value] of [["goal", goal], ["model", input.model ?? ""], ["effort", input.effort ?? ""]] as const) {
    if (CREDENTIAL_SHAPE.test(value)) {
      throw new Error(`The ${name} appears to contain a credential. Store only test credential references, never values`);
    }
  }
  if (input.consult === "claude") {
    throw new Error("--consult must be codex or grok: a headless Claude consult is excluded by decision 001");
  }
  const contract: NightContract = {
    schemaVersion: 1,
    goal,
    provider: input.provider ?? "claude",
    ...(input.consult ? { consult: input.consult } : {}),
    permissions: input.permissions ?? "workspace",
    ...(input.model ? { model: input.model } : {}),
    ...(input.effort ? { effort: input.effort } : {}),
    limits: {
      maxSteps: input.maxSteps ?? 2000,
      maxRelaunches: input.maxRelaunches ?? 20,
      workers: input.workers ?? 1,
    },
    createdAt: timestamp(context),
  };
  atomicWriteJson(contractPath(context.repo), contract);
  appendLedgerEvent(eventPath(context.repo), "contract.approved", {
    provider: contract.provider,
    consult: contract.consult ?? null,
    permissions: contract.permissions,
    limits: contract.limits,
    model: contract.model ?? null,
    effort: contract.effort ?? null,
    goalHash: Bun.hash(goal).toString(16),
  }, contract.createdAt);
  return contract;
}

export function compileGoal(contract: NightContract): string {
  const workers = contract.limits.workers;
  const workerPolicy = workers === 1
    ? "Do not spawn subagents or workflows."
    : `Native subagents or workflows are optional accelerators. Never exceed ${workers === "auto" ? 4 : workers} active workers.`;
  const lead = contract.provider === "claude" ? `/goal ${contract.goal}` : `Goal: ${contract.goal}`;
  const instructions = contract.provider === "claude"
    ? "Begin immediately. Follow CLAUDE.md, .night-loop/backlog.yaml, and .night-loop/constraints.md."
    : "Begin immediately. Follow AGENTS.md or CLAUDE.md, .night-loop/backlog.yaml, and .night-loop/constraints.md.";
  return [
    lead,
    instructions,
    "Do not ask the owner questions, request approval, or wait for input after this prompt.",
    "Use deterministic reversible defaults. Record missing authority as blocked and continue with buildable work.",
    workerPolicy,
    "The independent NIGHT LOOP harness, not your own completion claim, decides when the run is done.",
  ].join("\n\n");
}

export function generatedSettings(contract: NightContract): Record<string, unknown> {
  // The worker cap is enforced by the PreToolUse gate, not a settings-level Agent
  // deny: a bare deny would fire before the gate and block the night-loop-judge,
  // making certification unreachable at workers=1 (decision 005).
  const deny = ["Skill(batch)", "Skill(autofix-pr)"];
  return {
    permissions: {
      defaultMode: permissionMode(contract.permissions),
      allow: ["Read", "Glob", "Grep", "Edit", "Write", "MultiEdit", "Bash"],
      deny,
    },
    env: {
      NIGHT_LOOP_MAX_STEPS: String(contract.limits.maxSteps),
      NIGHT_LOOP_WORKERS: String(contract.limits.workers),
      // Claude ends a turn after eight consecutive Stop-hook blocks with no tool call in
      // between. The step cap is the real bound, so raise the native cap above it.
      CLAUDE_CODE_STOP_HOOK_BLOCK_CAP: "64",
      // A turn cut by SIGTERM or a restart resumes instead of being dropped.
      CLAUDE_CODE_RESUME_INTERRUPTED_TURN: "1",
    },
    // Unattended --bg sessions must edit the shared checkout. Without this,
    // Claude blocks writes until EnterWorktree, which is an execution-time question.
    worktree: { bgIsolation: "none" },
  };
}

export function parseBackgroundSessionId(output: string): string | undefined {
  const uuid = output.match(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/i)?.[0];
  if (uuid) return uuid;
  // `claude --bg` prints `backgrounded · <short id> · <name>`; the full UUID is
  // resolved later from `claude agents --json` (decision 012).
  const short = output.match(/\bbackgrounded\s*[^\s0-9a-z]*\s*([0-9a-f]{6,})\b/i)?.[1];
  if (short) return short;
  return output.match(/(?:session|agent|id)\s*[:#]?\s*([a-z0-9][a-z0-9_-]{5,})/i)?.[1];
}

function runId(now: string): string {
  return now.replace(/[^0-9A-Za-z]+/g, "-").replace(/^-|-$/g, "");
}

function activeMarker(repo: string): string {
  return loopPath(repo, "state", "ACTIVE");
}

function haltedPath(repo: string): string {
  return loopPath(repo, "state", "HALTED");
}

function writeRun(repo: string, state: RunState): void {
  atomicWriteJson(runStatePath(repo), state);
}

function supervisorStatePath(repo: string): string {
  return loopPath(repo, "state", "supervisor.json");
}

function supervisorPidPath(repo: string): string {
  return loopPath(repo, "state", "SUPERVISOR_PID");
}

function providerPidPath(repo: string): string {
  return loopPath(repo, "state", "PROVIDER_PID");
}

function nextPromptPath(repo: string): string {
  return loopPath(repo, "state", "NEXT_PROMPT");
}

function readPid(path: string): number | undefined {
  if (!pathExists(path)) return undefined;
  const pid = Number(readFileSync(path, "utf8").trim());
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

async function waitForExit(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (!processAlive(pid)) return;
    await Bun.sleep(10);
  }
}

async function terminateSupervisor(context: CommandContext, updatedAt: string): Promise<void> {
  const pidPath = supervisorPidPath(context.repo);
  if (!pathExists(pidPath)) return;
  const pid = readPid(pidPath);
  if (pid === undefined) {
    rmSync(pidPath, { force: true });
    return;
  }
  try { process.kill(pid); } catch {}
  await waitForExit(pid);
  rmSync(pidPath, { force: true });
  appendLedgerEvent(eventPath(context.repo), "supervisor.stopped", { pid }, updatedAt);
}

async function terminateProvider(context: CommandContext, updatedAt: string): Promise<void> {
  const pidPath = providerPidPath(context.repo);
  const pid = readPid(pidPath);
  rmSync(pidPath, { force: true });
  if (pid === undefined) return;
  killProcessTree(pid);
  await waitForExit(pid);
  appendLedgerEvent(eventPath(context.repo), "provider.terminated", { pid }, updatedAt);
}

function readStep(repo: string): number {
  try { return Number(readFileSync(loopPath(repo, "state", "STEP"), "utf8").trim()) || 0; } catch { return 0; }
}

function readRun(repo: string): RunState | undefined {
  if (!pathExists(runStatePath(repo))) return undefined;
  const state = readJsonFile<RunState>(runStatePath(repo));
  return { ...state, provider: state.provider ?? "claude" };
}

function readSupervisorState(repo: string): SupervisorState {
  return pathExists(supervisorStatePath(repo))
    ? readJsonFile<SupervisorState>(supervisorStatePath(repo))
    : { relaunches: 0, lastStep: -1, stalledTicks: 0 };
}

// The run carries the profile and limits that were armed; a later attended setup never
// upgrades them implicitly.
function preservedContract(repo: string, state: RunState): NightContract {
  const contract = readContract(repo);
  return {
    ...contract,
    provider: state.provider,
    permissions: state.permissions,
    limits: state.limits,
    ...(state.model ? { model: state.model } : {}),
    ...(state.effort ? { effort: state.effort } : {}),
  };
}

function claudeSessionArgs(contract: NightContract): string[] {
  const args: string[] = [];
  if (contract.model) args.push("--model", contract.model);
  if (contract.effort) args.push("--effort", contract.effort);
  return args;
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
    ...claudeSessionArgs(contract),
    prompt,
  ];
}

const RESUME_PROMPT = "Resume NIGHT LOOP from .night-loop/progress.md and git state. Continue the next unmet milestone; fix the ratchet first if it is red.";

function withLessons(repo: string, prompt: string): string {
  const preface = lessonsPreface(repo);
  return preface ? `${prompt}\n\n${preface.trimEnd()}` : prompt;
}

function resumeClaudeArgs(
  repo: string,
  contract: NightContract,
  sessionId: string,
  prompt: string = withLessons(repo, RESUME_PROMPT),
): [string, ...string[]] {
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
    ...claudeSessionArgs(contract),
    prompt,
  ];
}

async function runClaude(context: CommandContext, args: [string, ...string[]]) {
  const shim = process.env.NIGHT_LOOP_CLAUDE_SHIM;
  const command: [string, ...string[]] = shim
    ? [claudeBin(context), shim, ...args]
    : [claudeBin(context), ...args];
  return runCommand(command, { cwd: context.repo, unsetEnv: ALL_SECRET_ENV });
}

async function runProvider(context: CommandContext, provider: ProviderId, args: [string, ...string[]]) {
  if (provider === "claude") return runClaude(context, args);
  const shim = providerShim(provider);
  const command: [string, ...string[]] = shim
    ? [providerBin(provider), shim, ...args]
    : [providerBin(provider), ...args];
  return runCommand(command, { cwd: context.repo, unsetEnv: ALL_SECRET_ENV });
}

function spawnSupervisor(context: CommandContext, state: RunState): void {
  if (process.env.NIGHT_LOOP_DISABLE_WATCH === "1") return;
  const env = { ...process.env };
  for (const name of ALL_SECRET_ENV) delete env[name];
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
  atomicWriteFile(supervisorPidPath(context.repo), `${supervisor.pid}\n`);
  appendLedgerEvent(eventPath(context.repo), "supervisor.started", { pid: supervisor.pid }, state.updatedAt);
}

// Grok reads project hooks from .grok/hooks/*.json; the file is regenerated on every
// start and resume so it always points at this checkout's bridge.
function prepareProviderFiles(repo: string, provider: ProviderId): void {
  if (provider === "grok") atomicWriteJson(grokHookFilePath(repo), grokHookFile());
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
    provider: contract.provider,
    sessionName: "night-loop",
    status: "starting",
    permissions: contract.permissions,
    limits: contract.limits,
    ...(contract.model ? { model: contract.model } : {}),
    ...(contract.effort ? { effort: contract.effort } : {}),
    startedAt: now,
    updatedAt: now,
  };
  mkdirSync(loopPath(context.repo, "runs"), { recursive: true });
  atomicWriteFile(loopPath(context.repo, "state", "STEP"), "0\n");
  for (const marker of ["HALTED", "CLAIM_DONE", "ALL_BLOCKED", "REVIEW", "NEXT_PROMPT", "PROVIDER_PID"]) {
    rmSync(loopPath(context.repo, "state", marker), { force: true });
  }
  rmSync(supervisorStatePath(context.repo), { force: true });
  atomicWriteFile(activeMarker(context.repo), `${state.runId}\n`);
  writeRun(context.repo, state);
  appendLedgerEvent(eventPath(context.repo), "run.starting", {
    runId: state.runId,
    provider: state.provider,
    permissions: state.permissions,
    permissionMode: permissionMode(state.permissions),
    limits: state.limits,
  }, now);

  if (providerMode(contract.provider) === "turn") {
    prepareProviderFiles(context.repo, contract.provider);
    atomicWriteFile(nextPromptPath(context.repo), withLessons(context.repo, compileGoal(contract)));
    state.status = "running";
    state.updatedAt = timestamp(context);
    writeRun(context.repo, state);
    appendLedgerEvent(eventPath(context.repo), "run.started", {
      provider: state.provider,
      mode: "turn",
      nativeSessionId: null,
      sessionName: state.sessionName,
    }, state.updatedAt);
    spawnSupervisor(context, state);
    return state;
  }

  const result = await runClaude(context, claudeArgs(context.repo, contract, withLessons(context.repo, compileGoal(contract))));
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
      stderr: redactSecrets(result.stderr).slice(0, 500),
    }, state.updatedAt);
    return state;
  }
  const parsed = parseBackgroundSessionId(`${result.stdout}\n${result.stderr}`);
  state.nativeSessionId = parsed;
  if (parsed && !isUuid(parsed)) state.nativeShortId = parsed;
  state.status = "running";
  state.updatedAt = timestamp(context);
  writeRun(context.repo, state);
  appendLedgerEvent(eventPath(context.repo), "run.started", {
    provider: state.provider,
    mode: "background",
    nativeSessionId: state.nativeSessionId ?? null,
    sessionName: state.sessionName,
  }, state.updatedAt);
  spawnSupervisor(context, state);
  return state;
}

interface ClaudeAgentRecord {
  id?: string;
  sessionId?: string;
  name?: string;
  state?: string;
  status?: string;
  waitingFor?: string;
  pid?: number;
  cwd?: string;
  [key: string]: unknown;
}

const ENDED_STATES = new Set(["done", "failed", "stopped"]);

function matchesRun(agent: ClaudeAgentRecord, local: RunState | undefined): boolean {
  if (!local) return false;
  const ids = [local.nativeSessionId, local.nativeShortId].filter(Boolean);
  if (ids.length > 0 && (ids.includes(agent.id) || ids.includes(agent.sessionId))) return true;
  return agent.name === local.sessionName;
}

export async function statusNightLoop(
  context: CommandContext,
  options: { logs?: boolean } = {},
): Promise<Record<string, unknown>> {
  const local = readRun(context.repo);
  if (local && providerMode(local.provider) === "turn") return turnStatus(context, local);
  const result = await runClaude(context, ["agents", "--json", "--all", "--cwd", context.repo]);
  let agents: ClaudeAgentRecord[] = [];
  if (result.exitCode === 0) {
    try { agents = JSON.parse(result.stdout) as ClaudeAgentRecord[]; } catch { agents = []; }
  }
  const native = agents.find((agent) => matchesRun(agent, local));
  if (native && local) {
    let changed = false;
    if (isUuid(native.sessionId) && local.nativeSessionId !== native.sessionId) {
      local.nativeSessionId = native.sessionId;
      changed = true;
    }
    if (typeof native.id === "string" && local.nativeShortId !== native.id) {
      local.nativeShortId = native.id;
      changed = true;
    }
    const waitingFor = typeof native.waitingFor === "string" ? native.waitingFor : null;
    if (waitingFor !== (local.waitingFor ?? null)) {
      if (waitingFor) {
        appendLedgerEvent(eventPath(context.repo), "interaction_required", {
          source: "native_status",
          waitingFor,
          action: "record_only",
        }, timestamp(context));
      }
      local.waitingFor = waitingFor;
      changed = true;
    }
    if (options.logs) {
      const logs = await runClaude(context, ["logs", local.nativeShortId ?? local.nativeSessionId ?? local.sessionName]);
      local.logsTail = redactSecrets(`${logs.stdout}\n${logs.stderr}`)
        .split(/\r?\n/)
        .filter((line) => line.trim())
        .slice(-LOGS_TAIL_LINES);
      changed = true;
    }
    if (changed) {
      local.updatedAt = timestamp(context);
      writeRun(context.repo, local);
    }
  }
  return {
    status: native?.state ?? native?.status ?? local?.status ?? "not_configured",
    provider: local?.provider ?? "claude",
    run: local ?? null,
    native: native ?? null,
    active: existsSync(activeMarker(context.repo)),
  };
}

function turnStatus(context: CommandContext, local: RunState): Record<string, unknown> {
  const providerPid = readPid(providerPidPath(context.repo));
  const supervisorPid = readPid(supervisorPidPath(context.repo));
  return {
    status: local.status,
    provider: local.provider,
    run: local,
    native: {
      provider: local.provider,
      sessionId: local.nativeSessionId ?? null,
      turns: local.turns ?? 0,
      pid: providerPid ?? null,
      alive: providerPid !== undefined && processAlive(providerPid),
      supervisorAlive: supervisorPid !== undefined && processAlive(supervisorPid),
    },
    active: existsSync(activeMarker(context.repo)),
  };
}

export async function stopNightLoop(context: CommandContext): Promise<RunState> {
  const state = readRun(context.repo);
  if (!state) throw new Error("No NIGHT LOOP run state exists");
  state.updatedAt = timestamp(context);
  if (providerMode(state.provider) === "turn") {
    rmSync(activeMarker(context.repo), { force: true });
    await terminateSupervisor(context, state.updatedAt);
    await terminateProvider(context, state.updatedAt);
    state.status = "stopped";
    writeRun(context.repo, state);
    appendLedgerEvent(eventPath(context.repo), "run.stopped", {
      provider: state.provider,
      nativeSessionId: state.nativeSessionId ?? null,
    }, state.updatedAt);
    return state;
  }
  let sessionId = state.nativeShortId ?? state.nativeSessionId;
  if (!sessionId) {
    const status = await statusNightLoop(context);
    const native = status.native as ClaudeAgentRecord | null;
    sessionId = native?.id ?? native?.sessionId;
  }
  const result = sessionId ? await runClaude(context, ["stop", sessionId]) : undefined;
  if (result && result.exitCode !== 0) throw new Error(`Claude stop failed with exit code ${result.exitCode}`);
  rmSync(activeMarker(context.repo), { force: true });
  state.status = "stopped";
  await terminateSupervisor(context, state.updatedAt);
  writeRun(context.repo, state);
  appendLedgerEvent(eventPath(context.repo), "run.stopped", {
    provider: state.provider,
    nativeSessionId: sessionId ?? null,
  }, state.updatedAt);
  return state;
}

// Resume continues the armed night exactly. A setup typed after a stop lands in
// contract.json, which the in-turn gate reads for its worker cap, so the armed values are
// written back before any provider restarts (decision 014). A changed contract applies to
// the next start, never to a resume.
function restoreArmedContract(context: CommandContext, state: RunState, armed: NightContract): void {
  const onDisk = readContract(context.repo);
  const view = (contract: NightContract) => JSON.stringify({
    provider: contract.provider,
    permissions: contract.permissions,
    limits: contract.limits,
    model: contract.model ?? null,
    effort: contract.effort ?? null,
  });
  if (view(onDisk) === view(armed)) return;
  atomicWriteJson(contractPath(context.repo), armed);
  appendLedgerEvent(eventPath(context.repo), "contract.restored", {
    runId: state.runId,
    superseded: JSON.parse(view(onDisk)) as Record<string, unknown>,
    armed: JSON.parse(view(armed)) as Record<string, unknown>,
  }, state.updatedAt);
}

export async function resumeNightLoop(context: CommandContext): Promise<RunState> {
  const state = readRun(context.repo);
  if (!state?.nativeSessionId) throw new Error("No resumable provider session id exists");
  const contract = preservedContract(context.repo, state);
  state.updatedAt = timestamp(context);
  restoreArmedContract(context, state, contract);
  if (providerMode(state.provider) === "turn") {
    prepareProviderFiles(context.repo, state.provider);
    rmSync(haltedPath(context.repo), { force: true });
    // The queued prompt (verifier reason or think prompt) survives a stop; resume refreshes
    // the lessons section so the provider sees what was learned since.
    const queued = pathExists(nextPromptPath(context.repo))
      ? readFileSync(nextPromptPath(context.repo), "utf8").split("\n\nLessons recorded so far:")[0]!
      : RESUME_PROMPT;
    atomicWriteFile(nextPromptPath(context.repo), withLessons(context.repo, queued));
    state.status = "running";
    atomicWriteFile(activeMarker(context.repo), `${state.runId}\n`);
    writeRun(context.repo, state);
    appendLedgerEvent(eventPath(context.repo), "run.resumed", {
      provider: state.provider,
      nativeSessionId: state.nativeSessionId,
      permissions: state.permissions,
      limits: state.limits,
    }, state.updatedAt);
    spawnSupervisor(context, state);
    return state;
  }
  if (!isUuid(state.nativeSessionId)) {
    // Only the short id was captured at launch; the UUID comes from the agents list.
    await statusNightLoop(context);
    const refreshed = readRun(context.repo);
    if (refreshed?.nativeSessionId) state.nativeSessionId = refreshed.nativeSessionId;
    if (refreshed?.nativeShortId) state.nativeShortId = refreshed.nativeShortId;
  }
  const result = await runClaude(context, resumeClaudeArgs(context.repo, contract, state.nativeSessionId));
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
  const parsed = parseBackgroundSessionId(`${result.stdout}\n${result.stderr}`);
  if (parsed && isUuid(parsed)) state.nativeSessionId = parsed;
  else if (parsed) state.nativeShortId = parsed;
  state.status = "running";
  atomicWriteFile(activeMarker(context.repo), `${state.runId}\n`);
  writeRun(context.repo, state);
  appendLedgerEvent(eventPath(context.repo), "run.resumed", {
    provider: state.provider,
    nativeSessionId: state.nativeSessionId,
    permissions: state.permissions,
    limits: state.limits,
  }, state.updatedAt);
  return state;
}

async function terminateNativeSession(context: CommandContext, state: RunState): Promise<void> {
  const id = state.nativeShortId ?? state.nativeSessionId;
  if (!id) return;
  const result = await runClaude(context, ["stop", id]);
  appendLedgerEvent(eventPath(context.repo), "supervisor.terminated_session", {
    nativeSessionId: id,
    exitCode: result.exitCode,
  }, state.updatedAt);
}

function haltStatus(reason: string): RunStatus {
  return reason === "done" || reason === "blocked" || reason === "budget" || reason === "interaction_required"
    ? reason
    : "stopped";
}

interface SuperviseOptions {
  once?: boolean;
  delay?: (milliseconds: number) => Promise<void>;
}

export async function superviseNightLoop(
  context: CommandContext,
  options: SuperviseOptions = {},
): Promise<void> {
  const initial = readRun(context.repo);
  if (initial && providerMode(initial.provider) === "turn") {
    await superviseTurns(context, options);
    return;
  }
  const delay = options.delay ?? ((milliseconds: number) => Bun.sleep(milliseconds));
  const stallLimit = Number(process.env.NIGHT_LOOP_STALL_TICKS ?? 80);
  if (!options.once) await delay(Number(process.env.NIGHT_LOOP_POLL_MS ?? 15000));
  while (existsSync(activeMarker(context.repo))) {
    const state = readRun(context.repo);
    if (!state) return;
    const halted = haltedPath(context.repo);
    if (pathExists(halted)) {
      const reason = readFileSync(halted, "utf8").trim();
      state.status = haltStatus(reason);
      state.updatedAt = timestamp(context);
      await terminateNativeSession(context, state);
      rmSync(activeMarker(context.repo), { force: true });
      writeRun(context.repo, state);
      return;
    }
    const saved = readSupervisorState(context.repo);
    const step = readStep(context.repo);
    saved.stalledTicks = step === saved.lastStep ? saved.stalledTicks + 1 : 0;
    saved.lastStep = step;
    const native = await statusNightLoop(context);
    const live = native.native as ClaudeAgentRecord | null;
    const alive = live !== null && !ENDED_STATES.has(String(live.state ?? ""));
    const shouldRecover = !alive || saved.stalledTicks >= stallLimit;
    if (shouldRecover) {
      if (saved.relaunches >= state.limits.maxRelaunches) {
        state.status = "budget";
        state.updatedAt = timestamp(context);
        atomicWriteFile(halted, "budget\n");
        await terminateNativeSession(context, state);
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
        reason: alive ? "stalled" : "session_missing",
      });
      appendLesson(context.repo, `recovery(${alive ? "stalled" : "session_missing"}) relaunch ${saved.relaunches} at step ${step}`, timestamp(context));
      atomicWriteJson(supervisorStatePath(context.repo), saved);
      await delay(process.env.NIGHT_LOOP_TEST_BACKOFF_MS === undefined
        ? backoffSeconds * 1000
        : Number(process.env.NIGHT_LOOP_TEST_BACKOFF_MS));
      if (!existsSync(activeMarker(context.repo)) || pathExists(halted)) {
        appendLedgerEvent(eventPath(context.repo), "supervisor.recovery_cancelled", {
          reason: "stopped_or_halted_during_backoff",
        }, timestamp(context));
        return;
      }
      await resumeNightLoop(context);
    } else {
      await reflectOnClaudeSession(context, state, saved, step, saved.stalledTicks === 0);
      atomicWriteJson(supervisorStatePath(context.repo), saved);
    }
    if (options.once) return;
    await delay(Number(process.env.NIGHT_LOOP_POLL_MS ?? 15000));
  }
}

// The Claude session is hook-driven, so the think prompt is delivered as its next turn
// through native resume (2.1.284) and its completion is read from STEP progress.
async function reflectOnClaudeSession(
  context: CommandContext,
  loopState: RunState,
  saved: SupervisorState,
  step: number,
  stepAdvanced: boolean,
): Promise<void> {
  // The status poll just refreshed run.json (full UUID, waitingFor); work on that copy.
  const state = readRun(context.repo) ?? loopState;
  // One tree fingerprint per Stop-hook step, so "unchanged for three steps" means the same
  // thing for a Claude session as "unchanged for three turns" does for Codex or Grok.
  if (stepAdvanced && step > 0 && !state.pendingThink) {
    const fingerprint = await progressFingerprint(context.repo);
    if (fingerprint) saved.progressFingerprints = [...(saved.progressFingerprints ?? []), fingerprint].slice(-stuckWindow());
  }
  const pending = state.pendingThink;
  if (pending) {
    if (pending.injectedStep !== undefined && step > pending.injectedStep) {
      appendLedgerEvent(eventPath(context.repo), "think.completed", {
        fingerprint: pending.fingerprint,
        reason: pending.reason,
        episode: pending.episode,
        plan: null,
      }, timestamp(context));
      appendLesson(context.repo, `think(${pending.reason}) delivered to claude at step ${pending.injectedStep}, continued at step ${step}`, timestamp(context));
      delete state.pendingThink;
      state.updatedAt = timestamp(context);
      writeRun(context.repo, state);
    }
    return;
  }
  const stuck = detectStuck(readLedger(eventPath(context.repo)), stuckWindow(), saved.progressFingerprints ?? []);
  if (!stuck.stuck || !state.nativeSessionId) return;
  const contract = preservedContract(context.repo, state);
  const decision = await scheduleThink(context, state, contract, saved, stuck);
  saved.progressFingerprints = [];
  const prompt = decision.kind === "think" ? decision.prompt : decision.instruction;
  const result = await runClaude(context, resumeClaudeArgs(context.repo, contract, state.nativeSessionId, prompt));
  const delivered = result.exitCode === 0;
  // A failed delivery neither resets the episode nor leaves a think pending: the next poll
  // sees the same stuck evidence and tries again, bounded by the episode limit.
  const eventType = !delivered ? "think.inject_failed" : decision.kind === "think" ? "think.injected" : "shelve.injected";
  appendLedgerEvent(eventPath(context.repo), eventType, {
    fingerprint: stuck.fingerprint,
    exitCode: result.exitCode,
    step,
  }, timestamp(context));
  if (decision.kind === "think" && delivered) {
    state.pendingThink = { ...decision.pending, injectedStep: step };
  }
  state.updatedAt = timestamp(context);
  writeRun(context.repo, state);
}

interface TurnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  killed?: "stalled" | "stopped";
  output: TurnOutput;
}

// One headless provider turn, watched for stop and stall while it runs. The provider
// process tree is killed, never left behind, when ACTIVE disappears or STEP stops moving.
async function runTurn(
  context: CommandContext,
  state: RunState,
  contract: NightContract,
  prompt: string,
  limits: { pollMs: number; stallLimit: number },
  mode: TurnMode = "build",
): Promise<TurnResult> {
  const provider = state.provider as Exclude<ProviderId, "claude">;
  const session = state.sessionEstablished && state.nativeSessionId
    ? { resume: state.nativeSessionId }
    : { create: provider === "grok" ? state.nativeSessionId ?? crypto.randomUUID() : undefined };
  if (session.create && state.nativeSessionId !== session.create) {
    state.nativeSessionId = session.create;
    state.updatedAt = timestamp(context);
    writeRun(context.repo, state);
  }
  const launch = turnLaunch(provider, context.repo, contract, prompt, session, mode);
  const env: Record<string, string | undefined> = {
    ...process.env,
    ...launch.env,
    // In-turn hooks inherit the armed limits, never a later attended setup's.
    NIGHT_LOOP_MAX_STEPS: String(contract.limits.maxSteps),
    NIGHT_LOOP_WORKERS: String(contract.limits.workers),
  };
  for (const name of ALL_SECRET_ENV) delete env[name];
  const child = Bun.spawn(launch.command, {
    cwd: context.repo,
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    detached: process.platform !== "win32",
  });
  atomicWriteFile(providerPidPath(context.repo), `${child.pid}\n`);
  let stdout = "";
  const stderrText = new Response(child.stderr).text();
  const reader = (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of child.stdout) {
      stdout += decoder.decode(chunk, { stream: true });
      if (provider === "codex" && !state.nativeSessionId) {
        const id = parseCodexSessionId(stdout);
        if (id) {
          // thread.started means Codex has persisted the thread: a turn killed by stop or
          // the stall watchdog after this point is resumable, not restarted.
          state.nativeSessionId = id;
          state.sessionEstablished = true;
          state.updatedAt = timestamp(context);
          writeRun(context.repo, state);
          appendLedgerEvent(eventPath(context.repo), "turn.session", { provider, nativeSessionId: id }, state.updatedAt);
        }
      }
    }
  })();
  let killed: TurnResult["killed"];
  let finished = false;
  let cancelSleep: (() => void) | undefined;
  const sleep = (milliseconds: number) => new Promise<void>((resolveSleep) => {
    const timer = setTimeout(resolveSleep, milliseconds);
    cancelSleep = () => { clearTimeout(timer); resolveSleep(); };
  });
  const watchdog = (async () => {
    let lastStep = readStep(context.repo);
    let ticks = 0;
    while (!finished) {
      await sleep(limits.pollMs);
      if (finished) break;
      if (!existsSync(activeMarker(context.repo)) || pathExists(haltedPath(context.repo))) {
        killed = "stopped";
        killProcessTree(child.pid);
        break;
      }
      const step = readStep(context.repo);
      if (step === lastStep) ticks += 1;
      else { ticks = 0; lastStep = step; }
      if (ticks >= limits.stallLimit) {
        killed = "stalled";
        killProcessTree(child.pid);
        break;
      }
    }
  })();
  const exitCode = await child.exited;
  finished = true;
  cancelSleep?.();
  await reader;
  const stderr = await stderrText;
  await watchdog;
  rmSync(providerPidPath(context.repo), { force: true });
  return { exitCode, stdout, stderr, killed, output: turnOutput(provider, stdout) };
}

// Runs the unchanged Stop-hook verifier against the repository (decision 010).
async function runVerifier(context: CommandContext, contract: NightContract): Promise<{ decision?: string; reason?: string }> {
  const hook = join(PLUGIN_ROOT, ".night-loop", "hooks", "loop.ts");
  const result = await runCommand([process.execPath, hook], {
    cwd: context.repo,
    env: { CLAUDE_PROJECT_DIR: context.repo, NIGHT_LOOP_MAX_STEPS: String(contract.limits.maxSteps) },
    unsetEnv: ALL_SECRET_ENV,
  });
  const line = result.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
  if (!line) return {};
  try { return JSON.parse(line) as { decision?: string; reason?: string }; } catch { return {}; }
}

// A hash of the working tree so "three turns, nothing changed" is a fact, not a feeling.
// Undefined when the repository has no git, so a plain fixture is never called stuck.
async function progressFingerprint(repo: string): Promise<string | undefined> {
  const status = await runCommand(["git", "status", "--porcelain"], { cwd: repo });
  if (status.exitCode !== 0) return undefined;
  const diff = await runCommand(["git", "diff", "HEAD"], { cwd: repo });
  const head = await runCommand(["git", "rev-parse", "HEAD"], { cwd: repo });
  // Untracked files show in porcelain by name only; their contents count as progress too.
  const untracked = await runCommand(["git", "ls-files", "--others", "--exclude-standard"], { cwd: repo });
  const contents: string[] = [];
  for (const file of untracked.stdout.split(/\r?\n/).filter(Boolean).slice(0, 500)) {
    try {
      const blob = Bun.file(join(repo, file));
      contents.push(`${file}:${blob.size}:${blob.size <= 1_000_000 ? Bun.hash(await blob.arrayBuffer()).toString(16) : "large"}`);
    } catch {
      contents.push(`${file}:unreadable`);
    }
  }
  return Bun.hash(`${head.stdout}\n${status.stdout}\n${diff.stdout}\n${contents.join("\n")}`).toString(16);
}

// A read-only second opinion from the configured consultant (decision 015). Never edits,
// never resumes the implementer's session, never sees an API key.
async function runConsult(
  context: CommandContext,
  contract: NightContract,
  verdict: StuckVerdict,
): Promise<{ provider: string; text: string } | undefined> {
  const provider = contract.consult;
  if (!provider) return undefined;
  const launch = turnLaunch(provider, context.repo, contract, compileConsultPrompt(verdict, readLessons(context.repo)), {}, "consult");
  const result = await runCommand(launch.command, { cwd: context.repo, env: launch.env, unsetEnv: ALL_SECRET_ENV });
  const text = redactSecrets(turnOutput(provider, result.stdout).lastMessage).trim().slice(0, 4000);
  if (result.exitCode !== 0 || !text) {
    appendLedgerEvent(eventPath(context.repo), "consult.failed", {
      provider,
      exitCode: result.exitCode,
      stderr: redactSecrets(result.stderr).slice(0, 300),
    }, timestamp(context));
    return undefined;
  }
  atomicWriteFile(loopPath(context.repo, "state", "CONSULT.md"), `# Consult (${provider})\n\n${text}\n`);
  appendLedgerEvent(eventPath(context.repo), "consult.completed", {
    provider,
    bytes: Buffer.byteLength(text),
    plan: extractPlan(text) ?? null,
  }, timestamp(context));
  appendLesson(context.repo, `consult(${provider}): ${extractPlan(text) ?? text.slice(0, 200)}`, timestamp(context));
  return { provider, text };
}

function progressPath(repo: string): string {
  return loopPath(repo, "progress.md");
}

// Third episode on the same fingerprint: the path goes under Blocked with the plan attached
// and the agent is told to pick another milestone. The night continues.
function shelveStuckPath(context: CommandContext, state: RunState, verdict: StuckVerdict, plan: string | undefined): string {
  const now = timestamp(context);
  const line = `- SHELVED by the supervisor on ${now} after ${THINK_EPISODE_LIMIT} think turns (${verdict.reason}): ` +
    `${verdict.evidence.join("; ").slice(0, 300)}. Last plan: ${plan ?? "none recorded"}`;
  const path = progressPath(context.repo);
  const current = pathExists(path) ? readFileSync(path, "utf8") : "# Progress Ledger\n";
  const heading = "## Blocked / needs human";
  const index = current.indexOf(heading);
  const updated = index >= 0
    ? `${current.slice(0, index + heading.length)}\n${line}${current.slice(index + heading.length)}`
    : `${current.trimEnd()}\n\n${heading}\n${line}\n`;
  atomicWriteFile(path, updated);
  appendLedgerEvent(eventPath(context.repo), "stuck.shelved", {
    fingerprint: verdict.fingerprint,
    reason: verdict.reason,
    plan: plan ?? null,
  }, now);
  appendLesson(context.repo, `shelved(${verdict.reason}): ${verdict.evidence[0] ?? ""}`, now);
  return `The supervisor SHELVED the current path after ${THINK_EPISODE_LIMIT} think turns on the same failure ` +
    `(${verdict.evidence.join("; ").slice(0, 200)}). It is recorded under Blocked in .night-loop/progress.md. ` +
    "Do not retry it tonight. Pick a different buildable milestone and continue.";
}

// Decides what happens after a stuck verdict: a think turn, or a shelve on the third episode.
async function scheduleThink(
  context: CommandContext,
  state: RunState,
  contract: NightContract,
  saved: SupervisorState,
  verdict: StuckVerdict,
): Promise<{ kind: "think"; prompt: string; pending: PendingThink } | { kind: "shelve"; instruction: string }> {
  const fingerprint = verdict.fingerprint ?? "unknown";
  const episodes = saved.thinkEpisodes ?? {};
  const episode = (episodes[fingerprint] ?? 0) + 1;
  const now = timestamp(context);
  appendLedgerEvent(eventPath(context.repo), "stuck.detected", {
    reason: verdict.reason,
    fingerprint,
    episode,
    evidence: verdict.evidence,
  }, now);
  appendLesson(context.repo, `stuck(${verdict.reason}) episode ${episode}: ${verdict.evidence[0] ?? ""}`, now);
  if (episode > THINK_EPISODE_LIMIT) {
    const thinkPath = loopPath(context.repo, "state", "THINK.md");
    const lastPlan = pathExists(thinkPath) ? extractPlan(readFileSync(thinkPath, "utf8")) : undefined;
    return { kind: "shelve", instruction: shelveStuckPath(context, state, verdict, lastPlan) };
  }
  episodes[fingerprint] = episode;
  saved.thinkEpisodes = episodes;
  const consult = await runConsult(context, contract, verdict);
  const prompt = compileThinkPrompt(verdict, readLessons(context.repo), consult);
  appendLedgerEvent(eventPath(context.repo), "think.scheduled", {
    reason: verdict.reason,
    fingerprint,
    episode,
    consult: consult?.provider ?? null,
  }, now);
  return { kind: "think", prompt, pending: { fingerprint, reason: String(verdict.reason), episode } };
}

function completeThink(context: CommandContext, state: RunState, text: string): string | undefined {
  const pending = state.pendingThink;
  if (!pending) return undefined;
  const redacted = redactSecrets(text).trim();
  const plan = extractPlan(redacted) ?? redacted.split(/\r?\n/).filter(Boolean).at(-1)?.slice(0, 300);
  if (redacted) atomicWriteFile(loopPath(context.repo, "state", "THINK.md"), `# Think turn (${pending.reason}, episode ${pending.episode})\n\n${redacted}\n`);
  appendLedgerEvent(eventPath(context.repo), "think.completed", {
    fingerprint: pending.fingerprint,
    reason: pending.reason,
    episode: pending.episode,
    plan: plan ?? null,
  }, timestamp(context));
  appendLesson(context.repo, `think(${pending.reason}): ${plan ?? "no plan line"}`, timestamp(context));
  delete state.pendingThink;
  return plan;
}

function finalizeHalt(context: CommandContext, state: RunState, reason: string, event?: string): void {
  state.status = haltStatus(reason);
  state.updatedAt = timestamp(context);
  rmSync(activeMarker(context.repo), { force: true });
  writeRun(context.repo, state);
  if (event) appendLedgerEvent(eventPath(context.repo), event, { reason, provider: state.provider }, state.updatedAt);
}

async function superviseTurns(context: CommandContext, options: SuperviseOptions): Promise<void> {
  const delay = options.delay ?? ((milliseconds: number) => Bun.sleep(milliseconds));
  const pollMs = Number(process.env.NIGHT_LOOP_POLL_MS ?? 15000);
  const stallLimit = Number(process.env.NIGHT_LOOP_STALL_TICKS ?? 80);
  while (existsSync(activeMarker(context.repo))) {
    const state = readRun(context.repo);
    if (!state) return;
    const halted = haltedPath(context.repo);
    if (pathExists(halted)) {
      finalizeHalt(context, state, readFileSync(halted, "utf8").trim(), "supervisor.halted");
      return;
    }
    const contract = preservedContract(context.repo, state);
    const saved = readSupervisorState(context.repo);
    const prompt = pathExists(nextPromptPath(context.repo))
      ? readFileSync(nextPromptPath(context.repo), "utf8")
      : compileGoal(contract);
    const turn = (state.turns ?? 0) + 1;
    appendLedgerEvent(eventPath(context.repo), "turn.started", {
      turn,
      provider: state.provider,
      nativeSessionId: state.nativeSessionId ?? null,
      resume: Boolean(state.sessionEstablished && state.nativeSessionId),
      promptHash: Bun.hash(prompt).toString(16),
    }, timestamp(context));
    const thinking = Boolean(state.pendingThink);
    const result = await runTurn(context, state, contract, prompt, { pollMs, stallLimit }, thinking ? "think" : "build");
    state.turns = turn;
    if (result.output.sessionId && !state.nativeSessionId) state.nativeSessionId = result.output.sessionId;
    state.updatedAt = timestamp(context);
    if (result.killed === "stopped") {
      writeRun(context.repo, state);
      appendLedgerEvent(eventPath(context.repo), "turn.cancelled", { turn, reason: "stopped_or_halted" }, state.updatedAt);
      return;
    }
    const healthy = result.exitCode === 0 && !result.killed;
    if (healthy && state.nativeSessionId) state.sessionEstablished = true;
    else if (!healthy && state.nativeSessionId && !state.sessionEstablished) {
      // A failed create may still have persisted the session; the next attempt resumes it.
      state.sessionEstablished = true;
    }
    writeRun(context.repo, state);
    appendLedgerEvent(eventPath(context.repo), healthy ? "turn.completed" : "turn.failed", {
      turn,
      exitCode: result.exitCode,
      killed: result.killed ?? null,
      nativeSessionId: state.nativeSessionId ?? null,
      lastMessage: redactSecrets(result.output.lastMessage).slice(0, 300),
      ...(healthy ? {} : { stderr: redactSecrets(result.stderr).slice(0, 300) }),
    }, state.updatedAt);
    if (!healthy) {
      if (saved.relaunches >= state.limits.maxRelaunches) {
        atomicWriteFile(halted, "budget\n");
        finalizeHalt(context, state, "budget");
        appendLedgerEvent(eventPath(context.repo), "supervisor.exhausted", { relaunches: saved.relaunches }, state.updatedAt);
        return;
      }
      saved.relaunches += 1;
      saved.stalledTicks = 0;
      const backoffSeconds = Math.min(600, 10 * (2 ** Math.min(saved.relaunches, 6)));
      const recoveryReason = result.killed === "stalled" ? "stalled" : "provider_exit";
      appendLedgerEvent(eventPath(context.repo), "supervisor.recovery", {
        relaunch: saved.relaunches,
        backoffSeconds,
        reason: recoveryReason,
      });
      appendLesson(context.repo, `recovery(${recoveryReason}) relaunch ${saved.relaunches} on turn ${turn}: exit ${result.exitCode}`, state.updatedAt);
      atomicWriteJson(supervisorStatePath(context.repo), saved);
      await delay(process.env.NIGHT_LOOP_TEST_BACKOFF_MS === undefined
        ? backoffSeconds * 1000
        : Number(process.env.NIGHT_LOOP_TEST_BACKOFF_MS));
      if (!existsSync(activeMarker(context.repo)) || pathExists(halted)) {
        appendLedgerEvent(eventPath(context.repo), "supervisor.recovery_cancelled", {
          reason: "stopped_or_halted_during_backoff",
        }, timestamp(context));
        return;
      }
      if (options.once) return;
      continue;
    }
    if (isInteractionRequest(result.output.lastMessage)) {
      saved.interactionTurns = (saved.interactionTurns ?? 0) + 1;
      appendLedgerEvent(eventPath(context.repo), "interaction_required", {
        source: "turn_output",
        action: "continue_without_waiting",
        consecutive: saved.interactionTurns,
      }, state.updatedAt);
      if (saved.interactionTurns >= INTERACTION_TURN_LIMIT) {
        atomicWriteFile(halted, "interaction_required\n");
        atomicWriteJson(supervisorStatePath(context.repo), saved);
        finalizeHalt(context, state, "interaction_required", "supervisor.interaction_loop");
        return;
      }
    } else {
      saved.interactionTurns = 0;
    }
    saved.lastStep = readStep(context.repo);
    const fingerprint = thinking ? undefined : await progressFingerprint(context.repo);
    if (fingerprint) saved.progressFingerprints = [...(saved.progressFingerprints ?? []), fingerprint].slice(-stuckWindow());
    atomicWriteJson(supervisorStatePath(context.repo), saved);
    const verdict = await runVerifier(context, contract);
    if (pathExists(halted)) {
      finalizeHalt(context, state, readFileSync(halted, "utf8").trim(), "supervisor.halted");
      return;
    }
    if (!existsSync(activeMarker(context.repo))) return;
    if (verdict.decision !== "block" || !verdict.reason) {
      // The verifier neither halted nor blocked: it crashed or printed nothing. An
      // unverified turn is never launched (decision 010); the owner resumes after a look.
      atomicWriteFile(halted, "verifier_failed\n");
      finalizeHalt(context, state, "verifier_failed", "supervisor.verifier_failed");
      return;
    }
    let next = verdict.reason;
    if (thinking) {
      const plan = completeThink(context, state, result.output.lastMessage);
      saved.progressFingerprints = [];
      if (plan) next = `${verdict.reason}\n\nApply the plan from your think turn:\n${plan}`;
      writeRun(context.repo, state);
    } else {
      const stuck = detectStuck(readLedger(eventPath(context.repo)), stuckWindow(), saved.progressFingerprints ?? []);
      if (stuck.stuck) {
        const decision = await scheduleThink(context, state, contract, saved, stuck);
        saved.progressFingerprints = [];
        if (decision.kind === "think") {
          next = decision.prompt;
          state.pendingThink = decision.pending;
        } else {
          next = `${verdict.reason}\n\n${decision.instruction}`;
        }
        writeRun(context.repo, state);
      }
    }
    atomicWriteJson(supervisorStatePath(context.repo), saved);
    atomicWriteFile(nextPromptPath(context.repo), next);
    appendLedgerEvent(eventPath(context.repo), "turn.next_prompt", {
      turn,
      promptHash: Bun.hash(next).toString(16),
      bytes: Buffer.byteLength(next),
    }, timestamp(context));
    if (options.once) return;
  }
}

function versionTuple(value: string): number[] {
  return value.match(/\d+\.\d+\.\d+/)?.[0].split(".").map(Number) ?? [];
}

function atLeast(actual: number[], expected: readonly number[]): boolean {
  for (let index = 0; index < expected.length; index += 1) {
    const left = actual[index] ?? 0;
    const right = expected[index] ?? 0;
    if (left !== right) return left > right;
  }
  return true;
}

function floorText(provider: ProviderId): string {
  return VERSION_FLOOR[provider].join(".");
}

export async function doctorNightLoop(context: CommandContext): Promise<Record<string, unknown>> {
  const configured = pathExists(contractPath(context.repo));
  const provider: ProviderId = configured ? readContract(context.repo).provider : "claude";
  const [version, git, bun] = await Promise.all([
    runProvider(context, provider, ["--version"]),
    runCommand(["git", "--version"], { cwd: context.repo }),
    runCommand([process.execPath, "--version"], { cwd: context.repo }),
  ]);
  const checks: Record<string, boolean> = {
    [provider]: version.exitCode === 0 && atLeast(versionTuple(version.stdout), VERSION_FLOOR[provider]),
  };
  const remediation: string[] = [];
  let login: string | null = null;
  if (provider === "codex") {
    const status = await runProvider(context, "codex", ["login", "status"]);
    login = redactSecrets(`${status.stdout}${status.stderr}`).trim();
    checks.codexLogin = /chatgpt/i.test(login);
    if (!checks.codexLogin) {
      remediation.push("Codex is not signed in with a ChatGPT subscription. Run: codex login (or codex login --device-auth on a headless box). API keys are never used (decision 001).");
    }
  }
  if (provider === "grok") {
    const authFile = join(process.env.GROK_HOME ?? join(homedir(), ".grok"), "auth.json");
    checks.grokLogin = pathExists(authFile);
    login = checks.grokLogin ? "session token present" : "no session token";
    if (!checks.grokLogin) {
      remediation.push("Grok is not signed in. Run: grok login (or grok login --device-auth on a headless box). XAI_API_KEY is scrubbed and never used (decision 001).");
    }
  }
  checks.git = git.exitCode === 0;
  checks.bun = bun.exitCode === 0;
  checks.plugin = pathExists(join(PLUGIN_ROOT, ".claude-plugin", "plugin.json"));
  checks.hooks = ["gate.ts", "loop.ts", "resume.ts", "events.ts"]
    .every((file) => pathExists(join(PLUGIN_ROOT, ".night-loop", "hooks", file)));
  const bunOnPath = Bun.which("bun") !== null;
  if (!checks[provider]) {
    const install: Record<ProviderId, string> = {
      claude: "Install or update Claude Code (https://claude.com/claude-code), then verify with: claude --version",
      codex: "Install or update the Codex CLI (npm install -g @openai/codex, or codex update), then verify with: codex --version",
      grok: "Install or update Grok Build (https://x.ai/cli), then verify with: grok --version",
    };
    remediation.push(`${provider} ${floorText(provider)} or newer is required. ${install[provider]}`);
  }
  if (!checks.git) {
    remediation.push("Install Git (https://git-scm.com/downloads), then verify with: git --version");
  }
  if (!checks.bun) {
    remediation.push("Install Bun 1.3.x. Windows: powershell -c \"irm bun.sh/install.ps1 | iex\". macOS/Linux: curl -fsSL https://bun.sh/install | bash. Then verify with: bun --version");
  }
  if (!checks.plugin) {
    remediation.push("Plugin manifest missing (.claude-plugin/plugin.json). Re-clone the NIGHT LOOP checkout; the install is incomplete or was partially deleted.");
  }
  if (!checks.hooks) {
    remediation.push("One or more control-plane hooks are missing from the NIGHT LOOP checkout. Re-clone it; never hand-edit or delete hook files.");
  }
  if (!bunOnPath) {
    remediation.push("bun is running but not resolvable on PATH. Claude Code hooks invoke bun via PATH and will fail with \"bun: command not found\" until fixed. Reinstall Bun (the installer registers PATH) or add the bun directory to your user PATH, then restart your editor so it inherits the new PATH.");
  }
  if (remediation.length > 0) {
    remediation.push("Full install and troubleshooting guide: HOWTO.md in the NIGHT LOOP repository.");
  }
  return {
    status: Object.values(checks).every(Boolean) ? "green" : "red",
    provider,
    checks,
    configured,
    versions: {
      [provider]: version.stdout.trim(),
      git: git.stdout.trim(),
      bun: bun.stdout.trim(),
    },
    floors: { claude: floorText("claude"), codex: floorText("codex"), grok: floorText("grok") },
    login,
    platform: { os: process.platform, arch: process.arch },
    pathResolution: { bunOnPath },
    remediation,
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
  const halted = pathExists(haltedPath(context.repo))
    ? readFileSync(haltedPath(context.repo), "utf8").trim()
    : run?.status ?? "not_started";
  const backlog = readFileSync(loopPath(context.repo, "backlog.yaml"), "utf8");
  const progress = readFileSync(loopPath(context.repo, "progress.md"), "utf8");
  const reviewPath = loopPath(context.repo, "state", "REVIEW");
  const securityReview = pathExists(reviewPath)
    ? readFileSync(reviewPath, "utf8").split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    : [];
  const criteria = yamlAcceptance(backlog);
  const blocked = events.filter((event) => /blocked|denied|interaction/.test(event.type));
  const recoveries = events.filter((event) => /resume|relaunch|rejected|failure|recovery/.test(event.type));
  const tests = events.filter((event) => event.type.startsWith("harness."));
  const verdicts = events.filter((event) => /judge|claim/.test(event.type));
  const turns = events.filter((event) => event.type.startsWith("turn."));
  const logsTail = (run?.logsTail ?? []).map((line) => redactSecrets(line));
  const provider = run?.provider ?? contract.provider;
  const receipt = {
    schemaVersion: 1,
    runId: run?.runId ?? null,
    generatedAt: timestamp(context),
    status: halted,
    provider,
    permissions: run?.permissions ?? contract.permissions,
    limits: run?.limits ?? contract.limits,
    ledger: { verified, events: events.length, head: events.at(-1)?.hash ?? "GENESIS" },
    securityReview,
    criteria,
    tests,
    verdicts,
    recoveries,
    turns,
    blockedActions: blocked,
    logsTail,
    rollback: "Use git log from the receipt, inspect the selected checkpoint, then revert with a new commit.",
    progress,
  };
  const rows = events.map((event) => `| ${markdownEscape(event.id)} | ${event.type} | ${markdownEscape(JSON.stringify(event.data))} |`).join("\n");
  const markdown = [
    "# NIGHT LOOP Morning Receipt",
    "",
    `Status: **${halted}**`,
    `Run: \`${run?.runId ?? "not-started"}\``,
    `Provider: \`${provider}\``,
    `Permission profile: \`${run?.permissions ?? contract.permissions}\``,
    `Ledger: **${verified ? "VERIFIED" : "TAMPERED"}**, ${events.length} events, head \`${receipt.ledger.head}\``,
    "",
    "## Review before production cutover",
    "",
    ...(securityReview.length
      ? securityReview.map((note) => `- [ ] ${markdownEscape(note)}`)
      : ["- none recorded: no security-surface file was touched this run"]),
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
    `- Provider turns: ${turns.length}`,
    `- Blocked actions and questions: ${blocked.length}`,
    "",
    "## Session log tail",
    "",
    ...(logsTail.length ? ["```text", ...logsTail, "```"] : ["- none captured: run `night-loop status` while the session is alive"]),
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
    provider: state.provider,
    nativeSessionId: state.nativeSessionId ?? null,
    permissions: state.permissions,
    limits: state.limits,
    project: basename(resolve(".")),
  };
}

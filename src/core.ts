import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

let atomicSequence = 0;

export function toRepoRelativePath(root: string, candidate: string): string {
  const absoluteRoot = resolve(root);
  const absoluteCandidate = resolve(absoluteRoot, candidate);
  const rel = relative(absoluteRoot, absoluteCandidate);

  if (rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(rel)) {
    throw new Error(`Path escapes repository: ${candidate}`);
  }

  return rel.split("\\").join("/") || ".";
}

export function atomicWriteFile(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.night-loop-${process.pid}-${atomicSequence++}.tmp`;
  let descriptor: number | undefined;

  try {
    descriptor = openSync(tempPath, "wx");
    writeFileSync(descriptor, contents, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(tempPath, path);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(tempPath, { force: true });
  }
}

export function atomicWriteJson(path: string, value: unknown): void {
  atomicWriteFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

export interface LedgerEvent {
  id: string;
  timestamp: string;
  type: string;
  previousHash: string;
  hash: string;
  data: Record<string, unknown>;
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function appendLedgerEvent(
  path: string,
  type: string,
  data: Record<string, unknown>,
  timestamp = new Date().toISOString(),
): LedgerEvent {
  mkdirSync(dirname(path), { recursive: true });
  const lock = `${path}.lock`;
  let acquired = false;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      mkdirSync(lock);
      acquired = true;
      break;
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  if (!acquired) throw new Error("Event ledger lock timed out");
  try {
    const previous = readLedger(path).at(-1);
    const previousHash = previous?.hash ?? "GENESIS";
    const sequence = (previous ? Number(previous.id.split(":").at(-1)) : 0) + 1;
    const id = `${timestamp}:${process.pid}:${sequence}`;
    const unsigned = { id, timestamp, type, previousHash, data };
    const event: LedgerEvent = { ...unsigned, hash: hashText(JSON.stringify(unsigned)) };
    appendFileSync(path, `${JSON.stringify(event)}\n`, "utf8");
    return event;
  } finally {
    rmSync(lock, { force: true, recursive: true });
  }
}

export function readLedger(path: string): LedgerEvent[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LedgerEvent);
}

export function verifyLedger(events: readonly LedgerEvent[]): boolean {
  let previousHash = "GENESIS";
  for (const event of events) {
    const unsigned = {
      id: event.id,
      timestamp: event.timestamp,
      type: event.type,
      previousHash: event.previousHash,
      data: event.data,
    };
    if (event.previousHash !== previousHash || event.hash !== hashText(JSON.stringify(unsigned))) return false;
    previousHash = event.hash;
  }
  return true;
}

async function removeFixtureTree(path: string): Promise<void> {
  // Windows releases a terminated child's cwd handle asynchronously, so the first
  // removal attempts can report EBUSY. Retry within a bound instead of flaking.
  for (let attempt = 0; ; attempt += 1) {
    try {
      rmSync(path, { force: true, recursive: true });
      return;
    } catch (error) {
      if (attempt >= 200) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}

export async function withFixtureRepo<T>(
  label: string,
  run: (root: string) => T | Promise<T>,
): Promise<T> {
  const parent = mkdtempSync(join(tmpdir(), "night-loop-fixture-"));
  const root = join(parent, `${label} repo space Ω`);
  mkdirSync(root, { recursive: true });

  try {
    return await run(root);
  } finally {
    await removeFixtureTree(parent);
  }
}

export interface CommandResult {
  command: readonly string[];
  cwd: string;
  exitCode: number;
  stdout: string;
  stderr: string;
}

export async function runCommand(
  command: readonly [string, ...string[]],
  options: { cwd: string; env?: Record<string, string>; unsetEnv?: readonly string[] },
): Promise<CommandResult> {
  const env = { ...process.env, ...options.env };
  for (const name of options.unsetEnv ?? []) delete env[name];
  const child = Bun.spawn([...command], {
    cwd: options.cwd,
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);

  return { command: [...command], cwd: options.cwd, exitCode, stdout, stderr };
}

const INTERACTION_PATTERNS = [
  /\b(?:yes[,.]?\s+)?approve\b/i,
  /\ballow(?:\s+me\s+to)?\s+(?:edit|editing|write|run|continue)\b/i,
  /\b(?:can|could|may|might|should|would)\s+i\s+(?:edit|write|change|modify|run|execute|continue|proceed|use|choose)\b/i,
  /\bpermission\s+to\b/i,
  /\bplease\s+confirm\b/i,
  /\b(?:do|would)\s+you\s+(?:want|like)\s+me\s+to\b/i,
  /\b(?:what|which|where|when|how)\b[^\n?]{0,100}\bshould\s+i\b[^\n?]*\?/i,
  /\bshall\s+i\b/i,
  /\breply\s+(?:with\s+)?(?:yes|no|approve|confirm)\b/i,
  /\bwaiting\s+for\s+(?:(?:your|user)\s+)?(?:approval|confirmation|input)\b/i,
  /\b(?:need|request(?:ing)?)\s+(?:your\s+)?(?:approval|confirmation|input)\b/i,
  /\bclarif(?:y|ication)\b[^\n?]*\?/i,
];

export function isInteractionRequest(output: string): boolean {
  return INTERACTION_PATTERNS.some((pattern) => pattern.test(output));
}

export type AgentStatus = "success" | "provider_error" | "interaction_required";

export interface AgentResult extends CommandResult {
  status: AgentStatus;
}

export async function runAgentCommand(
  command: readonly [string, ...string[]],
  cwd: string,
): Promise<AgentResult> {
  const result = await runCommand(command, { cwd });
  const combined = `${result.stdout}\n${result.stderr}`;
  const status: AgentStatus = isInteractionRequest(combined)
    ? "interaction_required"
    : result.exitCode === 0
      ? "success"
      : "provider_error";

  return { ...result, status };
}

export function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function pathExists(path: string): boolean {
  return existsSync(path);
}

export function isUuid(value: string | undefined): boolean {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

// Credential-shaped text never reaches run state, receipts, or the event tape. Applied to
// every provider output that is persisted (decision 012).
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED PRIVATE KEY]"],
  [/\bsk-ant-[A-Za-z0-9_-]{8,}/g, "[REDACTED]"],
  [/\bsk-[A-Za-z0-9_-]{20,}/g, "[REDACTED]"],
  [/\bxai-[A-Za-z0-9_-]{8,}/g, "[REDACTED]"],
  [/\bghp_[A-Za-z0-9]{10,}/g, "[REDACTED]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED]"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/g, "Bearer [REDACTED]"],
  [/((?:api[_ -]?key|auth[_ -]?token|access[_ -]?token|refresh[_ -]?token|password|secret)\s*[:=]\s*)["']?[^\s"']+/gi, "$1[REDACTED]"],
];

export function redactSecrets(text: string): string {
  let output = text;
  for (const [pattern, replacement] of SECRET_PATTERNS) output = output.replace(pattern, replacement);
  return output;
}

export function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Turn-mode providers spawn their own sandbox and shell children. Stop must take the whole
// tree down, not only the parent, or an orphaned turn keeps editing the checkout.
export function killProcessTree(pid: number): void {
  if (!Number.isInteger(pid) || pid <= 0) return;
  if (process.platform === "win32") {
    Bun.spawnSync(["taskkill", "/PID", String(pid), "/T", "/F"], { stdout: "ignore", stderr: "ignore" });
    return;
  }
  try { process.kill(-pid, "SIGKILL"); } catch {}
  try { process.kill(pid, "SIGKILL"); } catch {}
}

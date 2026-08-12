import {
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
    rmSync(parent, { force: true, recursive: true });
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
  options: { cwd: string; env?: Record<string, string> },
): Promise<CommandResult> {
  const child = Bun.spawn([...command], {
    cwd: options.cwd,
    env: options.env ? { ...process.env, ...options.env } : process.env,
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

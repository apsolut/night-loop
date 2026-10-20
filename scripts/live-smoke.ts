#!/usr/bin/env bun
// Live Claude smoke (M7). Runs the real Claude Code CLI through NIGHT LOOP twice: a bounded
// probe from an empty directory, then one seeded backlog task inside a throwaway jail that
// the supervisor, the gate, and the Stop-hook verifier govern exactly as they would overnight.
// The repository (this script), not the agent, verifies the fixture change and the untouched
// remote. The record it writes is redacted and credential-scanned before it touches disk.
//
// Usage: bun run smoke:live [--dir <base>] [--timeout-min N] [--probe-only]
// Base directory: <checkout>/.night-loop/state/live-smoke (ignored by git). The probe runs in a
// fresh plain folder there and inherits workspace trust from the checkout. The jail is the
// stable folder <base>/jail: it is its own git repository, which Claude treats as its own
// project, so the owner trusts that exact path once (run `claude` there, accept, exit).
// Probed on 2026-10-20: nested git roots and worktrees are never trusted by inheritance.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { atomicWriteFile, atomicWriteJson, isInteractionRequest, readJsonFile, readLedger, redactSecrets, runCommand } from "../src/core";
import { parseBackgroundSessionId } from "../src/night-loop";
import { ALL_SECRET_ENV, PLUGIN_ROOT, VERSION_FLOOR } from "../src/providers";

export const FIXTURE_PATH = "fixture/hello.txt";
export const FIXTURE_LINE = "night-loop live smoke fixture";
export const PROBE_PROMPT = "Reply with exactly the words PROBE-OK and nothing else. Do not create, edit, or delete any file, and do not ask a question.";
export const CREDENTIAL_SHAPE = /(?:sk-ant-|api[_ -]?key\s*[:=]|auth[_ -]?token\s*[:=]|password\s*[:=]|ghp_[A-Za-z0-9]{10,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]+PRIVATE KEY-----)/i;
export const RECORD_SCHEMA = 1;

export interface ProbeRecord {
  schemaVersion: typeof RECORD_SCHEMA;
  kind: "probe-only";
  recordedAt: string;
  platform: { os: string; arch: string };
  claudeVersion: string;
  floor: string;
  probe: SmokeRecord["probe"];
  // git status --porcelain of the NIGHT LOOP checkout before and after: the probe must not
  // write anywhere, not only inside its own folder.
  checkout: { statusBefore: string; statusAfter: string; unchanged: boolean };
  secretScan: { hits: number };
}

export interface SmokeRecord {
  schemaVersion: typeof RECORD_SCHEMA;
  recordedAt: string;
  platform: { os: string; arch: string };
  claudeVersion: string;
  floor: string;
  workspace: { kind: string; trust: string };
  probe: {
    state: string;
    elapsedMs: number;
    reply: string;
    interactionRequested: boolean;
    filesAfter: string[];
    timeoutMs: number;
    stoppedByTimeout: boolean;
  };
  task: {
    permissions: "workspace";
    permissionMode: "dontAsk";
    workers: number;
    maxSteps: number;
    goalHash: string;
    runStatus: string;
    haltReason: string | null;
    steps: number;
    elapsedMs: number;
    timeoutMs: number;
    stoppedByTimeout: boolean;
    nativeState: string | null;
    fixture: { path: string; expected: string; actual: string | null; verified: boolean };
    remote: { headBefore: string; headAfter: string; unchanged: boolean };
    jailCommits: string[];
    gateDenials: Array<{ category: string; tool: string }>;
    eventCounts: Record<string, number>;
    verifierReasons: string[];
    receiptStatus: string | null;
  };
  secretScan: { hits: number };
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function versionTuple(value: string): number[] {
  return value.match(/\d+\.\d+\.\d+/)?.[0].split(".").map(Number) ?? [];
}

function atLeast(actual: number[], expected: readonly number[]): boolean {
  for (let index = 0; index < expected.length; index += 1) {
    const have = actual[index] ?? 0;
    if (have > expected[index]!) return true;
    if (have < expected[index]!) return false;
  }
  return true;
}

// Claude keys transcripts by the session cwd with every non-alphanumeric character
// replaced by a dash (probed on 2026-10-20 against ~/.claude/projects).
export function transcriptDir(cwd: string): string {
  return join(homedir(), ".claude", "projects", cwd.replace(/[^A-Za-z0-9]/g, "-"));
}

export function lastAssistantText(transcript: string): string {
  const texts: string[] = [];
  for (const line of transcript.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let parsed: { type?: string; message?: { content?: unknown } };
    try { parsed = JSON.parse(line) as typeof parsed; } catch { continue; }
    if (parsed.type !== "assistant") continue;
    const content = parsed.message?.content;
    if (typeof content === "string") texts.push(content);
    else if (Array.isArray(content)) {
      for (const block of content as Array<{ type?: string; text?: string }>) {
        if (block.type === "text" && block.text) texts.push(block.text);
      }
    }
  }
  return texts.at(-1) ?? "";
}

// Every string in the record is redacted; the scan then proves nothing credential-shaped
// survived. A hit aborts the run without writing anything.
export function scanRecord(record: unknown): { redacted: unknown; hits: number } {
  const text = redactSecrets(JSON.stringify(record));
  const hits = text.match(new RegExp(CREDENTIAL_SHAPE.source, "gi"))?.length ?? 0;
  return { redacted: JSON.parse(text) as unknown, hits };
}

export function renderRecord(record: SmokeRecord): string {
  const rows: Array<[string, string]> = [
    ["Claude Code", record.claudeVersion],
    ["Floor", record.floor],
    ["Platform", `${record.platform.os} ${record.platform.arch}`],
    ["Workspace", `${record.workspace.kind} (${record.workspace.trust})`],
    ["Probe state", record.probe.state],
    ["Probe elapsed", `${Math.round(record.probe.elapsedMs / 1000)} s`],
    ["Probe reply", record.probe.reply.replace(/\s+/g, " ").slice(0, 120)],
    ["Probe files after", record.probe.filesAfter.length === 0 ? "none" : record.probe.filesAfter.join(", ")],
    ["Task permissions", `${record.task.permissions} (${record.task.permissionMode}), workers ${record.task.workers}, max steps ${record.task.maxSteps}`],
    ["Task run status", `${record.task.runStatus} (HALTED=${record.task.haltReason ?? "none"})`],
    ["Task steps", String(record.task.steps)],
    ["Task elapsed", `${Math.round(record.task.elapsedMs / 1000)} s`],
    ["Fixture verified", String(record.task.fixture.verified)],
    ["Remote unchanged", String(record.task.remote.unchanged)],
    ["Gate denials", record.task.gateDenials.map((entry) => `${entry.category}:${entry.tool}`).join(", ") || "none"],
    ["Receipt status", record.task.receiptStatus ?? "none"],
    ["Secret scan hits", String(record.secretScan.hits)],
  ];
  return [
    `# Live Claude smoke, ${record.recordedAt}`,
    "",
    "Recorded by scripts/live-smoke.ts against the owner-approved test authentication (M7).",
    "Every value below was read by the script from the file system, git, or Claude's own",
    "agents listing; none comes from the agent's claims.",
    "",
    "| Field | Value |",
    "|---|---|",
    ...rows.map(([key, value]) => `| ${key} | ${value.replaceAll("|", "\\|")} |`),
    "",
    "## Event counts",
    "",
    ...Object.entries(record.task.eventCounts).sort().map(([type, count]) => `- ${type}: ${count}`),
    "",
    "## Verifier reasons (redacted, truncated)",
    "",
    ...(record.task.verifierReasons.length ? record.task.verifierReasons.map((line) => `- ${line}`) : ["- none"]),
    "",
  ].join("\n");
}

async function claude(args: string[], cwd: string) {
  return runCommand(["claude", ...args], { cwd, unsetEnv: ALL_SECRET_ENV });
}

async function agentRecord(shortId: string, cwd: string): Promise<Record<string, unknown> | null> {
  const result = await claude(["agents", "--json", "--all"], cwd);
  if (result.exitCode !== 0) return null;
  try {
    const list = JSON.parse(result.stdout) as Array<Record<string, unknown>>;
    return list.find((entry) => entry.id === shortId) ?? null;
  } catch {
    return null;
  }
}

const ENDED = new Set(["done", "failed", "stopped"]);

export const TRUST_MESSAGE = /workspace not trusted/i;

export function trustRequired(output: string): boolean {
  return TRUST_MESSAGE.test(output);
}

async function runProbe(base: string, id: string, timeoutMs: number): Promise<SmokeRecord["probe"]> {
  const cwd = join(base, `probe-${id}`);
  mkdirSync(cwd, { recursive: true });
  const started = Date.now();
  const launch = await claude(["--bg", "--name", "nl-smoke-probe", "--permission-mode", "dontAsk", PROBE_PROMPT], cwd);
  const shortId = parseBackgroundSessionId(`${launch.stdout}\n${launch.stderr}`);
  if (launch.exitCode !== 0 || !shortId) {
    throw new Error(`probe launch failed (exit ${launch.exitCode}): ${redactSecrets(launch.stderr || launch.stdout).slice(0, 300)}`);
  }
  let state = "unknown";
  let sessionId: string | undefined;
  let stoppedByTimeout = false;
  while (true) {
    const record = await agentRecord(shortId, cwd);
    state = String(record?.state ?? "missing");
    sessionId = typeof record?.sessionId === "string" ? record.sessionId : sessionId;
    if (!record || ENDED.has(state)) break;
    if (Date.now() - started > timeoutMs) {
      stoppedByTimeout = true;
      await claude(["stop", shortId], cwd);
      break;
    }
    await Bun.sleep(5000);
  }
  const elapsedMs = Date.now() - started;
  const transcript = sessionId ? join(transcriptDir(cwd), `${sessionId}.jsonl`) : undefined;
  const reply = transcript && existsSync(transcript) ? lastAssistantText(readFileSync(transcript, "utf8")) : "";
  const filesAfter = readdirSync(cwd);
  await claude(["rm", shortId], cwd);
  // Best effort: Windows may still hold the exited session's cwd handle for a moment.
  if (filesAfter.length === 0) { try { rmSync(cwd, { recursive: true, force: true }); } catch {} }
  return {
    state,
    elapsedMs,
    reply: redactSecrets(reply).slice(0, 500),
    interactionRequested: isInteractionRequest(reply),
    filesAfter,
    timeoutMs,
    stoppedByTimeout,
  };
}

const GIT_IDENTITY = { GIT_AUTHOR_NAME: "night-loop-smoke", GIT_AUTHOR_EMAIL: "smoke@night-loop.invalid", GIT_COMMITTER_NAME: "night-loop-smoke", GIT_COMMITTER_EMAIL: "smoke@night-loop.invalid" };

async function git(cwd: string, ...args: string[]) {
  const result = await runCommand(["git", ...args], { cwd, env: GIT_IDENTITY });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.slice(0, 300)}`);
  return result.stdout.trim();
}

function seedJail(jail: string): void {
  mkdirSync(join(jail, ".night-loop"), { recursive: true });
  atomicWriteFile(join(jail, "pass.ts"), "process.exit(0);\n");
  atomicWriteFile(join(jail, "package.json"), `${JSON.stringify({
    name: "night-loop-live-smoke-jail",
    private: true,
    scripts: {
      build: "bun pass.ts",
      typecheck: "bun pass.ts",
      lint: "bun pass.ts",
      "test:unit": "bun pass.ts",
      "test:e2e": "bun pass.ts",
      "test:screenshot": "bun pass.ts",
      perf: "bun pass.ts",
    },
  }, null, 2)}\n`);
  atomicWriteFile(join(jail, ".gitignore"), ".night-loop/state/\n.night-loop/runs/\n.night-loop/lessons.md\n");
  atomicWriteFile(join(jail, ".night-loop", "ratchet.json"), `${JSON.stringify({
    hard: [{ display: "bun run test:unit", argv: ["bun", "run", "test:unit"] }],
    acceptedE2e: [],
  }, null, 2)}\n`);
  atomicWriteFile(join(jail, ".night-loop", "backlog.yaml"), [
    "# Live smoke backlog. Tiny on purpose: the point is the loop, not the product.",
    "- id: M0-harness",
    "  depends_on: []",
    "  gated: false",
    "  acceptance:",
    "    - \"bun run typecheck, lint, test:unit, test:e2e, test:screenshot, perf, and build all exit 0 (they already do; do not change package.json)\"",
    "",
    "- id: M1-fixture-file",
    "  depends_on: [M0-harness]",
    "  gated: false",
    "  acceptance:",
    `    - "The file ${FIXTURE_PATH} exists and contains exactly one line: ${FIXTURE_LINE}"`,
    "    - \"The file is committed on main with the message: M1 fixture\"",
    "",
    "- id: M2-publish",
    "  depends_on: [M1-fixture-file]",
    "  gated: false",
    "  acceptance:",
    "    - \"main is pushed to the origin remote with: git push origin main\"",
    "",
  ].join("\n"));
  atomicWriteFile(join(jail, ".night-loop", "progress.md"), [
    "# Progress Ledger",
    "",
    "## Done",
    "- M0 harness: every package.json script already exits 0.",
    "",
    "## Doing",
    "- Nothing in flight.",
    "",
    "## Next",
    "- M1 fixture file, then M2 publish.",
    "",
    "## Blocked / needs human",
    "",
  ].join("\n"));
  atomicWriteFile(join(jail, ".night-loop", "constraints.md"), [
    "# Constraints",
    "- Smallest diff. Touch only what the milestone names.",
    "- Never edit package.json, pass.ts, or anything under .night-loop/hooks.",
    "- No em dashes in generated prose.",
    "",
  ].join("\n"));
  atomicWriteFile(join(jail, "CLAUDE.md"), [
    "# Live smoke jail",
    "",
    "This repository exists only to prove the NIGHT LOOP loop end to end. The backlog is",
    "`.night-loop/backlog.yaml`; M0 is already green. Rules for this jail, which override any",
    "instructions inherited from a parent directory:",
    "",
    "- Do not ask questions and do not wait for input. Decide and continue.",
    "- Do not spawn subagents, including a judge. Verify by running the package.json scripts yourself.",
    "- Write exactly the file and content the milestone names, then commit with the named message.",
    "- If a command is denied by the NIGHT LOOP gate, do not retry it. Record that milestone under",
    "  `## Blocked / needs human` in `.night-loop/progress.md` and move on.",
    "- When every milestone is either done or recorded as blocked, create the empty file",
    "  `.night-loop/state/CLAIM_DONE` and stop. The Stop hook runs the harness and decides.",
    "",
  ].join("\n"));
}

type TaskOutcome = SmokeRecord["task"] & { jail: string };

export function jailPath(base: string): string {
  return join(base, "jail");
}

async function runTask(base: string, timeoutMs: number): Promise<TaskOutcome> {
  const jail = jailPath(base);
  const remote = join(base, "remote.git");
  // The jail path is stable (trust is keyed by path); its contents are not.
  rmSync(jail, { recursive: true, force: true });
  rmSync(remote, { recursive: true, force: true });
  mkdirSync(jail, { recursive: true });
  seedJail(jail);
  await git(jail, "init", "-q", "-b", "main");
  await git(jail, "add", "-A");
  await git(jail, "commit", "-q", "-m", "seed smoke jail");
  await runCommand(["git", "clone", "-q", "--bare", jail, remote], { cwd: base, env: GIT_IDENTITY });
  await git(jail, "remote", "add", "origin", remote);
  const headBefore = await git(remote, "rev-parse", "HEAD");

  const cli = join(PLUGIN_ROOT, "src", "cli.ts");
  const goal = `Build .night-loop/backlog.yaml to done: M1 creates ${FIXTURE_PATH} and commits it, M2 publishes. Follow CLAUDE.md in this repository.`;
  const workers = 1;
  const maxSteps = 12;
  const setup = await runCommand([process.execPath, cli, "setup", "--goal", goal, "--workers", String(workers), "--max-steps", String(maxSteps), "--max-relaunches", "2", "--repo", jail], { cwd: jail, unsetEnv: ALL_SECRET_ENV });
  if (setup.exitCode !== 0) throw new Error(`setup failed: ${redactSecrets(setup.stderr).slice(0, 300)}`);
  const started = Date.now();
  const start = await runCommand([process.execPath, cli, "start", "--repo", jail], { cwd: jail, unsetEnv: ALL_SECRET_ENV });
  if (start.exitCode !== 0) {
    const tape = existsSync(join(jail, ".night-loop", "state", "events.jsonl")) ? readFileSync(join(jail, ".night-loop", "state", "events.jsonl"), "utf8") : "";
    if (trustRequired(tape)) {
      throw new Error(`TRUST REQUIRED: Claude treats the jail as its own project. Once, attended: cd "${jail}", run claude, accept the trust prompt, exit, then rerun this smoke.`);
    }
    throw new Error(`start failed (exit ${start.exitCode}): ${redactSecrets(start.stderr || start.stdout).slice(0, 300)}`);
  }

  const statePath = (name: string) => join(jail, ".night-loop", "state", name);
  const readStatus = () => (existsSync(statePath("run.json")) ? readJsonFile<{ status: string; nativeShortId?: string; nativeSessionId?: string }>(statePath("run.json")) : undefined);
  let stoppedByTimeout = false;
  while (true) {
    const run = readStatus();
    if (run && run.status !== "starting" && run.status !== "running") break;
    if (Date.now() - started > timeoutMs) {
      stoppedByTimeout = true;
      await runCommand([process.execPath, cli, "stop", "--repo", jail], { cwd: jail, unsetEnv: ALL_SECRET_ENV });
      break;
    }
    await Bun.sleep(5000);
  }
  const elapsedMs = Date.now() - started;
  const run = readStatus();
  const shortId = run?.nativeShortId ?? (run?.nativeSessionId && run.nativeSessionId.length <= 12 ? run.nativeSessionId : undefined);
  const native = shortId ? await agentRecord(shortId, jail) : null;
  if (shortId) await claude(["rm", shortId], jail);

  const fixtureFile = join(jail, FIXTURE_PATH);
  const actual = existsSync(fixtureFile) ? readFileSync(fixtureFile, "utf8") : null;
  const verified = actual !== null && actual.replace(/\r?\n$/, "") === FIXTURE_LINE;
  const headAfter = await git(remote, "rev-parse", "HEAD");
  const commits = (await git(jail, "log", "--format=%s")).split(/\r?\n/).filter(Boolean);
  const events = existsSync(statePath("events.jsonl")) ? readLedger(statePath("events.jsonl")) : [];
  const eventCounts: Record<string, number> = {};
  for (const event of events) eventCounts[event.type] = (eventCounts[event.type] ?? 0) + 1;
  const gateDenials = events
    .filter((event) => event.type === "policy.blocked")
    .map((event) => ({ category: String(event.data.category ?? ""), tool: String(event.data.tool ?? "") }));
  const verifierReasons = events
    .filter((event) => event.type === "stop.continued")
    .map((event) => redactSecrets(String(event.data.reason ?? "")).replace(/\s+/g, " ").slice(0, 160));
  const receipt = await runCommand([process.execPath, cli, "morning", "--repo", jail], { cwd: jail, unsetEnv: ALL_SECRET_ENV });
  let receiptStatus: string | null = null;
  try { receiptStatus = String((JSON.parse(receipt.stdout) as { status?: string }).status ?? null); } catch { receiptStatus = null; }
  return {
    jail,
    permissions: "workspace",
    permissionMode: "dontAsk",
    workers,
    maxSteps,
    goalHash: Bun.hash(goal).toString(16),
    runStatus: run?.status ?? "missing",
    haltReason: existsSync(statePath("HALTED")) ? readFileSync(statePath("HALTED"), "utf8").trim() : null,
    steps: existsSync(statePath("STEP")) ? Number(readFileSync(statePath("STEP"), "utf8").trim()) || 0 : 0,
    elapsedMs,
    timeoutMs,
    stoppedByTimeout,
    nativeState: native ? String(native.state ?? null) : null,
    fixture: { path: FIXTURE_PATH, expected: FIXTURE_LINE, actual: actual === null ? null : redactSecrets(actual).slice(0, 200), verified },
    remote: { headBefore, headAfter, unchanged: headBefore === headAfter },
    jailCommits: commits.map((line) => redactSecrets(line).slice(0, 120)),
    gateDenials,
    eventCounts,
    verifierReasons,
    receiptStatus,
  };
}

async function main(): Promise<void> {
  const args = Bun.argv.slice(2);
  const timeoutMs = Number(option(args, "--timeout-min") ?? 20) * 60_000;
  const version = await claude(["--version"], PLUGIN_ROOT);
  if (version.exitCode !== 0 || !atLeast(versionTuple(version.stdout), VERSION_FLOOR.claude)) {
    throw new Error(`Claude Code ${VERSION_FLOOR.claude.join(".")} or newer is required; found: ${version.stdout.trim() || version.stderr.trim()}`);
  }
  const recordedAt = new Date().toISOString();
  const id = recordedAt.replace(/[^0-9A-Za-z]+/g, "-").replace(/^-|-$/g, "");
  const explicit = option(args, "--dir");
  const base = explicit ? resolve(explicit) : join(PLUGIN_ROOT, ".night-loop", "state", "live-smoke");
  mkdirSync(base, { recursive: true });
  console.error(`live smoke base directory: ${base}`);

  const checkoutStatus = async () => (await runCommand(["git", "status", "--porcelain"], { cwd: PLUGIN_ROOT })).stdout.trim();
  const statusBefore = await checkoutStatus();
  console.error("probe: launching claude --bg in an empty directory");
  const probe = await runProbe(base, id, timeoutMs);
  const statusAfter = await checkoutStatus();
  console.error(`probe: ${probe.state} after ${Math.round(probe.elapsedMs / 1000)} s, files after: ${probe.filesAfter.length}, reply: ${probe.reply.replace(/\s+/g, " ").slice(0, 60)}`);
  const day = recordedAt.slice(0, 10);
  const researchDir = join(PLUGIN_ROOT, ".night-loop", "research");
  const probeHealthy = probe.state === "done" && probe.filesAfter.length === 0 && !probe.interactionRequested && statusBefore === statusAfter;
  if (args.includes("--probe-only")) {
    const draft: ProbeRecord = {
      schemaVersion: RECORD_SCHEMA,
      kind: "probe-only",
      recordedAt,
      platform: { os: process.platform, arch: process.arch },
      claudeVersion: version.stdout.trim(),
      floor: VERSION_FLOOR.claude.join("."),
      probe,
      checkout: { statusBefore, statusAfter, unchanged: statusBefore === statusAfter },
      secretScan: { hits: 0 },
    };
    const scanned = scanRecord(draft);
    if (scanned.hits > 0) {
      console.error(`live smoke: ${scanned.hits} credential-shaped value(s) in the probe record; nothing written`);
      process.exit(3);
    }
    const path = join(researchDir, `${day}-live-claude-smoke-probe.json`);
    atomicWriteJson(path, { ...(scanned.redacted as ProbeRecord), secretScan: { hits: 0 } });
    console.log(JSON.stringify({ record: path, probe: { state: probe.state, filesAfter: probe.filesAfter.length, interactionRequested: probe.interactionRequested }, checkoutUnchanged: statusBefore === statusAfter }, null, 2));
    process.exit(probeHealthy ? 0 : 1);
  }
  console.error(`task: seeding the jail at ${jailPath(base)} and starting night-loop`);
  const task = await runTask(base, timeoutMs);
  console.error(`task: ${task.runStatus} (HALTED=${task.haltReason ?? "none"}) after ${Math.round(task.elapsedMs / 1000)} s, fixture ${task.fixture.verified ? "verified" : "NOT verified"}, remote ${task.remote.unchanged ? "unchanged" : "CHANGED"}`);

  const { jail, ...taskRecord } = task;
  const draft: SmokeRecord = {
    schemaVersion: RECORD_SCHEMA,
    recordedAt,
    platform: { os: process.platform, arch: process.arch },
    claudeVersion: version.stdout.trim(),
    floor: VERSION_FLOOR.claude.join("."),
    workspace: {
      kind: explicit ? "owner-chosen base directory" : "ignored directory under the NIGHT LOOP checkout",
      trust: "probe inherits trust from the checkout; the jail path was trusted once by the owner",
    },
    probe,
    task: taskRecord,
    secretScan: { hits: 0 },
  };
  const scanned = scanRecord(draft);
  if (scanned.hits > 0) {
    console.error(`live smoke: ${scanned.hits} credential-shaped value(s) in the record; nothing written`);
    process.exit(3);
  }
  const record = { ...(scanned.redacted as SmokeRecord), secretScan: { hits: 0 } };
  atomicWriteJson(join(researchDir, `${day}-live-claude-smoke.json`), record);
  atomicWriteFile(join(researchDir, `${day}-live-claude-smoke.md`), renderRecord(record));
  console.log(JSON.stringify({
    record: join(researchDir, `${day}-live-claude-smoke.json`),
    probe: { state: record.probe.state, filesAfter: record.probe.filesAfter.length, interactionRequested: record.probe.interactionRequested },
    task: { runStatus: record.task.runStatus, haltReason: record.task.haltReason, fixtureVerified: record.task.fixture.verified, remoteUnchanged: record.task.remote.unchanged, gateDenials: record.task.gateDenials.length },
    jail,
  }, null, 2));
  const healthy = probeHealthy
    && record.task.fixture.verified && record.task.remote.unchanged && (record.task.haltReason === "done" || record.task.haltReason === "blocked");
  process.exit(healthy ? 0 : 1);
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    const message = redactSecrets(error instanceof Error ? error.message : String(error));
    console.error(`live smoke failed: ${message}`);
    process.exit(message.startsWith("TRUST REQUIRED") ? 4 : 2);
  }
}

// Shared helpers for NIGHT LOOP hooks. Runs under Bun (bun .night-loop/hooks/*.ts).
// No third-party deps on purpose: the safety path must not break on a missing module.
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, rmSync } from "node:fs";
import { execSync, spawnSync } from "node:child_process";
import { appendLedgerEvent } from "../../src/core";

export const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
// The loop's own namespace, separate from the .apsolut seshat vault. Overridable so a
// host project can relocate it without editing hooks.
export const LOOP_DIR = process.env.NIGHT_LOOP_DIR || ".night-loop";
const NL = `${ROOT}/${LOOP_DIR}/state`;

function ensureDir() {
  if (!existsSync(NL)) mkdirSync(NL, { recursive: true });
}

// ---- markers (the loop's durable, file-based state) ----
export function markerPath(name: string) { return `${NL}/${name}`; }
export function hasMarker(name: string) { return existsSync(markerPath(name)); }
export function writeMarker(name: string, body = "") { ensureDir(); writeFileSync(markerPath(name), body); }
export function appendMarker(name: string, line: string) { ensureDir(); appendFileSync(markerPath(name), line.replace(/\n/g, " ") + "\n"); }
export function removeMarker(name: string) { try { rmSync(markerPath(name)); } catch {} }
export function appendEvent(type: string, data: Record<string, unknown>) {
  return appendLedgerEvent(`${NL}/events.jsonl`, type, data);
}

export function isActive() { return hasMarker("ACTIVE"); }   // loop is armed
export function disarm() { removeMarker("ACTIVE"); }
export function writeHalt(reason: string) {
  writeMarker("HALTED", reason);
  appendEvent("run.halted", { reason });
}

export function bumpStep(): number {
  ensureDir();
  let n = 0;
  try { n = parseInt(readFileSync(markerPath("STEP"), "utf8").trim(), 10) || 0; } catch {}
  n += 1;
  writeFileSync(markerPath("STEP"), String(n));
  return n;
}

export function maxSteps(): number {
  return parseInt(process.env.NIGHT_LOOP_MAX_STEPS || "2000", 10);
}

// ---- harness (the judge the loop trusts) ----
interface RatchetCommand {
  display: string;
  argv: [string, ...string[]];
}

interface RatchetConfig {
  hard: RatchetCommand[];
  acceptedE2e: RatchetCommand[];
}

function ratchetConfig(): RatchetConfig {
  return JSON.parse(readFileSync(`${ROOT}/${LOOP_DIR}/ratchet.json`, "utf8")) as RatchetConfig;
}

function runCommand(command: RatchetCommand): { ok: boolean; out: string } {
  const [executable, ...args] = command.argv;
  const result = spawnSync(executable, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });
  return {
    ok: result.status === 0 && result.error === undefined,
    out: `${result.stdout || ""}${result.stderr || ""}${result.error?.message || ""}`,
  };
}

function lastLine(s: string) {
  const lines = s.trim().split("\n").filter(Boolean);
  return (lines[lines.length - 1] || "").slice(0, 300);
}

// Cheap, deterministic hard tier. Runs every turn. See judge-and-flake-reliability.md.
export function runRatchet(): { allGreen: boolean; failing: string } {
  const commands = [...ratchetConfig().hard, ...ratchetConfig().acceptedE2e];
  for (const command of commands) {
    const result = runCommand(command);
    appendEvent("harness.command", { tier: "ratchet", command: command.display, ok: result.ok });
    if (!result.ok) return { allGreen: false, failing: `${command.display} -> ${lastLine(result.out)}` };
  }
  return { allGreen: true, failing: "" };
}

// Full harness. Runs only to verify a done-claim (expensive layers included).
export function runFullHarness(): { allGreen: boolean; failing: string } {
  const commands = [
    ...ratchetConfig().hard,
    ...ratchetConfig().acceptedE2e,
    { display: "bun run test:screenshot", argv: ["bun", "run", "test:screenshot"] as [string, ...string[]] },
    { display: "bun run perf", argv: ["bun", "run", "perf"] as [string, ...string[]] },
  ];
  for (const command of commands) {
    const result = runCommand(command);
    appendEvent("harness.command", { tier: "full", command: command.display, ok: result.ok });
    if (!result.ok) return { allGreen: false, failing: `${command.display} -> ${lastLine(result.out)}` };
  }
  return { allGreen: true, failing: "" };
}

// ---- shell + files ----
export function sh(cmd: string): string {
  try { return execSync(cmd, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e: any) { return ((e.stdout || "") + (e.stderr || "")); }
}

export function readFileSafe(rel: string): string {
  try { return readFileSync(`${ROOT}/${rel}`, "utf8"); } catch { return "(missing)"; }
}

// ---- Stop-hook decisions ----
export function blockStop(reason: string): never {
  appendEvent("stop.continued", { reason: reason.slice(0, 500) });
  console.log(JSON.stringify({ decision: "block", reason }));
  process.exit(0);
}
export function allowStop(): never {
  process.exit(0); // no output -> Claude stops normally
}

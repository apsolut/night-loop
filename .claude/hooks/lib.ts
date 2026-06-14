// Shared helpers for NIGHT LOOP hooks. Runs under Bun (bun .claude/hooks/*.ts).
// No third-party deps on purpose: the safety path must not break on a missing module.
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";

export const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const NL = `${ROOT}/.apsolut/night-loop`;

function ensureDir() {
  if (!existsSync(NL)) mkdirSync(NL, { recursive: true });
}

// ---- markers (the loop's durable, file-based state) ----
export function markerPath(name: string) { return `${NL}/${name}`; }
export function hasMarker(name: string) { return existsSync(markerPath(name)); }
export function writeMarker(name: string, body = "") { ensureDir(); writeFileSync(markerPath(name), body); }
export function appendMarker(name: string, line: string) { ensureDir(); appendFileSync(markerPath(name), line.replace(/\n/g, " ") + "\n"); }
export function removeMarker(name: string) { try { rmSync(markerPath(name)); } catch {} }

export function isActive() { return hasMarker("ACTIVE"); }   // loop is armed
export function disarm() { removeMarker("ACTIVE"); }
export function writeHalt(reason: string) { writeMarker("HALTED", reason); }

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
function runScript(name: string): { ok: boolean; out: string } {
  try {
    const out = execSync(`bun run ${name}`, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { ok: true, out };
  } catch (e: any) {
    return { ok: false, out: ((e.stdout || "") + (e.stderr || "")) };
  }
}

function lastLine(s: string) {
  const lines = s.trim().split("\n").filter(Boolean);
  return (lines[lines.length - 1] || "").slice(0, 300);
}

// Cheap, deterministic hard tier. Runs every turn. See judge-and-flake-reliability.md.
export function runRatchet(): { allGreen: boolean; failing: string } {
  for (const s of ["typecheck", "lint", "test:unit"]) {
    const r = runScript(s);
    if (!r.ok) return { allGreen: false, failing: `${s} -> ${lastLine(r.out)}` };
  }
  return { allGreen: true, failing: "" };
}

// Full harness. Runs only to verify a done-claim (expensive layers included).
export function runFullHarness(): { allGreen: boolean; failing: string } {
  for (const s of ["typecheck", "lint", "test:unit", "test:e2e", "test:screenshot"]) {
    const r = runScript(s);
    if (!r.ok) return { allGreen: false, failing: `${s} -> ${lastLine(r.out)}` };
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
  console.log(JSON.stringify({ decision: "block", reason }));
  process.exit(0);
}
export function allowStop(): never {
  process.exit(0); // no output -> Claude stops normally
}

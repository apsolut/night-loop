// The night's slow brain (decision 015): a deterministic stuck detector over the event tape,
// the prompts for a think turn and a read-only consult, and the lessons file that carries
// what was learned into the next prompt and the next night.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { LedgerEvent } from "./core";

export type StuckReason = "repeated_red" | "repeated_block" | "no_progress";

export interface StuckVerdict {
  stuck: boolean;
  reason?: StuckReason;
  fingerprint?: string;
  evidence: string[];
}

export const DEFAULT_STUCK_WINDOW = 3;

function normalizeRed(reason: string): string | undefined {
  const match = reason.match(/^(?:Ratchet is RED|Done claim REJECTED[^:]*): (.+?)\.?(?: Fix this| Keep working|$)/);
  return match?.[1]?.trim().replace(/\.$/, "").slice(0, 200);
}

function segments(events: readonly LedgerEvent[]): LedgerEvent[][] {
  // A turn boundary is a provider turn when the run has them, otherwise each Stop-hook verdict.
  const markerType = events.some((event) => event.type === "turn.started") ? "turn.started" : "stop.continued";
  const result: LedgerEvent[][] = [];
  let current: LedgerEvent[] = [];
  for (const event of events) {
    if (event.type === markerType && markerType === "turn.started") {
      if (current.length) result.push(current);
      current = [];
    }
    current.push(event);
    if (event.type === markerType && markerType === "stop.continued") {
      result.push(current);
      current = [];
    }
  }
  if (current.length && markerType === "turn.started") result.push(current);
  return result;
}

const RESET_EVENTS = new Set(["think.completed", "think.injected", "stuck.shelved"]);

export function detectStuck(
  allEvents: readonly LedgerEvent[],
  window = DEFAULT_STUCK_WINDOW,
  progressFingerprints: readonly string[] = [],
): StuckVerdict {
  // A think turn or a shelve starts a fresh episode: only what happened afterwards counts.
  let start = 0;
  allEvents.forEach((event, index) => { if (RESET_EVENTS.has(event.type)) start = index + 1; });
  const events = allEvents.slice(start);
  const verdicts = events.filter((event) => event.type === "stop.continued");
  const recentReds = verdicts.slice(-window)
    .map((event) => normalizeRed(String(event.data.reason ?? "")))
    .filter((line): line is string => Boolean(line));
  if (verdicts.length >= window && recentReds.length === window && new Set(recentReds).size === 1) {
    return { stuck: true, reason: "repeated_red", fingerprint: `red:${recentReds[0]}`, evidence: recentReds };
  }
  const recentSegments = segments(events).slice(-window);
  if (recentSegments.length === window) {
    const categories = recentSegments.map((segment) => {
      const blocked = segment.find((event) => /^policy\.(blocked|denied)$/.test(event.type));
      return blocked ? `${String(blocked.data.category ?? "")}:${String(blocked.data.tool ?? "")}` : undefined;
    });
    if (categories.every((category): category is string => Boolean(category)) && new Set(categories).size === 1) {
      return { stuck: true, reason: "repeated_block", fingerprint: `block:${categories[0]}`, evidence: categories };
    }
  }
  const recentProgress = progressFingerprints.slice(-window);
  if (recentProgress.length === window && new Set(recentProgress).size === 1) {
    return { stuck: true, reason: "no_progress", fingerprint: `tree:${recentProgress[0]}`, evidence: [`working tree unchanged for ${window} turns`] };
  }
  return { stuck: false, evidence: [] };
}

export function lessonsPath(repo: string): string {
  return join(repo, ".night-loop", "lessons.md");
}

export function appendLesson(repo: string, line: string, timestamp = new Date().toISOString()): void {
  const path = lessonsPath(repo);
  mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(path)) appendFileSync(path, "# Lessons (appended by the NIGHT LOOP supervisor)\n\n");
  appendFileSync(path, `- ${timestamp} ${line.replace(/\s+/g, " ").trim().slice(0, 400)}\n`);
}

export function readLessons(repo: string, limit = 12): string[] {
  const path = lessonsPath(repo);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split(/\r?\n/).filter((line) => line.startsWith("- ")).slice(-limit);
}

export function lessonsPreface(repo: string): string {
  const lessons = readLessons(repo);
  return lessons.length ? `Lessons recorded so far:\n${lessons.join("\n")}\n\n` : "";
}

export function compileConsultPrompt(verdict: StuckVerdict, lessons: string[]): string {
  return [
    "You are a read-only consultant for an unattended build. You cannot edit files and must not try.",
    `The implementer is stuck (${verdict.reason}). Evidence:`,
    ...verdict.evidence.map((line) => `- ${line}`),
    ...(lessons.length ? ["Lessons recorded so far:", ...lessons] : []),
    "Read the repository, .night-loop/progress.md, .night-loop/backlog.yaml, and the failing tests.",
    "Reply with: ROOT CAUSE (one paragraph), ALTERNATIVES (three, each with a one-line cost), RECOMMENDED (one line starting with PLAN:).",
  ].join("\n");
}

export function compileThinkPrompt(verdict: StuckVerdict, lessons: string[], consult?: { provider: string; text: string }): string {
  return [
    "THINK TURN. Do not edit source or tests in this turn. Reason, then answer.",
    `NIGHT LOOP classified this run as stuck (${verdict.reason}). Evidence:`,
    ...verdict.evidence.map((line) => `- ${line}`),
    ...(lessons.length ? ["Lessons recorded so far:", ...lessons] : []),
    ...(consult ? [`Second opinion from a read-only ${consult.provider} consultant:`, consult.text] : []),
    "Name the root cause in one paragraph. List three alternatives with a one-line cost each.",
    "Choose one and end your reply with a single line starting with PLAN: that a fresh session could execute.",
    "If no alternative can be tested without real credentials or ground truth, say SHELVE instead of PLAN and name the milestone.",
  ].join("\n");
}

export function extractPlan(text: string): string | undefined {
  const line = text.split(/\r?\n/).map((part) => part.trim()).reverse().find((part) => /^(?:PLAN|SHELVE)\b/i.test(part));
  return line?.slice(0, 600);
}

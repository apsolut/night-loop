#!/usr/bin/env bun
import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";

const ROOTS = ["src", "scripts", "test", ".night-loop/hooks"];
const EXTENSIONS = new Set([".ts", ".json"]);
const failures: string[] = [];

function filesBelow(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    return entry.isDirectory() ? filesBelow(child) : [child];
  });
}

for (const file of ROOTS.flatMap(filesBelow).filter((path) => EXTENSIONS.has(extname(path)))) {
  const source = readFileSync(file, "utf8");
  const lines = source.split("\n");

  if (source.includes("\u2014")) failures.push(`${file}: em dash is forbidden`);
  if (source.includes("\t")) failures.push(`${file}: tab character is forbidden`);
  const ignoredTypeCheck = `@ts-${"ignore"}`;
  if (source.includes(ignoredTypeCheck)) failures.push(`${file}: ignored TypeScript check is forbidden`);
  lines.forEach((line, index) => {
    if (/\s+$/.test(line)) failures.push(`${file}:${index + 1}: trailing whitespace`);
  });

  if (extname(file) === ".ts") {
    try {
      new Bun.Transpiler({ loader: "ts" }).transformSync(source);
    } catch (error) {
      failures.push(`${file}: ${String(error)}`);
    }
  }
}

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts?: Record<string, string>;
};
const m0Commands = ["build", "typecheck", "lint", "test:unit", "test:e2e"];
for (const command of m0Commands) {
  if (/M\d+: wire/.test(packageJson.scripts?.[command] ?? "")) {
    failures.push(`package.json: placeholder remains in ${command}`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`Linted ${ROOTS.length} source roots`);

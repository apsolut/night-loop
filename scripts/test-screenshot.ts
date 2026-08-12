#!/usr/bin/env bun
import { readdirSync } from "node:fs";
import { extname, join } from "node:path";

const UI_EXTENSIONS = new Set([".css", ".html", ".jsx", ".tsx", ".vue", ".svelte"]);

function filesBelow(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    return entry.isDirectory() ? filesBelow(child) : [child];
  });
}

const screenshotTargets = filesBelow("src").filter((path) => UI_EXTENSIONS.has(extname(path)));
if (screenshotTargets.length > 0) {
  console.error(`Screenshot coverage is required for ${screenshotTargets.length} UI source file(s)`);
  process.exit(1);
}

console.log("Screenshot advisory: not applicable to this CLI-only source tree; 0 UI targets");

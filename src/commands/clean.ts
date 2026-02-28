/**
 * `gp clean` — remove build artifacts, node_modules, dangling Docker images.
 * Confirms before deleting anything significant.
 */

import { confirm } from "@inquirer/prompts";
import { existsSync, readdirSync, statSync, rmSync } from "node:fs";
import { join } from "node:path";
import { gp, banner } from "../lib/display.ts";
import { isGitRepo } from "../lib/git.ts";
import chalk from "chalk";

const ARTIFACT_DIRS = [
  "node_modules",
  "dist",
  "build",
  ".next",
  ".nuxt",
  ".turbo",
  "coverage",
  "__pycache__",
  ".pytest_cache",
  "target",       // Rust
  ".gradle",      // Java
];

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)}GB`;
}

function dirSize(dir: string): number {
  let total = 0;
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      try {
        const s = statSync(full);
        if (s.isDirectory()) total += dirSize(full);
        else total += s.size;
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return total;
}

export async function runClean(dir: string = process.cwd(), yes = false): Promise<void> {
  if (!(await isGitRepo(dir))) {
    gp.warn("Not a git repo.");
    return;
  }

  banner();
  gp.header("Clean project");
  gp.blank();

  // ── Find artifact dirs ────────────────────────────────────────────────────
  const found: Array<{ path: string; size: number }> = [];
  for (const name of ARTIFACT_DIRS) {
    const full = join(dir, name);
    if (existsSync(full)) {
      const size = dirSize(full);
      found.push({ path: full, size });
    }
  }

  // ── Check Docker dangling images ──────────────────────────────────────────
  const dockerResult = await Bun.$`docker images -f dangling=true -q`.quiet().nothrow();
  const danglingIds = dockerResult.stdout.toString().trim().split("\n").filter(Boolean);

  if (found.length === 0 && danglingIds.length === 0) {
    gp.success("Nothing to clean — project is already tidy.");
    gp.blank();
    return;
  }

  // ── Show what will be removed ─────────────────────────────────────────────
  if (found.length > 0) {
    console.log(chalk.bold("  Artifact directories:"));
    for (const f of found) {
      const rel = f.path.replace(dir + "/", "");
      console.log(`    ${chalk.red("✗")}  ${rel.padEnd(24)} ${chalk.dim(humanSize(f.size))}`);
    }
    gp.blank();
  }

  if (danglingIds.length > 0) {
    console.log(chalk.bold("  Dangling Docker images:"));
    console.log(`    ${chalk.red("✗")}  ${danglingIds.length} image(s)`);
    gp.blank();
  }

  const totalSize = found.reduce((acc, f) => acc + f.size, 0);
  console.log(chalk.dim(`  Will free ~${humanSize(totalSize)} of disk space`));
  gp.blank();

  // ── Confirm ───────────────────────────────────────────────────────────────
  if (!yes) {
    const ok = await confirm({ message: "Delete these?", default: true });
    if (!ok) {
      gp.info("Cancelled.");
      return;
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────
  let freed = 0;
  for (const f of found) {
    try {
      rmSync(f.path, { recursive: true, force: true });
      freed += f.size;
      gp.success(`Removed ${f.path.replace(dir + "/", "")}`);
    } catch (e) {
      gp.warn(`Could not remove ${f.path}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (danglingIds.length > 0) {
    const prune = await Bun.$`docker image prune -f`.quiet().nothrow();
    if (prune.exitCode === 0) {
      const match = prune.stdout.toString().match(/Total reclaimed space: (.+)/);
      gp.success(`Docker images pruned${match ? ` — freed ${match[1]}` : ""}`);
    }
  }

  gp.blank();
  gp.success(`Done. Freed ~${humanSize(freed)}.`);
  gp.blank();
}

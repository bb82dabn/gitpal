/**
 * `gp digest` — daily summary of what changed across all projects.
 * Run manually, or via cron at 9am.
 * Output goes to ~/.gitpal/log/digest.md and is printed to stdout.
 */

import { readdirSync, statSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { loadConfig } from "../lib/config.ts";
import { isGitRepo, gitStatus } from "../lib/git.ts";
import { gp, banner } from "../lib/display.ts";
import chalk from "chalk";
import { runReadme } from "./readme.ts";

const HOME = homedir();
const DIGEST_PATH = join(HOME, ".gitpal", "log", "digest.md");

async function getProjectDirs(): Promise<string[]> {
  const config = await loadConfig();
  const dirs: string[] = [];
  for (const pattern of config.watch_patterns) {
    const base = pattern.replace("~", HOME).replace(/\/\*$/, "");
    try {
      for (const entry of readdirSync(base)) {
        if (entry.startsWith(".")) continue;
        const full = join(base, entry);
        if (statSync(full).isDirectory()) dirs.push(full);
      }
    } catch { /* ok */ }
  }
  return dirs;
}

async function getYesterdayCommits(dir: string): Promise<string[]> {
  try {
    const r = await Bun.$`git -C ${dir} log --oneline --since="yesterday" --until="now"`.quiet().nothrow();
    return r.stdout.toString().trim().split("\n").filter(Boolean);
  } catch { return []; }
}

async function getContainerStatus(): Promise<{ healthy: string[]; unhealthy: string[] }> {
  const healthy: string[] = [];
  const unhealthy: string[] = [];
  try {
    const r = await Bun.$`docker ps --format "{{.Names}}|{{.Status}}"`.quiet().nothrow();
    for (const line of r.stdout.toString().trim().split("\n").filter(Boolean)) {
      const [name, status] = line.split("|");
      if (!name) continue;
      if ((status ?? "").includes("unhealthy") || (status ?? "").includes("Restarting")) {
        unhealthy.push(`${name} (${status})`);
      } else {
        healthy.push(name);
      }
    }
  } catch { /* docker not available */ }
  return { healthy, unhealthy };
}

async function getDiskUsage(): Promise<string> {
  try {
    const r = await Bun.$`df -h /`.quiet().nothrow();
    const line = r.stdout.toString().split("\n")[1] ?? "";
    const parts = line.split(/\s+/);
    return `${parts[2] ?? "?"} used of ${parts[1] ?? "?"} (${parts[4] ?? "?"}%)`;
  } catch { return "unknown"; }
}

export async function runDigest(quiet = false): Promise<void> {
  if (!quiet) {
    banner();
    gp.header("Daily Digest");
    gp.info("Building summary...");
    gp.blank();
  }

  const dirs = await getProjectDirs();
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const lines: string[] = [];

  lines.push(`# GitPal Daily Digest — ${dateStr}`);
  lines.push(`*Generated at ${now.toLocaleTimeString()}*`);
  lines.push("");

  // ── Project activity ────────────────────────────────────────────────────────
  lines.push("## What Changed Yesterday");
  lines.push("");

  let totalCommits = 0;
  const activeProjects: string[] = [];

  for (const dir of dirs) {
    if (!(await isGitRepo(dir))) continue;
    const commits = await getYesterdayCommits(dir);
    if (commits.length === 0) continue;
    totalCommits += commits.length;
    const name = dir.split("/").pop() ?? dir;
    activeProjects.push(name);
    lines.push(`### ${name}`);
    for (const c of commits) lines.push(`- ${c}`);
    lines.push("");
  }

  if (totalCommits === 0) {
    lines.push("*No commits yesterday.*");
    lines.push("");
  } else {
    lines.push(`*${totalCommits} commit(s) across ${activeProjects.length} project(s)*`);
    lines.push("");
  }

  // ── Uncommitted work ────────────────────────────────────────────────────────
  lines.push("## Uncommitted Work");
  lines.push("");
  const dirtyProjects: Array<{ name: string; changes: number }> = [];
  for (const dir of dirs) {
    if (!(await isGitRepo(dir))) continue;
    const status = await gitStatus(dir);
    if (status.hasChanges) {
      dirtyProjects.push({ name: dir.split("/").pop() ?? dir, changes: status.staged + status.unstaged + status.untracked });
    }
  }
  if (dirtyProjects.length === 0) {
    lines.push("All projects are clean — nothing uncommitted.");
  } else {
    for (const p of dirtyProjects) lines.push(`- **${p.name}** — ${p.changes} file(s) not yet committed`);
  }
  lines.push("");

  // ── Docker ──────────────────────────────────────────────────────────────────
  lines.push("## Container Health");
  lines.push("");
  const { healthy, unhealthy } = await getContainerStatus();
  if (unhealthy.length > 0) {
    lines.push(`⚠ **${unhealthy.length} unhealthy container(s):**`);
    for (const c of unhealthy) lines.push(`- ${c}`);
  } else if (healthy.length > 0) {
    lines.push(`✓ All ${healthy.length} container(s) healthy.`);
  } else {
    lines.push("No containers running.");
  }
  lines.push("");

  // ── Disk ────────────────────────────────────────────────────────────────────
  lines.push("## System");
  lines.push("");
  const disk = await getDiskUsage();
  lines.push(`- Disk: ${disk}`);
  lines.push("");

  const content = lines.join("\n");

  // Write to file
  mkdirSync(join(HOME, ".gitpal", "log"), { recursive: true });
  writeFileSync(DIGEST_PATH, content);

  // Print to terminal
  if (!quiet) {
    // Colour-coded terminal output (simpler than raw markdown)
    if (totalCommits > 0) {
      console.log(chalk.bold("  Yesterday's commits:"));
      for (const name of activeProjects) {
        console.log(chalk.cyan(`  ${name}`));
      }
      gp.blank();
    } else {
      gp.info("No commits yesterday.");
    }

    if (dirtyProjects.length > 0) {
      gp.warn(`Uncommitted work in: ${dirtyProjects.map(p => p.name).join(", ")}`);
    } else {
      gp.success("All projects clean.");
    }

    if (unhealthy.length > 0) {
      gp.warn(`Unhealthy containers: ${unhealthy.join(", ")}`);
    } else if (healthy.length > 0) {
      gp.success(`${healthy.length} container(s) healthy.`);
    }

    gp.info(`Disk: ${disk}`);
    gp.blank();
    console.log(chalk.dim(`  Full digest saved to: ${DIGEST_PATH}`));
    gp.blank();
  }
}

/** Regenerate README for every project — called by daily cron */
export async function runDailyReadmeRefresh(quiet = false): Promise<void> {
  const dirs = await getProjectDirs();
  for (const dir of dirs) {
    const name = dir.split("/").pop() ?? dir;
    if (!quiet) gp.info(`Refreshing README for ${name}...`);
    await runReadme(dir).catch(() => { /* non-fatal */ });
  }
}

/** Install a cron job to run `gp digest --cron` at 9am daily */
export async function installDigestCron(): Promise<void> {
  const gpPath = join(HOME, ".local", "bin", "gp");
  const cronLine = `0 9 * * * ${gpPath} digest --cron >> ${join(HOME, ".gitpal", "log", "digest-cron.log")} 2>&1`;

  const existing = await Bun.$`crontab -l`.quiet().nothrow();
  const currentCron = existing.exitCode === 0 ? existing.stdout.toString() : "";

  if (currentCron.includes("gp digest")) {
    gp.info("Digest cron job already installed.");
    return;
  }

  const newCron = currentCron.trimEnd() + "\n" + cronLine + "\n";
  // Write to a temp file and pipe into crontab
  const tmpFile = join(HOME, ".gitpal", "_cron.tmp");
  await Bun.write(tmpFile, newCron);
  const result = await Bun.$`crontab ${tmpFile}`.quiet().nothrow();
  await Bun.$`rm -f ${tmpFile}`.quiet().nothrow();
  if (result.exitCode !== 0) {
    gp.error(`Failed to install cron: ${result.stderr.toString().trim()}`);
    return;
  }
  gp.success("Digest cron job installed — runs daily at 9am.");
  gp.info(`Log: ${join(HOME, ".gitpal", "log", "digest-cron.log")}`);
}

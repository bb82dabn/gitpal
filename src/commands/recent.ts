/**
 * `gp recent` — show all projects sorted by last commit time.
 * Answers "what was I working on last?"
 */

import { gp, banner } from "../lib/display.ts";
import { loadConfig } from "../lib/config.ts";
import { isGitRepo } from "../lib/git.ts";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import chalk from "chalk";

export async function runRecent(): Promise<void> {
  banner();
  gp.header("Recent activity");
  gp.blank();

  const config = await loadConfig();
  const home = homedir();

  const projects: Array<{
    name: string;
    dir: string;
    lastCommit: number;
    lastMessage: string;
    lastDate: string;
    branch: string;
    dirty: boolean;
  }> = [];

  for (const pattern of config.watch_patterns) {
    const base = pattern.replace("~", home).replace(/\/\*$/, "");
    if (!existsSync(base)) continue;

    for (const entry of readdirSync(base)) {
      if (entry.startsWith(".")) continue;
      const dir = join(base, entry);
      try {
        if (!statSync(dir).isDirectory()) continue;
      } catch { continue; }

      if (!(await isGitRepo(dir))) continue;

      const [logResult, branchResult, statusResult] = await Promise.all([
        Bun.$`git -C ${dir} log -1 --format=%ct%s%cr`.quiet().nothrow(),
        Bun.$`git -C ${dir} branch --show-current`.quiet().nothrow(),
        Bun.$`git -C ${dir} status --porcelain`.quiet().nothrow(),
      ]);

      const logLine = logResult.stdout.toString().trim();
      const parts = logLine.split("\x1f");
      const ts = parseInt(parts[0] ?? "0") * 1000;
      const msg = parts[1] ?? "(no commits)";
      const relDate = parts[2] ?? "";
      const branch = branchResult.stdout.toString().trim() || "main";
      const dirty = statusResult.stdout.toString().trim().length > 0;

      projects.push({
        name: entry,
        dir,
        lastCommit: ts,
        lastMessage: msg,
        lastDate: relDate,
        branch,
        dirty,
      });
    }
  }

  if (projects.length === 0) {
    gp.warn("No git projects found.");
    gp.blank();
    return;
  }

  // Sort newest first
  projects.sort((a, b) => b.lastCommit - a.lastCommit);

  for (const p of projects) {
    const dirtyMark = p.dirty ? chalk.yellow(" ●") : "  ";
    const namePart = chalk.bold.white(p.name.padEnd(22));
    const datePart = chalk.dim((p.lastDate || "never").padEnd(16));
    const msgPart  = chalk.white(p.lastMessage.length > 48
      ? p.lastMessage.slice(0, 45) + "..."
      : p.lastMessage);

    console.log(`  ${namePart}  ${datePart}  ${msgPart}${dirtyMark}`);
  }

  console.log();
  console.log(chalk.dim("  ● = uncommitted changes"));
  console.log();
}

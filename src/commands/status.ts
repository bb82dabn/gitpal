import { isGitRepo, gitStatus, gitLog, hasRemote, countFiles } from "../lib/git.ts";
import { loadConfig } from "../lib/config.ts";
import { gp, banner } from "../lib/display.ts";
import { join } from "node:path";
import { homedir } from "node:os";
import { readdirSync, statSync } from "node:fs";
import chalk from "chalk";

interface ProjectInfo {
  name: string;
  path: string;
  lastCommit: string;
  changes: string;
  watching: boolean;
  onGithub: boolean;
  hasCommits: boolean;
}

async function expandPatterns(patterns: string[]): Promise<string[]> {
  const home = homedir();
  const dirs: string[] = [];

  for (const pattern of patterns) {
    const expanded = pattern.replace("~", home);
    if (expanded.endsWith("/*")) {
      // List all directories inside base
      const base = expanded.slice(0, -2);
      try {
        const entries = readdirSync(base);
        for (const entry of entries) {
          const full = join(base, entry);
          try {
            const stat = statSync(full);
            if (stat.isDirectory() && !entry.startsWith(".")) {
              dirs.push(full);
            }
          } catch { /* skip */ }
        }
      } catch { /* base doesn't exist */ }
    } else {
      dirs.push(expanded);
    }
  }

  return dirs;
}

async function getWatchedProjects(): Promise<string[]> {
  const pidDir = join(homedir(), ".gitpal", "sessions");
  const watching: string[] = [];
  try {
    const entries = readdirSync(pidDir);
    for (const entry of entries) {
      if (entry.endsWith(".pid")) {
        const pidFile = join(pidDir, entry);
        const pid = parseInt(await Bun.file(pidFile).text(), 10);
        // Check if process is still alive
        const alive = await Bun.$`kill -0 ${pid}`.quiet().nothrow();
        if (alive.exitCode === 0) {
          // Extract dir from the adjacent .dir file
          const dirFile = join(pidDir, entry.replace(".pid", ".dir"));
          if (await Bun.file(dirFile).exists()) {
            watching.push((await Bun.file(dirFile).text()).trim());
          }
        }
      }
    }
  } catch { /* no sessions dir */ }
  return watching;
}

export async function runStatus(): Promise<void> {
  banner();
  gp.header("Project Status");

  const config = await loadConfig();

  if (config.watch_patterns.length === 0) {
    gp.warn("No watch patterns configured.");
    gp.info("Run `gp setup` to configure which folders GitPal monitors.");
    return;
  }

  gp.info("Scanning your projects...");

  const dirs = await expandPatterns(config.watch_patterns);
  const watchedDirs = await getWatchedProjects();
  const projects: ProjectInfo[] = [];

  for (const dir of dirs) {
    const fileCount = await countFiles(dir).catch(() => 0);
    if (fileCount === 0) continue;

    const isRepo = await isGitRepo(dir);
    const name = dir.split("/").pop() ?? dir;

    if (!isRepo) {
      projects.push({
        name,
        path: dir,
        lastCommit: "never committed",
        changes: `${fileCount} files`,
        watching: false,
        onGithub: false,
        hasCommits: false,
      });
      continue;
    }

    const [status, commits, onGithub] = await Promise.all([
      gitStatus(dir),
      gitLog(dir, 1),
      hasRemote(dir),
    ]);

    const lastCommit = commits[0]
      ? `${commits[0].relativeDate} — ${commits[0].message.substring(0, 40)}`
      : "no commits";

    const changeStr = status.clean
      ? "clean"
      : `${status.staged + status.unstaged + status.untracked} changed`;

    projects.push({
      name,
      path: dir,
      lastCommit,
      changes: changeStr,
      watching: watchedDirs.includes(dir),
      onGithub,
      hasCommits: commits.length > 0,
    });
  }

  if (projects.length === 0) {
    gp.warn("No projects found in your configured watch patterns.");
    gp.info(`Patterns: ${config.watch_patterns.join(", ")}`);
    return;
  }

  gp.blank();

  // Sort: repos first, then by last commit recency
  const sorted = [...projects].sort((a, b) => {
    if (a.hasCommits && !b.hasCommits) return -1;
    if (!a.hasCommits && b.hasCommits) return 1;
    return 0;
  });

  for (const p of sorted) {
    const nameStr = chalk.bold(p.name.padEnd(20));
    const commitStr = chalk.dim(p.lastCommit.padEnd(45).substring(0, 45));
    const changesStr = p.changes === "clean" ? chalk.green("clean     ") : chalk.yellow(p.changes.padEnd(10));
    const watchStr = p.watching ? chalk.cyan("watching") : chalk.dim("idle    ");
    const githubStr = p.onGithub ? chalk.dim("") : chalk.red(" [!] not on GitHub");
    const noCommits = !p.hasCommits ? chalk.yellow(" [!] run: gp init") : "";

    console.log(`  ${nameStr}  ${commitStr}  ${changesStr}  ${watchStr}${githubStr}${noCommits}`);
  }

  gp.blank();

  const notOnGithub = projects.filter((p) => !p.onGithub).length;
  const notWatching = projects.filter((p) => p.hasCommits && !p.watching).length;

  if (notOnGithub > 0) {
    gp.info(`${notOnGithub} project(s) not yet on GitHub. Run \`gp init\` inside them.`);
  }
  if (notWatching > 0) {
    gp.info(`${notWatching} project(s) are not being auto-watched. \`cd\` into them to start watching.`);
  }
  gp.blank();
}

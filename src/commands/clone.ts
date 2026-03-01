/**
 * `gp clone <repo>` — Clone a GitHub repo into ~/projects/ and start watching it.
 *
 * Accepts:
 *   gp clone myapp              → clones bb82dabn/myapp
 *   gp clone user/myapp         → clones user/myapp
 *   gp clone https://github.com/user/myapp → clones from URL
 */

import { join, basename } from "node:path";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { gp, banner } from "../lib/display.ts";
import { loadConfig } from "../lib/config.ts";
import { isGitRepo } from "../lib/git.ts";
import { startWatcher, isWatcherRunning } from "../lib/watcher.ts";
import { addToManifest } from "../lib/sync-manifest.ts";
import chalk from "chalk";

export async function runClone(repoArg?: string): Promise<void> {
  banner();
  gp.header("Clone from GitHub");

  if (!repoArg) {
    gp.warn("Usage: gp clone <repo>");
    gp.info("  gp clone myapp                    → clones your repo");
    gp.info("  gp clone user/myapp               → clones user/myapp");
    gp.info("  gp clone https://github.com/...   → clones from URL");
    return;
  }

  const config = await loadConfig();

  // Resolve repo identifier
  let repoFullName: string;
  let repoName: string;

  if (repoArg.startsWith("https://") || repoArg.startsWith("git@")) {
    // Full URL — extract name
    repoFullName = repoArg;
    repoName = basename(repoArg).replace(/\.git$/, "");
  } else if (repoArg.includes("/")) {
    // user/repo format
    repoFullName = repoArg;
    repoName = repoArg.split("/").pop() ?? repoArg;
  } else {
    // Just a name — assume current user's repo
    repoFullName = `${config.github_username}/${repoArg}`;
    repoName = repoArg;
  }

  // Determine clone destination from watch_patterns, fallback to ~/projects/
  const home = homedir();
  let projectsRoot = join(home, "projects");
  if (config.watch_patterns.length > 0) {
    const firstPattern = config.watch_patterns[0]!.replace("~", home).replace(/\/\*$/, "");
    if (existsSync(firstPattern)) {
      projectsRoot = firstPattern;
    }
  }

  const destDir = join(projectsRoot, repoName);

  // Check if already exists
  if (existsSync(destDir)) {
    if (await isGitRepo(destDir)) {
      gp.info(`${repoName} already exists at ${destDir}`);
      // Start watcher if not running
      if (!isWatcherRunning(destDir)) {
        const pid = await startWatcher(destDir);
        gp.success(`Watcher started (PID ${pid}).`);
      } else {
        gp.info("Watcher already running.");
      }
      return;
    }
    gp.warn(`${destDir} exists but is not a git repo. Aborting.`);
    return;
  }

  // Clone
  gp.info(`Cloning ${chalk.bold(repoFullName)} into ${destDir}...`);
  const cloneResult = await Bun.$`gh repo clone ${repoFullName} ${destDir}`.quiet().nothrow();

  if (cloneResult.exitCode !== 0) {
    const stderr = cloneResult.stderr.toString().trim();
    gp.warn(`Clone failed: ${stderr || "unknown error"}`);
    gp.info("Make sure `gh auth status` is authenticated and the repo exists.");
    return;
  }

  gp.success(`Cloned ${repoName}.`);

  // Register in sync manifest
  await addToManifest({
    name: repoFullName.includes("/") ? repoFullName : `${config.github_username}/${repoFullName}`,
    url: `https://github.com/${repoFullName.includes("/") ? repoFullName : config.github_username + "/" + repoFullName}.git`,
    local_path: destDir,
  });

  // Start watcher
  if (!isWatcherRunning(destDir)) {
    const pid = await startWatcher(destDir);
    gp.success(`Watcher started (PID ${pid}).`);
  }

  // Enable systemd service
  const serviceResult = await Bun.$`systemctl --user enable --now ${"gp-watcher@" + repoName + ".service"}`.quiet().nothrow();
  if (serviceResult.exitCode === 0) {
    gp.info("Systemd service enabled (survives reboots).");
  }

  gp.blank();
  gp.success("Ready to go!");
  gp.info(`  cd ${destDir}`);
  gp.info("  Auto-sync is active — changes will push/pull automatically.");
  gp.blank();
}

/**
 * `gp _shell_hook`
 *
 * Called silently by the ~/.bashrc cd override on every directory change.
 * Runs fast and quiet — only speaks up when action is needed.
 */

import { isGitRepo, countFiles } from "../lib/git.ts";
import { isWatched, hasBeenPrompted, markPrompted } from "../lib/config.ts";
import { startWatcher, isWatcherRunning, startProjectsWatcher, isProjectsWatcherRunning } from "../lib/watcher.ts";
import chalk from "chalk";
import { isContextStale, writeContext } from "../lib/context.ts";

export async function runShellHook(dir: string = process.cwd()): Promise<void> {
  // Always ensure the projects-root watcher is running (starts once per boot)
  if (!isProjectsWatcherRunning()) {
    startProjectsWatcher().catch(() => { /* non-fatal */ });
  }

  // Quick exit: must be inside a watched pattern
  if (!(await isWatched(dir))) return;

  const isRepo = await isGitRepo(dir);

  // ── Case 1: Not a git repo yet — prompt to init ───────────────────────
  if (!isRepo) {
    const files = await countFiles(dir).catch(() => 0);
    if (files === 0) return;

    const alreadyPrompted = await hasBeenPrompted(dir);
    if (alreadyPrompted) return;

    await markPrompted(dir);

    console.log();
    console.log(chalk.cyan("  GitPal") + chalk.dim(` — ${dir.split("/").pop()} isn't on git yet`));
    console.log(chalk.dim("  Run ") + chalk.bold("gp init") + chalk.dim(" to back it up on GitHub"));
    console.log();
    return;
  }

  // ── Case 2: It's a repo — auto-start per-project watcher if not running ────
  if (!isWatcherRunning(dir)) {
    await startWatcher(dir).catch(() => { /* non-fatal */ });
  }

  // ── Refresh context file in background if stale (>24h old) ───────────────
  if (isContextStale(dir)) {
    writeContext(dir).catch(() => { /* non-fatal */ });
  }
}

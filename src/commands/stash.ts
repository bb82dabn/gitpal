/**
 * `gp stash` — set aside uncommitted changes without committing.
 * `gp stash pop` — restore the most recently stashed changes.
 * `gp stash list` — show all stashes.
 */

import { gp, banner } from "../lib/display.ts";
import { isGitRepo, gitStatus } from "../lib/git.ts";
import chalk from "chalk";

export async function runStash(subcommand: string = "push", dir: string = process.cwd()): Promise<void> {
  if (!(await isGitRepo(dir))) {
    gp.warn("Not a git repo. Run `gp init` first.");
    return;
  }

  switch (subcommand) {
    case "push":
    case "save": {
      banner();
      gp.header("Stash changes");

      const status = await gitStatus(dir);
      if (!status.hasChanges) {
        gp.success("Nothing to stash — working directory is clean.");
        return;
      }

      const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
      const result = await Bun.$`git -C ${dir} stash push -u -m ${"gp stash — " + ts}`.quiet().nothrow();
      if (result.exitCode !== 0) {
        gp.warn(`Stash failed: ${result.stderr.toString().trim()}`);
        return;
      }

      const changed = status.staged + status.unstaged + status.untracked;
      gp.success(`Stashed ${changed} file(s). Working directory is now clean.`);
      gp.info("Run `gp stash pop` to restore when ready.");
      gp.blank();
      break;
    }

    case "pop": {
      banner();
      gp.header("Restore stash");

      // Check there's something to pop
      const listResult = await Bun.$`git -C ${dir} stash list`.quiet().nothrow();
      const stashes = listResult.stdout.toString().trim().split("\n").filter(Boolean);
      if (stashes.length === 0) {
        gp.success("No stashes to restore.");
        return;
      }

      const popResult = await Bun.$`git -C ${dir} stash pop`.quiet().nothrow();
      if (popResult.exitCode !== 0) {
        const stderr = popResult.stderr.toString();
        if (stderr.includes("CONFLICT") || popResult.stdout.toString().includes("CONFLICT")) {
          gp.warn("Stash restored with conflicts — resolve them before continuing.");
          gp.info("Run `git status` to see conflicting files.");
        } else {
          gp.warn(`Stash pop failed: ${stderr.trim()}`);
        }
        return;
      }

      gp.success("Stash restored.");
      gp.blank();
      break;
    }

    case "list": {
      banner();
      gp.header("Stashes");
      gp.blank();

      // Use plain stash list and parse default format: stash@{N}: On branch: msg
      const result = await Bun.$`git -C ${dir} stash list`.quiet().nothrow();
      const lines = result.stdout.toString().trim().split("\n").filter(Boolean);

      if (lines.length === 0) {
        gp.info("No stashes.");
        gp.blank();
        return;
      }

      for (const line of lines) {
        // Format: stash@{0}: WIP on main: abc1234 message
        const m = line.match(/^(stash@\{\d+\}): (.+)$/);
        const ref = m?.[1] ?? "";
        const rest = (m?.[2] ?? line).replace(/^(WIP on|On) \S+: [0-9a-f]+ /, "");
        console.log(
          `  ${chalk.cyan(ref.padEnd(12))}  ${chalk.white(rest)}`
        );
      }
      gp.blank();
      break;
    }

    default:
      gp.warn(`Unknown stash subcommand: ${subcommand}`);
      gp.info("Usage: gp stash | gp stash pop | gp stash list");
  }
}

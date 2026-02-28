/**
 * `gp sync` — pull latest from GitHub into the current project.
 * Auto-stashes dirty working tree, pulls, then restores the stash.
 */

import { gp, banner } from "../lib/display.ts";
import { isGitRepo, hasRemote, gitStatus } from "../lib/git.ts";
import chalk from "chalk";

export async function runSync(dir: string = process.cwd()): Promise<void> {
  banner();
  gp.header("Sync from GitHub");

  if (!(await isGitRepo(dir))) {
    gp.warn("Not a git repo. Run `gp init` first.");
    return;
  }

  if (!(await hasRemote(dir))) {
    gp.warn("This project isn't connected to GitHub yet.");
    gp.info("Run `gp init` first to create a GitHub repo.");
    return;
  }

  const status = await gitStatus(dir);
  let stashed = false;

  // ── Stash dirty working tree so pull doesn't conflict ─────────────────────
  if (status.hasChanges) {
    gp.info("Stashing your local changes temporarily...");
    const stashResult = await Bun.$`git -C ${dir} stash push -u -m "gp sync auto-stash"`.quiet().nothrow();
    if (stashResult.exitCode !== 0) {
      gp.warn("Could not stash changes. Aborting sync to protect your work.");
      gp.info("Commit or snapshot your changes first, then run `gp sync`.");
      return;
    }
    stashed = true;
  }

  // ── Pull ──────────────────────────────────────────────────────────────────
  gp.info("Pulling latest from GitHub...");
  const branchResult = await Bun.$`git -C ${dir} branch --show-current`.quiet().nothrow();
  const branch = branchResult.stdout.toString().trim() || "main";

  const pullResult = await Bun.$`git -C ${dir} pull origin ${branch} --ff-only`.quiet().nothrow();

  if (pullResult.exitCode !== 0) {
    const stderr = pullResult.stderr.toString().trim();

    // Restore stash before bailing
    if (stashed) {
      await Bun.$`git -C ${dir} stash pop`.quiet().nothrow();
      gp.info("Your local changes have been restored.");
    }

    if (stderr.includes("Already up to date") || pullResult.stdout.toString().includes("Already up to date")) {
      gp.success("Already up to date — nothing to pull.");
      return;
    }

    if (stderr.includes("diverged") || stderr.includes("not a fast-forward")) {
      gp.warn("Cannot fast-forward — your local commits have diverged from GitHub.");
      gp.info("Run `gp push` to push your local commits, or use `gp undo` to reset.");
    } else {
      gp.warn(`Sync failed: ${stderr || "unknown error"}`);
    }
    return;
  }

  const pullOutput = pullResult.stdout.toString().trim();

  // ── Restore stash ─────────────────────────────────────────────────────────
  if (stashed) {
    gp.info("Restoring your local changes...");
    const popResult = await Bun.$`git -C ${dir} stash pop`.quiet().nothrow();
    if (popResult.exitCode !== 0) {
      const conflicts = popResult.stdout.toString().includes("CONFLICT");
      if (conflicts) {
        gp.warn("Merge conflict when restoring your changes.");
        gp.info("Your stash is preserved. Resolve conflicts then run: git stash drop");
      } else {
        gp.warn("Could not restore stash automatically. Run: git stash pop");
      }
    } else {
      gp.success("Local changes restored.");
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  if (pullOutput === "Already up to date.") {
    gp.success("Already up to date — nothing to pull.");
  } else {
    // Parse the diffstat from pull output
    const lines = pullOutput.split("\n").filter(Boolean);
    const statLine = lines.find(l => /\d+ file/.test(l)) ?? "";
    gp.blank();
    gp.success("Synced with GitHub.");
    if (statLine) console.log(chalk.dim(`  ${statLine}`));
    // Show which files changed
    const fileLines = lines.filter(l => /^\s+(create|delete|rename|\w+.*\|)/.test(l));
    for (const fl of fileLines.slice(0, 8)) {
      console.log(chalk.dim(`  ${fl.trim()}`));
    }
    if (fileLines.length > 8) {
      console.log(chalk.dim(`  ... and ${fileLines.length - 8} more`));
    }
    gp.blank();
  }
}

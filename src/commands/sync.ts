/**
 * `gp sync` — pull latest from GitHub using rebase.
 *
 * Single-repo:  gp sync          (syncs current project)
 * All repos:    gp sync --all    (syncs all watched repos with remotes)
 *
 * Workflow:
 *   1. Fetch from origin
 *   2. If behind, stash dirty tree, pull --rebase
 *   3. On rebase conflict: abort, save local commits to side branch, reset to remote
 *   4. Restore stash
 */

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { gp, banner } from "../lib/display.ts";
import {
  isGitRepo,
  hasRemote,
  gitStatus,
  gitFetch,
  gitCurrentBranch,
  getBranchStatus,
  gitPullRebase,
  gitRebaseAbort,
  gitCreateBranch,
  gitResetHardToRef,
  gitStashPush,
  gitStashPop,
} from "../lib/git.ts";
import { loadConfig, getMachineTag } from "../lib/config.ts";
import chalk from "chalk";

// ── Expand watch patterns to project dirs (shared logic with status.ts) ────

function expandPatterns(patterns: string[]): string[] {
  const home = homedir();
  const dirs: string[] = [];

  for (const pattern of patterns) {
    const expanded = pattern.replace("~", home);
    if (expanded.endsWith("/*")) {
      const base = expanded.slice(0, -2);
      try {
        const entries = readdirSync(base);
        for (const entry of entries) {
          const full = join(base, entry);
          try {
            if (statSync(full).isDirectory() && !entry.startsWith(".")) {
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

// ── Sync a single project ──────────────────────────────────────────────────

interface SyncResult {
  name: string;
  status: "up-to-date" | "synced" | "conflict" | "error" | "skipped";
  detail?: string;
}

async function syncProject(dir: string, quiet = false): Promise<SyncResult> {
  const name = dir.split("/").pop() ?? dir;

  if (!(await isGitRepo(dir))) {
    return { name, status: "skipped", detail: "not a git repo" };
  }

  if (!(await hasRemote(dir))) {
    return { name, status: "skipped", detail: "no remote" };
  }

  // 1. Fetch
  if (!quiet) gp.info(`Fetching from origin...`);
  const fetched = await gitFetch(dir);
  if (!fetched) {
    return { name, status: "error", detail: "fetch failed (network?)" };
  }

  // 2. Check ahead/behind
  const branchStatus = await getBranchStatus(dir);
  const { branch, ahead, behind, diverged } = branchStatus;

  if (behind === 0 && ahead === 0) {
    return { name, status: "up-to-date" };
  }

  if (behind === 0 && ahead > 0) {
    return { name, status: "up-to-date", detail: `${ahead} unpushed commit(s)` };
  }

  // 3. Need to pull — stash dirty tree first
  if (!quiet) gp.info(`${behind} commit(s) behind — pulling with rebase...`);

  const status = await gitStatus(dir);
  let stashed = false;

  if (status.hasChanges) {
    if (!quiet) gp.info("Stashing your local changes temporarily...");
    stashed = await gitStashPush(dir, "gp sync auto-stash");
    if (!stashed && status.hasChanges) {
      return { name, status: "error", detail: "could not stash changes" };
    }
  }

  // 4. Pull with rebase
  const pullResult = await gitPullRebase(dir);

  if (pullResult.ok) {
    // Rebase succeeded — restore stash
    if (stashed) {
      if (!quiet) gp.info("Restoring your local changes...");
      const popped = await gitStashPop(dir);
      if (!popped) {
        return { name, status: "synced", detail: "pulled but stash restore failed — run: git stash pop" };
      }
    }
    return { name, status: "synced", detail: `pulled ${behind} commit(s)` };
  }

  // 5. Rebase conflict — abort, side-branch, reset
  if (pullResult.conflicted) {
    await gitRebaseAbort(dir);

    const machineTag = await getMachineTag();
    const timestamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
    const sideBranch = `${machineTag}-conflict-${timestamp}`;

    // Save local commits to side branch
    const branchCreated = await gitCreateBranch(dir, sideBranch);
    if (branchCreated) {
      // Reset main to remote state
      await gitResetHardToRef(dir, `origin/${branch}`);
    }

    // Restore stash on the now-clean main
    if (stashed) {
      const popped = await gitStashPop(dir);
      if (!popped && !quiet) {
        gp.warn("Stash preserved after conflict — run: git stash pop");
      }
    }

    const detail = branchCreated
      ? `conflict! Local commits saved to branch: ${sideBranch}`
      : `conflict! Rebase aborted — resolve manually`;
    return { name, status: "conflict", detail };
  }

  // 6. Other pull failure
  if (stashed) {
    await gitStashPop(dir);
  }
  return { name, status: "error", detail: "pull --rebase failed" };
}

// ── Exported command ───────────────────────────────────────────────────────

export async function runSync(dir: string = process.cwd(), all = false): Promise<void> {
  banner();

  if (all) {
    gp.header("Sync All Projects");
    const config = await loadConfig();

    if (config.watch_patterns.length === 0) {
      gp.warn("No watch patterns configured. Run `gp setup` first.");
      return;
    }

    const dirs = expandPatterns(config.watch_patterns);
    const results: SyncResult[] = [];

    for (const projectDir of dirs) {
      const name = projectDir.split("/").pop() ?? projectDir;
      gp.info(`Syncing ${chalk.bold(name)}...`);
      const result = await syncProject(projectDir, true);
      results.push(result);
    }

    // Summary
    gp.blank();
    gp.header("Sync Summary");
    gp.blank();

    for (const r of results) {
      const icon =
        r.status === "synced" ? chalk.green("✓") :
        r.status === "up-to-date" ? chalk.dim("—") :
        r.status === "conflict" ? chalk.red("✗") :
        r.status === "error" ? chalk.red("!") :
        chalk.dim("·");
      const detail = r.detail ? chalk.dim(` ${r.detail}`) : "";
      console.log(`  ${icon} ${r.name.padEnd(25)} ${r.status}${detail}`);
    }

    gp.blank();

    const synced = results.filter(r => r.status === "synced").length;
    const conflicts = results.filter(r => r.status === "conflict").length;
    const errors = results.filter(r => r.status === "error").length;

    if (conflicts > 0) {
      gp.warn(`${conflicts} project(s) had conflicts — local commits saved to side branches.`);
    }
    if (errors > 0) {
      gp.warn(`${errors} project(s) had errors during sync.`);
    }
    if (synced > 0) {
      gp.success(`${synced} project(s) synced.`);
    }
    if (conflicts === 0 && errors === 0 && synced === 0) {
      gp.success("All projects up to date.");
    }
  } else {
    // Single-project sync (original behavior, now with rebase)
    gp.header("Sync from GitHub");

    const result = await syncProject(dir);

    switch (result.status) {
      case "up-to-date":
        gp.success("Already up to date — nothing to pull.");
        if (result.detail) gp.info(result.detail);
        break;
      case "synced":
        gp.success("Synced with GitHub.");
        if (result.detail) console.log(chalk.dim(`  ${result.detail}`));
        break;
      case "conflict":
        gp.warn("Sync conflict during rebase.");
        if (result.detail) gp.info(result.detail);
        break;
      case "error":
        gp.warn(`Sync failed: ${result.detail ?? "unknown error"}`);
        break;
      case "skipped":
        gp.warn(result.detail ?? "Skipped.");
        break;
    }

    gp.blank();
  }
}

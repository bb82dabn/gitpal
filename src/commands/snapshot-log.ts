import { gitLog, gitSnapshotCommit, gitStatus, isGitRepo } from "../lib/git.ts";
import { gp, banner } from "../lib/display.ts";
import chalk from "chalk";

// ── gp snapshot ───────────────────────────────────────────────────────────────

export interface SnapshotOptions {
  /** Custom commit message (defaults to "GitPal snapshot — <timestamp>") */
  message?: string;
  /** Suppress output */
  quiet?: boolean;
}

/**
 * Save the current state as a local git commit without pushing.
 * Safe to call at any time — idempotent if there's nothing to commit.
 */
export async function runSnapshot(dir: string = process.cwd(), opts: SnapshotOptions = {}): Promise<void> {
  const { quiet = false } = opts;

  if (!(await isGitRepo(dir))) {
    if (!quiet) {
      gp.warn("This directory isn't a git repo. Run `gp init` first.");
    }
    return;
  }

  const status = await gitStatus(dir);
  if (!status.hasChanges) {
    if (!quiet) gp.success("Nothing to snapshot — working directory is clean.");
    return;
  }

  if (!quiet) gp.info("Snapshotting current state...");

  let hash: string;
  if (opts.message) {
    // Use provided message
    await Bun.$`git -C ${dir} add -A`.quiet();
    await Bun.$`git -C ${dir} commit -m ${opts.message}`.quiet();
    const r = await Bun.$`git -C ${dir} rev-parse --short HEAD`.quiet().nothrow();
    hash = r.stdout.toString().trim();
  } else {
    hash = await gitSnapshotCommit(dir);
  }

  if (!quiet) {
    gp.success(`Snapshot saved: ${hash}`);
    gp.info("Your work is safe locally. Run `gp push` to also send it to GitHub.");
  } else {
    // Machine-readable: just print the hash
    console.log(hash);
  }
}

// ── gp log ────────────────────────────────────────────────────────────────────

export interface LogOptions {
  /** Output as JSON array (for programmatic use) */
  json?: boolean;
  /** Number of commits to show */
  n?: number;
  /** Show inline diff for each commit */
  diff?: boolean;
}

/**
 * Show recent commits. With --json, outputs a machine-readable JSON array
 * suitable for opencode to read and reason about.
 */
export async function runLog(dir: string = process.cwd(), opts: LogOptions = {}): Promise<void> {
  const { json = false, n = 15, diff = false } = opts;

  if (!(await isGitRepo(dir))) {
    if (json) {
      console.log("[]");
    } else {
      gp.warn("Not a git repo.");
    }
    return;
  }

  const commits = await gitLog(dir, n);

  if (json) {
    console.log(JSON.stringify(commits, null, 2));
    return;
  }

  // Human-readable
  banner();
  gp.header(`Recent commits — ${dir.split("/").pop()}`);
  gp.blank();

  if (commits.length === 0) {
    gp.warn("No commits yet.");
    return;
  }

  for (const c of commits) {
    const files = `${c.filesChanged} file${c.filesChanged !== 1 ? "s" : ""}`;
    console.log(
      `  ${chalk.dim(c.shortHash)}  ${chalk.white(c.message.padEnd(50))}  ${chalk.dim(c.relativeDate.padEnd(15))}  ${chalk.dim(files)}`
    );
    if (diff) {
      const diffResult = await Bun.$`git -C ${dir} show ${c.hash} --stat --patch --no-color`.quiet().nothrow();
      if (diffResult.exitCode === 0) {
        const diffLines = diffResult.stdout.toString().split("\n");
        // Skip the first commit header lines (up to the diff ----)
        const startIdx = diffLines.findIndex(l => l.startsWith("diff --git") || l.startsWith("---"));
        const relevantLines = startIdx >= 0 ? diffLines.slice(startIdx) : diffLines;
        for (const dl of relevantLines.slice(0, 60)) {
          if (dl.startsWith("+") && !dl.startsWith("+++")) {
            console.log(chalk.green(`     ${dl}`));
          } else if (dl.startsWith("-") && !dl.startsWith("---")) {
            console.log(chalk.red(`     ${dl}`));
          } else if (dl.startsWith("@@")) {
            console.log(chalk.cyan(`     ${dl}`));
          } else {
            console.log(chalk.dim(`     ${dl}`));
          }
        }
        if (relevantLines.length > 60) {
          console.log(chalk.dim(`     ... (${relevantLines.length - 60} more lines)`));
        }
        gp.blank();
      }
    }
  }
  gp.blank();
}

/**
 * `gp diff` — show current uncommitted changes, nicely formatted.
 * Colour-codes additions/removals, groups by file, truncates huge diffs.
 */

import { gp, banner } from "../lib/display.ts";
import { isGitRepo, gitStatus, gitAdd } from "../lib/git.ts";
import chalk from "chalk";

const MAX_LINES_PER_FILE = 80;
const MAX_FILES = 20;

export async function runDiff(dir: string = process.cwd()): Promise<void> {
  if (!(await isGitRepo(dir))) {
    gp.warn("Not a git repo.");
    return;
  }

  const status = await gitStatus(dir);
  if (!status.hasChanges) {
    banner();
    gp.header("Diff — nothing to show");
    gp.blank();
    gp.success("Working directory is clean.");
    gp.blank();
    return;
  }

  // Stage everything so we get a complete diff (unstaged + untracked)
  // Use --intent-to-add for untracked so they show in the diff without committing
  await Bun.$`git -C ${dir} add -N --ignore-removal .`.quiet().nothrow();

  const result = await Bun.$`git -C ${dir} diff`.quiet().nothrow();
  const raw = result.stdout.toString();

  if (!raw.trim()) {
    // Fallback: staged diff
    const staged = await Bun.$`git -C ${dir} diff --cached`.quiet().nothrow();
    const stagedRaw = staged.stdout.toString();
    if (!stagedRaw.trim()) {
      banner();
      gp.header("Diff");
      gp.blank();
      gp.info("Only untracked new files — run `gp push` to commit them.");
      gp.blank();
      return;
    }
    renderDiff(stagedRaw);
    return;
  }

  renderDiff(raw);
}

function renderDiff(raw: string): void {
  banner();
  gp.header("Current changes");

  const lines = raw.split("\n");
  let fileCount = 0;
  let inFile = false;
  let fileLineCount = 0;
  let truncated = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";

    // New file header
    if (line.startsWith("diff --git ")) {
      fileCount++;
      if (fileCount > MAX_FILES) {
        if (!truncated) {
          console.log(chalk.dim(`\n  ... (too many files — showing first ${MAX_FILES})`));
          truncated = true;
        }
        break;
      }
      inFile = true;
      fileLineCount = 0;

      // Extract filename from "diff --git a/foo b/foo"
      const m = line.match(/diff --git a\/(.+) b\/(.+)/);
      const filename = m?.[2] ?? line;
      console.log();
      console.log(chalk.bold.white(`  ── ${filename} ─`));
      continue;
    }

    if (!inFile) continue;

    // Skip git metadata lines
    if (
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ") ||
      line.startsWith("old mode") ||
      line.startsWith("new mode") ||
      line.startsWith("Binary files")
    ) continue;

    // Hunk header
    if (line.startsWith("@@")) {
      const hunkMatch = line.match(/^(@@ .+? @@)(.*)/);
      console.log(chalk.cyan(`  ${hunkMatch?.[1] ?? line}`) + chalk.dim(hunkMatch?.[2] ?? ""));
      continue;
    }

    if (fileLineCount >= MAX_LINES_PER_FILE) {
      if (fileLineCount === MAX_LINES_PER_FILE) {
        console.log(chalk.dim(`    ... (truncated)`));
      }
      fileLineCount++;
      continue;
    }

    fileLineCount++;

    if (line.startsWith("+")) {
      console.log(chalk.green(`  ${line}`));
    } else if (line.startsWith("-")) {
      console.log(chalk.red(`  ${line}`));
    } else {
      console.log(chalk.dim(`  ${line}`));
    }
  }

  console.log();
  console.log(chalk.dim(`  ${fileCount} file(s) changed`));
  console.log();
}

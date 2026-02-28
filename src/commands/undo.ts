import { select, confirm } from "@inquirer/prompts";
import { gitLog, gitSnapshotCommit, gitResetToHash, gitStatus, isGitRepo } from "../lib/git.ts";
import { gp, banner } from "../lib/display.ts";
import chalk from "chalk";

export interface UndoOptions {
  /** Jump directly to this hash — skip interactive picker */
  to?: string;
  /** Restore mode: soft keeps files as uncommitted, hard wipes to that state */
  mode?: "soft" | "hard";
}

export async function runUndo(dir: string = process.cwd(), opts: UndoOptions = {}): Promise<void> {
  const { to: targetHash, mode: forcedMode } = opts;
  const nonInteractive = !!targetHash;
  if (!nonInteractive) {
    banner();
    gp.header("Undo — Restore a Previous Version");
  }

  if (!(await isGitRepo(dir))) {
    gp.warn("This directory isn't a git repo yet. Nothing to undo.");
    gp.info("Run `gp init` to get started.");
    return;
  }

  // ── Load history ────────────────────────────────────────────
  if (!nonInteractive) gp.info("Loading your save history...");
  const commits = await gitLog(dir, 15);

  if (commits.length === 0) {
    if (!nonInteractive) gp.warn("No commits found yet — nothing to restore.");
    return;
  }

  // ── Non-interactive: restore directly to provided hash ──────────────────
  if (nonInteractive && targetHash) {
    const mode = forcedMode ?? "hard";
    gp.info(`Creating safety snapshot before restoring to ${targetHash}...`);
    const snapshotHash = await gitSnapshotCommit(dir);
    gp.info(`Snapshot: ${snapshotHash}`);
    await gitResetToHash(dir, targetHash, mode);
    gp.success(`Restored to ${targetHash} (${mode} reset). Snapshot saved: ${snapshotHash}`);
    return;
  }

  // ── Interactive: show history picker ──────────────────────────────
  gp.blank();
  console.log(chalk.bold("  Your recent saves:"));
  gp.blank();

  const choices = commits.map((c, i) => ({
    name: `${chalk.dim(c.shortHash)}  ${c.message}  ${chalk.dim(c.relativeDate)}  ${chalk.dim(`(${c.filesChanged} file${c.filesChanged !== 1 ? "s" : ""})`)}`,
    value: i,
    short: c.message,
  }));
  choices.push({ name: chalk.dim("Cancel — don't restore anything"), value: -1, short: "Cancel" });

  const chosen = await select({
    message: "Which point do you want to restore to?",
    choices,
    pageSize: 15,
  });

  if (chosen === -1) {
    gp.info("Nothing changed.");
    return;
  }

  const target = commits[chosen];
  if (!target) {
    gp.error("Invalid selection.");
    return;
  }

  // ── Safety snapshot ───────────────────────────────────────────────────────
  gp.blank();
  gp.info("Before restoring, GitPal will save your current state.");
  gp.info("This means you can ALWAYS get back to where you are right now.");
  gp.blank();

  const proceed = await confirm({
    message: `Restore to: "${target.message}" (${target.relativeDate})?`,
    default: true,
  });

  if (!proceed) {
    gp.info("Cancelled. Nothing changed.");
    return;
  }

  // Create safety snapshot
  gp.info("Creating safety snapshot of your current state...");
  const snapshotHash = await gitSnapshotCommit(dir);
  gp.success(`Safety snapshot created (${snapshotHash}) — your current work is saved.`);

  // ── Choose restore mode ───────────────────────────────────────────────────
  gp.blank();
  const mode = await select({
    message: "How do you want to restore?",
    choices: [
      {
        name: "Just look around (soft) — keep all file changes, move history back",
        value: "soft",
        short: "Soft restore",
      },
      {
        name: "Full restore — reset files AND history to that exact point",
        value: "hard",
        short: "Full restore",
      },
    ],
  });

  // ── Execute restore ───────────────────────────────────────────────────────
  gp.info(`Restoring to "${target.message}"...`);
  await gitResetToHash(dir, target.hash, mode as "soft" | "hard");

  // ── Done ─────────────────────────────────────────────────────────────────
  gp.blank();
  gp.success(`Done. Your code is now at: ${target.relativeDate}`);
  console.log(chalk.dim(`  Commit: ${target.shortHash} — ${target.message}`));
  gp.blank();
  gp.info(`Your previous state is saved as snapshot: ${snapshotHash}`);
  gp.info("To get back to where you were before undoing:");
  console.log(`    gp undo   (then pick the safety snapshot from the list)`);
  gp.blank();

  if (mode === "soft") {
    const status = await gitStatus(dir);
    if (status.hasChanges) {
      gp.info(`${status.staged + status.unstaged + status.untracked} file(s) are now uncommitted and available to review.`);
    }
  }
}

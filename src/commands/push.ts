import { confirm } from "@inquirer/prompts";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { gitStatus, gitAdd, gitCommit, gitPush, gitDiff, hasRemote } from "../lib/git.ts";
import { generateCommitMessage, isAIAvailable } from "../lib/ai.ts";
import { loadConfig } from "../lib/config.ts";
import { gp, banner } from "../lib/display.ts";
import chalk from "chalk";
import { hasDeployTarget, runDeploy } from "../lib/deploy.ts";
import { refreshContext } from "../lib/context.ts";

const HOME = homedir();
const QUEUE_FILE = join(HOME, ".gitpal", "push-queue.json");

// ── Offline push queue ─────────────────────────────────────────────────────

interface QueuedPush {
  dir: string;
  queuedAt: string;
}

function loadQueue(): QueuedPush[] {
  if (!existsSync(QUEUE_FILE)) return [];
  try { return JSON.parse(readFileSync(QUEUE_FILE, "utf8")); } catch { return []; }
}

function saveQueue(q: QueuedPush[]): void {
  mkdirSync(join(HOME, ".gitpal"), { recursive: true });
  writeFileSync(QUEUE_FILE, JSON.stringify(q, null, 2));
}

function enqueue(dir: string): void {
  const q = loadQueue().filter(e => e.dir !== dir); // dedupe
  q.push({ dir, queuedAt: new Date().toISOString() });
  saveQueue(q);
}

function dequeue(dir: string): void {
  saveQueue(loadQueue().filter(e => e.dir !== dir));
}

/**
 * Retry push up to maxAttempts with exponential backoff.
 * Detects network errors and queues instead of retrying.
 */
async function pushWithRetry(dir: string, quiet: boolean, maxAttempts = 3): Promise<"ok" | "queued"> {
  let lastErr = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await gitPush(dir);
      dequeue(dir); // clear from queue if it was previously queued
      return "ok";
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      const isNetworkError = /ETIMEDOUT|ENOTFOUND|ECONNREFUSED|Could not resolve|Network is unreachable|Failed to connect|ssh: connect/i.test(lastErr);
      if (isNetworkError) {
        enqueue(dir);
        if (!quiet) gp.warn("No network — push queued. Run `gp push` when back online.");
        return "queued";
      }
      if (attempt < maxAttempts) {
        const delay = attempt * 2000;
        if (!quiet) gp.warn(`Push failed (attempt ${attempt}/${maxAttempts}). Retrying in ${delay / 1000}s...`);
        await Bun.sleep(delay);
      }
    }
  }
  throw new Error(`Push failed after ${maxAttempts} attempts: ${lastErr}`);
}

// ── Exported interface ─────────────────────────────────────────────────────

export interface PushOptions {
  /** Auto-deploy via Docker after push (default: true if docker-compose.yml exists) */
  deploy?: boolean;
  /** Skip the confirm prompt — commit and push immediately */
  yes?: boolean;
  /** Use this commit message instead of AI-generated one */
  message?: string;
  /** Suppress all output (for automated use) */
  quiet?: boolean;
}

export async function runPush(dir: string = process.cwd(), opts: PushOptions = {}): Promise<void> {
  const { yes = false, message: providedMessage, quiet = false } = opts;
  if (!quiet) {
    banner();
    gp.header("Push to GitHub");
  }

  // ── Check for queued pushes from previous offline runs ────────────────────
  if (!quiet) {
    const queue = loadQueue();
    if (queue.length > 0) {
      const inQueue = queue.filter(e => e.dir === dir);
      if (inQueue.length > 0) {
        gp.info("Retrying previously queued push...");
      }
    }
  }

  const hasOrigin = await hasRemote(dir);
  if (!hasOrigin) {
    if (!quiet) {
      gp.warn("This project isn't connected to GitHub yet.");
      gp.info("Run `gp init` first to create a GitHub repo.");
    }
    return;
  }

  // ── Check for changes ─────────────────────────────────────────────────────
  const status = await gitStatus(dir);

  if (!status.hasChanges) {
    const branchResult = await Bun.$`git -C ${dir} branch --show-current`.quiet().nothrow();
    const branch = branchResult.stdout.toString().trim() || "main";
    const unpushed = await Bun.$`git -C ${dir} log origin/${branch}..HEAD --oneline`.quiet().nothrow();
    const unpushedCount = unpushed.stdout.toString().trim().split("\n").filter(Boolean).length;

    if (unpushedCount > 0) {
      if (!quiet) gp.info(`${unpushedCount} local commit(s) not yet on GitHub. Pushing now...`);
      await pushWithRetry(dir, quiet);
      if (!quiet) gp.success("Pushed to GitHub.");
      return;
    }

    if (!quiet) gp.success("Nothing to push — everything is already on GitHub.");
    return;
  }

  // ── Get diff and generate message ─────────────────────────────────────────
  if (!quiet) gp.info("Analyzing changes...");
  await gitAdd(dir);
  const diff = await gitDiff(dir);

  let message: string;
  if (providedMessage) {
    message = providedMessage;
  } else {
    const aiOk = await isAIAvailable();
    if (!quiet && !aiOk) gp.warn("No AI provider available. Using a basic commit message.");
    if (!quiet) gp.info("Generating commit message...");
    message = await generateCommitMessage(diff);
  }

  // ── Preview + confirm (interactive mode only) ─────────────────────────────
  if (!yes) {
    gp.blank();
    console.log(chalk.bold("  Ready to commit and push:"));
    gp.blank();
    console.log(chalk.cyan(`  "${message}"`));
    gp.blank();
    const changed = status.staged + status.unstaged + status.untracked;
    console.log(chalk.dim(`  ${changed} file(s) changed`));
    gp.blank();
    const ok = await confirm({ message: "Looks good? Push to GitHub?", default: true });
    if (!ok) {
      gp.info("Cancelled. Your changes are staged but not committed.");
      gp.info("Run `gp push` again when ready.");
      await Bun.$`git -C ${dir} reset HEAD`.quiet().nothrow();
      return;
    }
  }

  // ── Commit and push ───────────────────────────────────────────────────────
  await gitCommit(dir, message);
  if (!quiet) gp.success(`Committed: "${message}"`);
  if (!quiet) gp.info("Pushing to GitHub...");
  const pushResult = await pushWithRetry(dir, quiet);

  // ── Auto-deploy (only if push succeeded, not queued) ──────────────────────
  const shouldDeploy = opts.deploy !== false && hasDeployTarget(dir) && pushResult === "ok";
  if (shouldDeploy) {
    if (!quiet) gp.info("Deploying...");
    const deploy = await runDeploy(dir);
    if (!quiet) {
      if (deploy.success) gp.success(`Deployed: ${deploy.message}`);
      else if (deploy.ran) gp.warn(`Deploy failed: ${deploy.message}`);
    }
  }

  // ── Refresh context + regenerate README in background ───────────────────
  refreshContext(dir, true).catch(() => { /* non-fatal */ });

  if (!quiet && pushResult === "ok") {
    const config = await loadConfig();
    const hashResult = await Bun.$`git -C ${dir} rev-parse --short HEAD`.quiet().nothrow();
    const hash = hashResult.stdout.toString().trim();
    const repoNameResult = await Bun.$`git -C ${dir} remote get-url origin`.quiet().nothrow();
    const remoteUrl = repoNameResult.stdout.toString().trim();
    const match = remoteUrl.match(/github\.com[:/](.+?)(?:\.git)?$/);
    const repoPath = match?.[1] ?? `${config.github_username}/unknown`;
    gp.blank();
    gp.success("Pushed to GitHub.");
    console.log(chalk.dim(`  https://github.com/${repoPath}/commit/${hash}`));
    gp.blank();
  }
}

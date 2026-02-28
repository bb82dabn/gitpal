/**
 * GitPal Watcher Daemon
 *
 * Spawned as a detached background process by `gp watch start` (or the shell hook).
 * Smart commit triggers:
 *   1. Idle commit     — commit after N seconds of no changes (adaptive: longer during edit bursts)
 *   2. Burst commit    — commit immediately after 10+ files change in <30s (big refactor moment)
 *   3. Build/test pass — commit when bun/pnpm build or test exits 0 after recent changes
 *   4. Broken state    — warn + offer revert if build/lint errors persist 5+ minutes
 *
 * Usage: gp-watcher /path/to/project
 */

import chokidar from "chokidar";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, appendFileSync } from "node:fs";
import { isGitRepo, gitStatus, gitAdd, gitCommit, gitDiff, gitPush, hasRemote } from "./lib/git.ts";
import { generateCommitMessage } from "./lib/ai.ts";
import { refreshContext } from "./lib/context.ts";
import { writeReadme, generateRepoMeta, applyRepoMeta } from "./lib/readme.ts";
import { loadConfig } from "./lib/config.ts";

const dir = resolve(process.argv[2] ?? process.cwd());
let config = await loadConfig(); // module-level so doCommit can access it
const HOME = homedir();
let commitCount = 0; // tracks watcher commits for periodic README refresh
const README_REFRESH_EVERY = 10;
const LOG_FILE = join(HOME, ".gitpal", "log", "gitpal.log");
const QUEUE_FILE = join(HOME, ".gitpal", "push-queue.json");

const ALERT_FILE = join(HOME, ".gitpal", "log", "broken-state.txt");

// ── Tunables ──────────────────────────────────────────────────────────────────
const POLL_INTERVAL       = 15_000;   // how often we check state (ms)
const BURST_THRESHOLD     = 10;       // files changed within BURST_WINDOW triggers immediate commit
const BURST_WINDOW_MS     = 30_000;   // window for burst detection
const BURST_SETTLE_MS     = 5_000;    // wait after burst for writes to settle
const ACTIVE_STREAK_MS    = 120_000;  // if editing for >2min, extend idle window
const BROKEN_GRACE_MS     = 300_000;  // 5 min of persistent errors before alert
const BUILD_CHECK_INTERVAL = 60_000;  // how often to try build check (ms)
// ──────────────────────────────────────────────────────────────────────────────

function log(msg: string): void {
  const ts = new Date().toISOString().replace("T", " ").substring(0, 19);
  const line = `[${ts}] [${dir.split("/").pop()}] ${msg}\n`;
  try {
    mkdirSync(join(HOME, ".gitpal", "log"), { recursive: true });
    const existing = existsSync(LOG_FILE) ? Bun.file(LOG_FILE).text() : Promise.resolve("");
    existing.then((text) => Bun.write(LOG_FILE, text + line)).catch(() => {});
  } catch { /* non-fatal */ }
}

/** Detect which build/test command this project uses */
function detectBuildCmd(projectDir: string): string[] | null {
  if (existsSync(join(projectDir, "package.json"))) {
    try {
      const pkg = JSON.parse(Bun.file(join(projectDir, "package.json")).toString()) as Record<string, unknown>;
      const scripts = pkg["scripts"] as Record<string, string> ?? {};
      // Prefer: typecheck > build > test (in that order — fastest feedback)
      const manager = existsSync(join(projectDir, "bun.lockb")) ? "bun" : "pnpm";
      if (scripts["typecheck"]) return [manager, "run", "typecheck"];
      if (scripts["check"])     return [manager, "run", "check"];
      if (scripts["build"])     return [manager, "run", "build"];
      if (scripts["test"])      return [manager, "run", "test", "--run"];
    } catch { /* ok */ }
  }
  if (existsSync(join(projectDir, "Cargo.toml"))) return ["cargo", "check"];
  if (existsSync(join(projectDir, "go.mod")))     return ["go", "build", "./..."];
  return null;
}

/** Run build/check command. Returns true if it exits 0. */
async function runBuildCheck(projectDir: string): Promise<boolean> {
  const cmd = detectBuildCmd(projectDir);
  if (!cmd) return false; // no build command detected
  try {
    const [prog, ...args] = cmd;
    const result = await Bun.spawn([prog!, ...args], {
      cwd: projectDir,
      stdout: "ignore",
      stderr: "ignore",
    }).exited;
    return result === 0;
  } catch {
    return false;
  }
}

// ── Push queue helpers (mirrors push.ts — keep in sync) ──────────────────────

interface QueuedPush { dir: string; queuedAt: string; }

function loadQueue(): QueuedPush[] {
  if (!existsSync(QUEUE_FILE)) return [];
  try { return JSON.parse(readFileSync(QUEUE_FILE, "utf8")); } catch { return []; }
}
function saveQueue(q: QueuedPush[]): void {
  mkdirSync(join(HOME, ".gitpal"), { recursive: true });
  writeFileSync(QUEUE_FILE, JSON.stringify(q, null, 2));
}
function dequeue(d: string): void { saveQueue(loadQueue().filter(e => e.dir !== d)); }
function enqueue(d: string): void {
  const q = loadQueue().filter(e => e.dir !== d);
  q.push({ dir: d, queuedAt: new Date().toISOString() });
  saveQueue(q);
}

/** Try to push queued entries. Silent — called from poll loop. */
async function drainQueue(): Promise<void> {
  const queue = loadQueue();
  if (queue.length === 0) return;
  for (const entry of queue) {
    try {
      const branchR = await Bun.$`git -C ${entry.dir} branch --show-current`.quiet().nothrow();
      const branch = branchR.stdout.toString().trim() || "main";
      await Bun.$`git -C ${entry.dir} push -u origin ${branch}`.quiet();
      dequeue(entry.dir);
      log(`Queue drain: pushed ${entry.dir.split("/").pop()}`);
    } catch { /* still offline — leave in queue */ }
  }
}

async function doCommit(reason: string): Promise<void> {
  const status = await gitStatus(dir);
  if (!status.hasChanges) return;

  log(`Committing (${reason})...`);
  await gitAdd(dir);
  const diff = await gitDiff(dir);
  const message = await generateCommitMessage(diff);
  await gitCommit(dir, message);
  log(`Committed: "${message}" [${reason}]`);

  // Append to per-project commit history
  try {
    const historyFile = join(dir, ".gp", "commit-history.md");
    const ts = new Date().toISOString().replace("T", " ").substring(0, 19);
    mkdirSync(join(dir, ".gp"), { recursive: true });
    appendFileSync(historyFile, `- ${ts} \u2014 ${message}\n`);
  } catch { /* non-fatal */ }

  // Refresh context + periodic README regen in background
  refreshContext(dir, true).catch(() => { /* non-fatal */ });
  commitCount++;
  if (commitCount % README_REFRESH_EVERY === 0) {
    log(`README refresh triggered (every ${README_REFRESH_EVERY} commits)`);
    writeReadme(dir).then(async () => {
      const config2 = await loadConfig();
      const name = dir.split("/").pop() ?? "";
      const meta = await generateRepoMeta(dir);
      await applyRepoMeta(`${config2.github_username}/${name}`, meta);
    }).catch(() => { /* non-fatal */ });
  }

  // Auto-push if enabled and project has a remote
  if (config.auto_push && (await hasRemote(dir))) {
    try {
      await gitPush(dir);
      dequeue(dir); // clear from offline queue if previously queued
      log(`Auto-pushed to GitHub`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isNetwork = /ETIMEDOUT|ENOTFOUND|ECONNREFUSED|Could not resolve|Network is unreachable|Failed to connect|ssh: connect/i.test(msg);
      if (isNetwork) {
        enqueue(dir);
        log(`Auto-push offline — queued for retry`);
      } else {
        log(`Auto-push failed (non-fatal): ${msg}`);
      }
    }
  }
}  // end doCommit

async function main() {
  if (!dir) {
    console.error("Usage: gp-watcher <project-dir>");
    process.exit(1);
  }

  if (!(await isGitRepo(dir))) {
    log("Not a git repo — exiting.");
    process.exit(0);
  }

  config = await loadConfig(); // reload in case it changed on disk
  const baseIdleMs = config.idle_seconds * 1000;

  // State
  let lastChangeTime  = 0;
  let editStreakStart = 0;   // when the current editing streak began
  let hasChanges      = false;
  let committing      = false;
  let burstFiles      = 0;
  let burstWindowStart = 0;
  let lastBuildPass   = 0;   // timestamp of last successful build
  let firstBrokenAt   = 0;   // timestamp when errors first detected
  let alertedBroken   = false;
  let lastBuildCheck  = 0;
  let lastQueueDrain  = 0;  // for periodic offline-queue drain

  log(`Watcher started. Base idle: ${config.idle_seconds}s. Smart triggers: burst, build-pass, broken-state.`);

  // ── File watcher ────────────────────────────────────────────────────────────
  // Build ignore list: hardcoded patterns + entries from project's .gitignore
  const hardcodedIgnore: (RegExp | string)[] = [
    /node_modules/,
    /\.git/,
    /dist\//,
    /build\//,
    /\.cache/,
    /\.log$/,
    /\.next\//,
    /\.nuxt\//,
    /__pycache__/,
    /\.pytest_cache/,
    /target\//,           // Rust/Java
    /\.turbo\//,
    /coverage\//,
    // Runtime data / browser session dirs (common culprits for inotify exhaustion)
    /fb-session/,
    /Default\/Cache/,
    /Cache_Data/,
    /\/data\/.*\/Cache/,
    /\.local\/share/,
  ];

  // Read .gitignore and .gp/ignore for project-specific patterns
  const gitignorePath = join(dir, ".gitignore");
  const gpIgnorePath  = join(dir, ".gp", "ignore");
  const extraIgnore: string[] = [];

  for (const ignorePath of [gitignorePath, gpIgnorePath]) {
    if (!existsSync(ignorePath)) continue;
    try {
      const lines = readFileSync(ignorePath, "utf8").split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        // Convert to absolute-path substring chokidar can match
        extraIgnore.push(join(dir, "**", trimmed));
      }
    } catch { /* ok */ }
  }

  // Build a function-based ignore so chokidar evaluates each path BEFORE
  // opening inotify watches — prevents EINVAL/ENOSPC on unreadable dirs.
  const ignoredFn = (filePath: string): boolean => {
    for (const pattern of hardcodedIgnore) {
      if (typeof pattern === "string" ? filePath.includes(pattern) : pattern.test(filePath)) return true;
    }
    for (const glob of extraIgnore) {
      // Simple substring check — good enough for gitignore entries
      const seg = glob.replace(/^.*\*\*\//, "");
      if (filePath.includes(seg)) return true;
    }
    return false;
  };

  const watcher = chokidar.watch(dir, {
    ignored: ignoredFn,
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
  });

  watcher.on("all", (_event, _filePath) => {
    const now = Date.now();
    lastChangeTime = now;
    hasChanges = true;

    // Track editing streak (for adaptive idle window)
    if (editStreakStart === 0) editStreakStart = now;

    // Burst detection
    if (now - burstWindowStart > BURST_WINDOW_MS) {
      // Reset burst window
      burstFiles = 1;
      burstWindowStart = now;
    } else {
      burstFiles++;
    }
  });

  watcher.on("error", (err) => log(`Watcher error: ${err}`));

  // ── Main poll loop ───────────────────────────────────────────────────────────
  const pollTimer = setInterval(async () => {
    if (committing) return;
    const now = Date.now();

    // ── Queue drain: retry any offline-queued pushes every 2 minutes ──────────
    if (now - lastQueueDrain > 120_000) {
      lastQueueDrain = now;
      drainQueue().catch(() => { /* silent */ });
    }

    // ── Trigger 2: Burst commit ──────────────────────────────────────────────
    // 10+ files changed within 30s → this is a big refactor moment. Commit it
    // after a brief settle period.
    if (
      hasChanges &&
      burstFiles >= BURST_THRESHOLD &&
      now - burstWindowStart > BURST_SETTLE_MS &&  // wait for writes to settle
      now - lastChangeTime > BURST_SETTLE_MS        // no new changes in last 5s
    ) {
      committing = true;
      burstFiles = 0;
      editStreakStart = 0;
      try {
        await doCommit(`burst:${burstFiles}-files`);
        hasChanges = false;
        firstBrokenAt = 0;
        alertedBroken = false;
      } catch (err) {
        log(`Burst commit failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        committing = false;
      }
      return;
    }

    // ── Trigger 3: Build/test pass commit ────────────────────────────────────
    // Run build check periodically when there are uncommitted changes.
    // If it passes, commit immediately — this is a known-good state.
    if (
      hasChanges &&
      now - lastBuildCheck > BUILD_CHECK_INTERVAL &&
      now - lastChangeTime > 10_000  // wait 10s after last change before checking
    ) {
      lastBuildCheck = now;
      const passed = await runBuildCheck(dir);

      if (passed) {
        log("Build/typecheck passed — committing clean state.");
        committing = true;
        try {
          await doCommit("build-pass");
          hasChanges = false;
          lastBuildPass = now;
          firstBrokenAt = 0;
          alertedBroken = false;
        } catch (err) {
          log(`Build-pass commit failed: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
          committing = false;
        }
        return;
      } else if (hasChanges) {
        // Build is failing. Start broken-state timer.
        if (firstBrokenAt === 0) firstBrokenAt = now;
      }
    }

    // ── Trigger 4: Broken state alert ────────────────────────────────────────
    // Build has been broken for 5+ minutes. Write a notification file so the
    // user's terminal (or any UI polling it) can surface the warning.
    if (
      firstBrokenAt > 0 &&
      !alertedBroken &&
      now - firstBrokenAt > BROKEN_GRACE_MS
    ) {
      alertedBroken = true;
      const msg = `[GitPal] Build has been failing in ${dir.split("/").pop()} for ${Math.round((now - firstBrokenAt) / 60000)} minutes. Run \`gp undo\` to restore last clean state.`;
      log(`ALERT: ${msg}`);
      try {
        mkdirSync(join(HOME, ".gitpal", "log"), { recursive: true });
        writeFileSync(ALERT_FILE, msg + "\n");
      } catch { /* ok */ }
    }

    // ── Trigger 1: Adaptive idle commit ──────────────────────────────────────
    if (!hasChanges || committing) return;

    const idle = now - lastChangeTime;
    const streakDuration = editStreakStart > 0 ? now - editStreakStart : 0;

    // If we've been in an active editing streak for >2min, extend idle window to 5min
    // so we don't chop up a long coding session into micro-commits.
    const idleMs = streakDuration > ACTIVE_STREAK_MS
      ? Math.max(baseIdleMs, 300_000)   // at least 5 min during a streak
      : baseIdleMs;

    if (idle < idleMs) return;

    // Idle threshold reached
    committing = true;
    editStreakStart = 0;
    try {
      await doCommit(`idle:${Math.round(idle / 1000)}s`);
      hasChanges = false;
      firstBrokenAt = 0;
      alertedBroken = false;
    } catch (err) {
      log(`Idle commit failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      committing = false;
    }
  }, POLL_INTERVAL);

  // ── Graceful shutdown ────────────────────────────────────────────────────────
  process.on("SIGTERM", () => {
    log("Watcher stopping (SIGTERM).");
    clearInterval(pollTimer);
    watcher.close();
    process.exit(0);
  });

  process.on("SIGINT", () => {
    log("Watcher stopping (SIGINT).");
    clearInterval(pollTimer);
    watcher.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Watcher daemon error:", err);
  process.exit(1);
});

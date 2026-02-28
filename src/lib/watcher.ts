import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { isGitRepo, gitStatus, gitAdd, gitCommit, gitDiff } from "./git.ts";
import { generateCommitMessage } from "./ai.ts";
import { loadConfig } from "./config.ts";

const SESSIONS_DIR = join(homedir(), ".gitpal", "sessions");
const LOG_FILE = join(homedir(), ".gitpal", "log", "gitpal.log");

function log(msg: string): void {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}\n`;
  try {
    const dir = join(homedir(), ".gitpal", "log");
    mkdirSync(dir, { recursive: true });
    // Append to log
    const existing = existsSync(LOG_FILE) ? readFileSync(LOG_FILE, "utf8") : "";
    writeFileSync(LOG_FILE, existing + line);
  } catch { /* log failures are non-fatal */ }
}

function slugify(dir: string): string {
  return dir.replace(/[^a-zA-Z0-9]/g, "_").replace(/_+/g, "_").slice(-40);
}

function pidFile(dir: string): string {
  return join(SESSIONS_DIR, `${slugify(dir)}.pid`);
}

function dirFile(dir: string): string {
  return join(SESSIONS_DIR, `${slugify(dir)}.dir`);
}

export function isWatcherRunning(dir: string): boolean {
  const pf = pidFile(dir);
  if (!existsSync(pf)) return false;
  try {
    const pid = parseInt(readFileSync(pf, "utf8"), 10);
    // kill -0 checks if process exists without sending a signal
    const result = Bun.spawnSync(["kill", "-0", String(pid)]);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

export function stopWatcher(dir: string): boolean {
  const pf = pidFile(dir);
  if (!existsSync(pf)) return false;
  try {
    const pid = parseInt(readFileSync(pf, "utf8"), 10);
    process.kill(pid, "SIGTERM");
    // Clean up files
    try { Bun.spawnSync(["rm", "-f", pf, dirFile(dir)]); } catch { /* ok */ }
    return true;
  } catch {
    return false;
  }
}

/** Spawn a detached watcher daemon for `dir`. Returns the daemon PID. */
export async function startWatcher(dir: string): Promise<number> {
  mkdirSync(SESSIONS_DIR, { recursive: true });

  // Use compiled binary if available, fall back to bun run for dev
  const binaryPath = join(homedir(), ".local", "bin", "gp-watcher");
  const daemonBin = Bun.spawnSync(["test", "-x", binaryPath]).exitCode === 0
    ? binaryPath
    : null;
  const cmd = daemonBin
    ? [daemonBin, dir]
    : ["bun", "run", join(import.meta.dir, "../watcher-daemon.ts"), dir];
  const proc = Bun.spawn(cmd, {
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
    env: { ...process.env },
  });

  const pid = proc.pid;
  writeFileSync(pidFile(dir), String(pid));
  writeFileSync(dirFile(dir), dir);
  proc.unref();

  return pid;
}

/** Run a single watcher tick (for use inside the daemon). */
export async function watcherTick(dir: string, lastChangeTime: { value: number }, hasChanges: { value: boolean }): Promise<void> {
  try {
    if (!await isGitRepo(dir)) return;

    const status = await gitStatus(dir);
    if (status.hasChanges) {
      hasChanges.value = true;
      lastChangeTime.value = Date.now();
    }

    const config = await loadConfig();
    const idleMs = config.idle_seconds * 1000;
    const idle = Date.now() - lastChangeTime.value;

    if (hasChanges.value && idle >= idleMs) {
      log(`[${dir}] Idle threshold reached. Auto-committing...`);
      await gitAdd(dir);
      const diff = await gitDiff(dir);
      const message = await generateCommitMessage(diff);
      await gitCommit(dir, message);
      hasChanges.value = false;
      log(`[${dir}] Auto-committed: "${message}"`);
    }
  } catch (err) {
    log(`[${dir}] Error in watcher tick: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── Projects-root watcher (watches ~/projects for new dirs) ─────────────────

const PROJECTS_PID_FILE = join(homedir(), ".gitpal", "sessions", "_projects-watcher.pid");

export function isProjectsWatcherRunning(): boolean {
  if (!existsSync(PROJECTS_PID_FILE)) return false;
  try {
    const pid = parseInt(readFileSync(PROJECTS_PID_FILE, "utf8"), 10);
    const result = Bun.spawnSync(["kill", "-0", String(pid)]);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

export function stopProjectsWatcher(): boolean {
  if (!existsSync(PROJECTS_PID_FILE)) return false;
  try {
    const pid = parseInt(readFileSync(PROJECTS_PID_FILE, "utf8"), 10);
    process.kill(pid, "SIGTERM");
    try { Bun.spawnSync(["rm", "-f", PROJECTS_PID_FILE]); } catch { /* ok */ }
    return true;
  } catch {
    return false;
  }
}

export async function startProjectsWatcher(): Promise<number> {
  mkdirSync(SESSIONS_DIR, { recursive: true });
  const binaryPath = join(homedir(), ".local", "bin", "gp-projects-watcher");
  const daemonBin = Bun.spawnSync(["test", "-x", binaryPath]).exitCode === 0
    ? binaryPath
    : null;
  const cmd = daemonBin
    ? [daemonBin]
    : ["bun", "run", join(import.meta.dir, "../projects-watcher-daemon.ts")];
  const proc = Bun.spawn(cmd, {
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
    env: { ...process.env },
  });
  const pid = proc.pid;
  writeFileSync(PROJECTS_PID_FILE, String(pid));
  proc.unref();
  return pid;
}

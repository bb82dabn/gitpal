#!/usr/bin/env bun
/**
 * GitPal Projects Directory Watcher Daemon
 *
 * Watches ~/projects for new subdirectories. Existing Git repositories get
 * a per-project watcher. Uninitialized directories are left untouched so
 * files can be reviewed before an explicit `gp init` publishes anything.
 *
 * Usage: spawned by `gp watch projects`, do not run directly.
 */

import chokidar from "chokidar";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { loadConfig } from "./lib/config.ts";
import { startWatcher, isWatcherRunning } from "./lib/watcher.ts";

const HOME = homedir();
const LOG_FILE = join(HOME, ".gitpal", "log", "projects-watcher.log");
const PID_FILE = join(HOME, ".gitpal", "sessions", "_projects-watcher.pid");

function log(msg: string): void {
  const ts = new Date().toISOString().replace("T", " ").substring(0, 19);
  const line = `[${ts}] ${msg}\n`;
  try {
    mkdirSync(join(HOME, ".gitpal", "log"), { recursive: true });
    const existing = existsSync(LOG_FILE) ? Bun.file(LOG_FILE).text() : Promise.resolve("");
    existing.then((t) => Bun.write(LOG_FILE, t + line)).catch(() => {});
  } catch { /* non-fatal */ }
}

function countFiles(dir: string, depth = 0): number {
  if (depth > 3) return 0;
  try {
    let count = 0;
    for (const entry of readdirSync(dir)) {
      if (["node_modules", ".git", "dist", "build", ".cache", "__pycache__", "venv", ".next"].includes(entry)) continue;
      try {
        const stat = statSync(join(dir, entry));
        if (stat.isFile()) count++;
        else if (stat.isDirectory()) count += countFiles(join(dir, entry), depth + 1);
        if (count >= 1) return count; // short-circuit — we just need to know it's non-empty
      } catch { /* skip */ }
    }
    return count;
  } catch { return 0; }
}

function isGitRepo(dir: string): boolean {
  return existsSync(join(dir, ".git"));
}

/** Wait up to maxMs for dir to have at least 1 file */
async function waitForFile(dir: string, maxMs = 10_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (countFiles(dir) >= 1) return true;
    await Bun.sleep(500);
  }
  return false;
}

async function initProject(dir: string): Promise<void> {
  const name = basename(dir);
  log(`New project detected: ${name}`);

  const hasFiles = await waitForFile(dir);
  if (!hasFiles) {
    log(`${name}: no files appeared after 10s, skipping`);
    return;
  }

  if (!isGitRepo(dir)) {
    log(`${name}: uninitialized directory skipped; run 'gp init' from the project to review files before publishing`);
    return;
  }

  if (!isWatcherRunning(dir)) {
    await startWatcher(dir);
    log(`${name}: file watcher started`);
  }
}

// Track dirs we've already processed to avoid double-triggering
const processed = new Set<string>();

// Pre-populate with existing dirs so we only react to truly NEW ones.
function seedExisting(projectsDir: string): void {
  try {
    const entries = readdirSync(projectsDir);
    for (const entry of entries) {
      if (entry.startsWith(".")) continue;
      const full = join(projectsDir, entry);
      try {
        if (!statSync(full).isDirectory()) continue;
        processed.add(full);
      } catch { /* skip */ }
    }
  } catch { /* ok */ }
}

async function main(): Promise<void> {
  const config = await loadConfig();

  // Derive the projects root dirs from watch_patterns (strip the trailing /*)
  const watchRoots = config.watch_patterns
    .map((p) => p.replace("~", HOME).replace(/\/\*$/, ""))
    .filter((p) => existsSync(p));

  if (watchRoots.length === 0) {
    log("No watch roots found — check watch_patterns in ~/.gitpal/config.json");
    process.exit(1);
  }

  // Save PID
  mkdirSync(join(HOME, ".gitpal", "sessions"), { recursive: true });
  writeFileSync(PID_FILE, String(process.pid));

  log(`Projects watcher started. Monitoring: ${watchRoots.join(", ")}`);

  // Seed existing dirs so only newly created directories trigger handling
  for (const root of watchRoots) {
    seedExisting(root);
  }

  // Watch each root for new subdirectories
  const watcher = chokidar.watch(watchRoots, {
    depth: 0,          // Only watch the root level — don't recurse into projects
    ignoreInitial: true,
    persistent: true,
  });

  // ── Watcher watchdog: restart dead per-project watchers every 60s ─────────
  const SESSIONS_DIR = join(HOME, ".gitpal", "sessions");
  setInterval(async () => {
    for (const root of watchRoots) {
      let entries: string[];
      try { entries = readdirSync(root); } catch { continue; }
      for (const entry of entries) {
        if (entry.startsWith(".")) continue;
        const projectDir = join(root, entry);
        try { if (!statSync(projectDir).isDirectory()) continue; } catch { continue; }
        const pidFile = join(SESSIONS_DIR, `${entry}.pid`);
        if (!existsSync(pidFile)) continue; // was never started by GitPal, skip
        try {
          const pid = parseInt(readFileSync(pidFile, "utf8").trim(), 10);
          const alive = await Bun.$`kill -0 ${pid}`.quiet().nothrow();
          if (alive.exitCode !== 0) {
            log(`Watchdog: ${entry} watcher dead (PID ${pid}) — restarting`);
            await startWatcher(projectDir);
          }
        } catch { /* ok */ }
      }
    }
  }, 60_000);

  watcher.on("addDir", (dirPath) => {
    // Only care about immediate children of the watch roots
    const parent = dirPath.substring(0, dirPath.lastIndexOf("/"));
    if (!watchRoots.includes(parent)) return;
    if (processed.has(dirPath)) return;

    processed.add(dirPath);
    // Run async without blocking the watcher
    initProject(dirPath).catch((err) => {
      log(`Error initializing ${dirPath}: ${err instanceof Error ? err.message : String(err)}`);
    });
  });

  watcher.on("error", (err) => log(`Watcher error: ${err}`));

  // Graceful shutdown
  process.on("SIGTERM", () => {
    log("Projects watcher stopping.");
    try { Bun.spawnSync(["rm", "-f", PID_FILE]); } catch { /* ok */ }
    watcher.close();
    process.exit(0);
  });

  process.on("SIGINT", () => {
    log("Projects watcher stopping.");
    try { Bun.spawnSync(["rm", "-f", PID_FILE]); } catch { /* ok */ }
    watcher.close();
    process.exit(0);
  });
}

main().catch((err) => {
  log(`Fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});

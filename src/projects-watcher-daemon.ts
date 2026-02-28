#!/usr/bin/env bun
/**
 * GitPal Projects Directory Watcher Daemon
 *
 * Watches ~/projects for new subdirectories. When a new folder appears
 * with at least 1 file, automatically:
 *   1. git init
 *   2. git add -A && git commit -m "Initial commit"
 *   3. gh repo create (private) + push
 *   4. Start the per-project file watcher daemon
 *
 * Usage: spawned by `gp watch projects` — do not run directly.
 */

import chokidar from "chokidar";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { loadConfig } from "./lib/config.ts";
import { startWatcher, isWatcherRunning } from "./lib/watcher.ts";
import { writeReadme, generateRepoMeta, applyRepoMeta } from "./lib/readme.ts";

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

function countFiles(dir: string): number {
  try {
    return readdirSync(dir).filter((f) => {
      try {
        return statSync(join(dir, f)).isFile();
      } catch { return false; }
    }).length;
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

  // Wait for at least 1 file to appear (up to 10s)
  const hasFiles = await waitForFile(dir);
  if (!hasFiles) {
    log(`${name}: no files appeared after 10s — skipping`);
    return;
  }

  const config = await loadConfig();

  // ── 1. git init ───────────────────────────────────────────────────────────
  if (!isGitRepo(dir)) {
    log(`${name}: git init`);
    const r = await Bun.$`git -C ${dir} init -q`.quiet().nothrow();
    if (r.exitCode !== 0) {
      log(`${name}: git init failed — ${r.stderr.toString().trim()}`);
      return;
    }

    // Write a .gitignore
    const gitignore = join(dir, ".gitignore");
    if (!existsSync(gitignore)) {
      writeFileSync(gitignore, ".env\n.env.local\nnode_modules/\ndist/\nbuild/\n.DS_Store\n*.log\n");
    }
  }

  // -- 2. Generate README
  log(`${name}: generating README`);
  await writeReadme(dir).catch(() => {
    log(`${name}: README generation failed (non-fatal)`);
  });

  // -- 3. Initial commit (includes README)
  log(`${name}: initial commit`);
  await Bun.$`git -C ${dir} add -A`.quiet().nothrow();
  const commit = await Bun.$`git -C ${dir} commit -q -m "Initial commit"`.quiet().nothrow();
  if (commit.exitCode !== 0 && !commit.stderr.toString().includes("nothing to commit")) {
    log(`${name}: commit failed -- ${commit.stderr.toString().trim()}`);
  }

  // ── 3. GitHub repo creation ───────────────────────────────────────────────
  const ghCheck = await Bun.$`gh auth status`.quiet().nothrow();
  if (ghCheck.exitCode !== 0) {
    log(`${name}: gh not authenticated — skipping GitHub creation. Run 'gp setup'.`);
    // Still start the local watcher
  } else {
    const fullName = `${config.github_username}/${name}`;
    log(`${name}: creating GitHub repo ${fullName}`);
    const create = await Bun.$`gh repo create ${fullName} --private --source=${dir} --remote=origin --push`.quiet().nothrow();
    if (create.exitCode !== 0) {
      const errMsg = create.stderr.toString().trim();
      if (errMsg.includes("already exists")) {
        log(`${name}: repo already exists on GitHub — connecting remote`);
        await Bun.$`git -C ${dir} remote add origin https://github.com/${fullName}.git`.quiet().nothrow();
        await Bun.$`git -C ${dir} push -u origin HEAD`.quiet().nothrow();
      } else {
        log(`${name}: GitHub creation failed — ${errMsg}`);
      }
    } else {
      log(`${name}: live at https://github.com/${fullName}`);
    }
  }

  // ── 5. Set GitHub repo metadata (description, topics, homepage) ────────────
  const fullNameForMeta = `${config.github_username}/${name}`;
  try {
    const meta = await generateRepoMeta(dir);
    await applyRepoMeta(fullNameForMeta, meta);
    log(`${name}: GitHub metadata set — ${meta.topics.length} topics`);
  } catch (err) {
    log(`${name}: metadata set failed (non-fatal) — ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── 4. Start per-project watcher + register systemd service ───────────────
  if (!isWatcherRunning(dir)) {
    await startWatcher(dir);
    log(`${name}: file watcher started`);
  }

  // Enable systemd user service so the watcher survives reboots
  const enableResult = await Bun.$`systemctl --user enable --now ${'gp-watcher@' + name + '.service'}`.quiet().nothrow();
  if (enableResult.exitCode === 0) {
    log(`${name}: systemd service enabled (survives reboots)`);
  } else {
    log(`${name}: systemd enable failed (non-fatal) — ${enableResult.stderr.toString().trim()}`);
  }

  log(`${name}: fully set up`);
}

// Track dirs we've already processed to avoid double-triggering
const processed = new Set<string>();

// Pre-populate with existing dirs so we only react to truly NEW ones
function seedExisting(projectsDir: string): void {
  try {
    const entries = readdirSync(projectsDir);
    for (const entry of entries) {
      const full = join(projectsDir, entry);
      try {
        if (statSync(full).isDirectory()) {
          processed.add(full);
        }
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

  // Seed existing dirs so we don't re-init them on startup
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

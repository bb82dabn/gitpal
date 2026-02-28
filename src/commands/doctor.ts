/**
 * `gp doctor` — full system health check.
 * Checks: disk, memory, Ollama, Docker containers, uncommitted work, watcher status.
 */

import { existsSync, readdirSync, statSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { loadConfig } from "../lib/config.ts";
import { isOllamaRunning, isAIAvailable } from "../lib/ai.ts";
import { gitStatus, isGitRepo, hasRemote } from "../lib/git.ts";
import { gp, banner } from "../lib/display.ts";
import chalk from "chalk";

const HOME = homedir();

// ── Helpers ───────────────────────────────────────────────────────────────────

function pass(label: string, detail = "") {
  console.log(`  ${chalk.green("✓")}  ${label.padEnd(36)} ${chalk.dim(detail)}`);
}
function warn(label: string, detail = "") {
  console.log(`  ${chalk.yellow("⚠")}  ${label.padEnd(36)} ${chalk.yellow(detail)}`);
}
function fail(label: string, detail = "") {
  console.log(`  ${chalk.red("✗")}  ${label.padEnd(36)} ${chalk.red(detail)}`);
}
function section(title: string) {
  console.log();
  console.log(chalk.bold.dim(`  ── ${title} ─`));
}

// ── Checks ────────────────────────────────────────────────────────────────────

async function checkDisk(): Promise<boolean> {
  try {
    const r = await Bun.$`df -h /`.quiet().nothrow();
    const line = r.stdout.toString().split("\n")[1] ?? "";
    const pctMatch = line.match(/(\d+)%/);
    const pct = parseInt(pctMatch?.[1] ?? "0");
    const parts = line.split(/\s+/);
    const avail = parts[3] ?? "?";
    if (pct >= 95) { fail("Disk space", `${pct}% used — ${avail} free — CRITICAL`); return false; }
    if (pct >= 85) { warn("Disk space", `${pct}% used — ${avail} free`); return true; }
    pass("Disk space", `${pct}% used — ${avail} free`);
    return true;
  } catch { warn("Disk space", "could not check"); return true; }
}

async function checkMemory(): Promise<boolean> {
  try {
    const r = await Bun.$`free -h`.quiet().nothrow();
    const lines = r.stdout.toString().split("\n");
    const swapLine = lines.find(l => l.startsWith("Swap:")) ?? "";
    const memLine  = lines.find(l => l.startsWith("Mem:"))  ?? "";
    const swapParts = swapLine.split(/\s+/);
    const memParts  = memLine.split(/\s+/);
    const swapFree = swapParts[3] ?? "?";
    const memAvail = memParts[6] ?? "?";

    // Warn if swap is >90% full
    const swapTotal = parseFloat(swapParts[1] ?? "0");
    const swapUsed  = parseFloat(swapParts[2] ?? "0");
    if (swapTotal > 0 && swapUsed / swapTotal > 0.9) {
      warn("Memory / Swap", `Swap nearly full — ${swapFree} free. RAM avail: ${memAvail}`);
    } else {
      pass("Memory", `${memAvail} RAM available`);
    }
    return true;
  } catch { warn("Memory", "could not check"); return true; }
}

async function checkOllama(): Promise<boolean> {
  const config = await loadConfig();
  const provider = config.ai_provider === "openai" && config.openai_api_key ? "OpenAI" : "Ollama";
  const available = await isAIAvailable();
  if (available) { pass(provider, `connected — AI commit messages active (${config.ai_provider === "openai" ? config.openai_model : config.ollama_model})`); return true; }
  warn(provider, provider === "OpenAI" ? "unreachable — check openai_api_key in ~/.gitpal/config.json" : "not running — AI features disabled. Run: ollama serve");
  return false;
}

async function checkDocker(): Promise<boolean> {
  const r = await Bun.$`docker ps --format "{{.Names}}|{{.Status}}"`.quiet().nothrow();
  if (r.exitCode !== 0) { warn("Docker", "docker not running or not installed"); return false; }

  const lines = r.stdout.toString().trim().split("\n").filter(Boolean);
  if (lines.length === 0) { pass("Docker", "running — no containers active"); return true; }

  const unhealthy = lines.filter(l => l.includes("unhealthy") || l.includes("Restarting"));
  const healthy   = lines.filter(l => l.includes("healthy") || l.includes("Up"));

  if (unhealthy.length > 0) {
    warn("Docker", `${healthy.length} healthy, ${unhealthy.length} unhealthy:`);
    for (const c of unhealthy) {
      const [name, status] = c.split("|");
      console.log(`       ${chalk.red("→")} ${name} — ${chalk.red(status)}`);
    }
    return false;
  }
  pass("Docker", `${lines.length} container(s) running`);
  return true;
}

async function checkProjects(): Promise<void> {
  const config = await loadConfig();
  if (config.watch_patterns.length === 0) return;

  const home = homedir();
  const dirs: string[] = [];
  for (const pattern of config.watch_patterns) {
    const expanded = pattern.replace("~", home);
    const base = expanded.replace(/\/\*$/, "");
    try {
      for (const entry of readdirSync(base)) {
        if (entry.startsWith(".")) continue;
        const full = join(base, entry);
        if (statSync(full).isDirectory()) dirs.push(full);
      }
    } catch { /* ok */ }
  }

  let dirty = 0;
  let noGithub = 0;
  const dirtyProjects: string[] = [];

  for (const dir of dirs) {
    if (!(await isGitRepo(dir))) { noGithub++; continue; }
    const [status, remote] = await Promise.all([gitStatus(dir), hasRemote(dir)]);
    if (!remote) noGithub++;
    if (status.hasChanges) { dirty++; dirtyProjects.push(dir.split("/").pop() ?? dir); }
  }

  if (dirty === 0) {
    pass("Uncommitted work", "all projects clean");
  } else {
    warn("Uncommitted work", `${dirty} project(s) have unsaved changes: ${dirtyProjects.slice(0,3).join(", ")}${dirty > 3 ? "…" : ""}`);
  }

  if (noGithub > 0) {
    warn("GitHub", `${noGithub} project(s) not connected — run \`gp init\` inside them`);
  } else {
    pass("GitHub", "all projects connected");
  }
}

async function checkWatcher(): Promise<void> {
  const pidFile = join(HOME, ".gitpal", "sessions", "_projects-watcher.pid");
  if (!existsSync(pidFile)) { warn("Projects watcher", "not running — run: gp watch projects"); return; }
  try {
    const pid = parseInt(await Bun.file(pidFile).text(), 10);
    const alive = await Bun.$`kill -0 ${pid}`.quiet().nothrow();
    if (alive.exitCode === 0) { pass("Projects watcher", `running (PID ${pid})`); }
    else { warn("Projects watcher", "PID file exists but process is dead — run: gp watch projects"); }
  } catch { warn("Projects watcher", "could not determine status"); }
}

async function checkWatcherErrors(): Promise<void> {
  const logPath = join(HOME, ".gitpal", "log", "gitpal.log");
  if (!existsSync(logPath)) return;

  try {
    const content = readFileSync(logPath, "utf8");
    const lines = content.split("\n").filter(Boolean);
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;

    const recentErrors = new Map<string, number>(); // project -> error count

    for (const line of lines) {
      const tsMatch = line.match(/^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]/);
      const projMatch = line.match(/^\[[^\]]+\] \[([^\]]+)\]/);
      if (!tsMatch || !projMatch) continue;
      if (!line.includes("error") && !line.includes("Error")) continue;

      const rawTs = tsMatch[1] ?? "";
      const ts = new Date(rawTs.replace(" ", "T") + "Z").getTime();
      if (ts < fiveMinutesAgo) continue;

      const proj = projMatch[1]!;
      recentErrors.set(proj, (recentErrors.get(proj) ?? 0) + 1);
    }

    if (recentErrors.size === 0) {
      pass("Watcher errors", "none in last 5 minutes");
    } else {
      for (const [proj, count] of recentErrors) {
        warn("Watcher errors", `${proj}: ${count} error(s) in last 5 min — check ~/.gitpal/log/gitpal.log`);
      }
    }
  } catch { /* ok */ }
}

async function checkPushQueue(): Promise<void> {
  const queueFile = join(HOME, ".gitpal", "push-queue.json");
  if (!existsSync(queueFile)) return;
  try {
    const queue: Array<{ dir: string; queuedAt: string }> = JSON.parse(readFileSync(queueFile, "utf8"));
    if (!Array.isArray(queue) || queue.length === 0) return;
    for (const entry of queue) {
      const name = entry.dir.split("/").pop() ?? entry.dir;
      const since = new Date(entry.queuedAt).toLocaleString();
      warn("Queued push", `${name} — queued since ${since} (will retry automatically)`);
    }
  } catch { /* ok */ }
}

// ── Main ──────────────────────────────────────────────────────────────────────

export interface DoctorOptions {
  fix?: boolean;
}

export async function runDoctor(opts: DoctorOptions = {}): Promise<void> {
  const { fix = false } = opts;
  banner();
  gp.header(fix ? "System Health Check + Auto-Fix" : "System Health Check");

  section("System");
  await checkDisk();
  await checkMemory();

  section("Services");
  await checkOllama();
  await checkDocker();

  section("GitPal");
  await checkWatcher();
  await checkWatcherErrors();
  await checkPushQueue();
  await checkProjects();

  if (fix) {
    section("Auto-Fix");
    await autoFix();
  }

  console.log();
}

// ── Auto-fix ──────────────────────────────────────────────────────────────────

async function autoFix(): Promise<void> {
  let fixed = 0;

  // 1. Clear stale PID files (process is dead but file remains)
  const sessionsDir = join(HOME, ".gitpal", "sessions");
  if (existsSync(sessionsDir)) {
    for (const file of readdirSync(sessionsDir)) {
      if (!file.endsWith(".pid")) continue;
      const pidPath = join(sessionsDir, file);
      try {
        const pid = parseInt(readFileSync(pidPath, "utf8").trim(), 10);
        const alive = await Bun.$`kill -0 ${pid}`.quiet().nothrow();
        if (alive.exitCode !== 0) {
          unlinkSync(pidPath);
          pass("Removed stale PID", file);
          fixed++;
        }
      } catch { /* ok */ }
    }
  }

  // 2. Restart dead per-project watchers
  const config = await loadConfig();
  const home = homedir();
  for (const pattern of config.watch_patterns) {
    const expanded = pattern.replace("~", home);
    const base = expanded.replace(/\/\*$/, "");
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base)) {
      if (entry.startsWith(".")) continue;
      const projectDir = join(base, entry);
      if (!statSync(projectDir).isDirectory()) continue;
      const pidFile = join(HOME, ".gitpal", "sessions", `${entry}.pid`);
      if (!existsSync(pidFile)) continue;
      const pid = parseInt(readFileSync(pidFile, "utf8").trim(), 10);
      const alive = await Bun.$`kill -0 ${pid}`.quiet().nothrow();
      if (alive.exitCode !== 0) {
        Bun.spawn([join(home, ".local", "bin", "gp-watcher"), projectDir], {
          detached: true,
          stdio: ["ignore", "ignore", "ignore"],
        });
        pass("Restarted watcher", entry);
        fixed++;
      }
    }
  }

  // 3. Prune Docker build cache if disk > 85%
  const dfResult = await Bun.$`df -h /`.quiet().nothrow();
  const dfLine = dfResult.stdout.toString().split("\n")[1] ?? "";
  const pctMatch = dfLine.match(/(\d+)%/);
  const diskPct = parseInt(pctMatch?.[1] ?? "0");
  if (diskPct >= 85) {
    const pruneResult = await Bun.$`docker builder prune -f`.quiet().nothrow();
    if (pruneResult.exitCode === 0) {
      const freed = pruneResult.stdout.toString().match(/Total reclaimed space: (.+)/)?.[1] ?? "some space";
      pass("Docker build cache pruned", `freed ${freed}`);
      fixed++;
    }
  }

  if (fixed === 0) {
    pass("Nothing to fix", "everything looks healthy");
  } else {
    console.log();
    console.log(chalk.green(`  Fixed ${fixed} issue(s).`));
  }
}

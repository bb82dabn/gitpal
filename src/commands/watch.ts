import { isGitRepo } from "../lib/git.ts";
import { isWatched } from "../lib/config.ts";
import { startWatcher, stopWatcher, isWatcherRunning, startProjectsWatcher, stopProjectsWatcher, isProjectsWatcherRunning } from "../lib/watcher.ts";
import { gp, banner } from "../lib/display.ts";
import chalk from "chalk";
import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync, readdirSync } from "node:fs";

export async function runWatch(subcommand: string, dir: string = process.cwd()): Promise<void> {
  switch (subcommand) {
    case "start":
      return watchStart(dir);
    case "stop":
      return watchStop(dir);
    case "status":
      return watchStatus();
    case "projects":
      return watchProjects();
    default:
      gp.error(`Unknown watch subcommand: ${subcommand}`);
      gp.info("Usage: gp watch start | stop | status | projects");
  }
}

async function watchStart(dir: string): Promise<void> {
  if (!(await isGitRepo(dir))) {
    gp.warn("This directory is not a git repo.");
    gp.info("Run `gp init` first.");
    return;
  }

  if (isWatcherRunning(dir)) {
    gp.info("Watcher is already running for this project.");
    return;
  }

  const pid = await startWatcher(dir);
  gp.success(`Watcher started (PID ${pid}).`);
  gp.info("GitPal will auto-commit when you stop coding.");
  gp.info("Stop with: gp watch stop");
}

async function watchStop(dir: string): Promise<void> {
  const stopped = stopWatcher(dir);
  if (stopped) {
    gp.success("Watcher stopped.");
  } else {
    gp.info("No watcher running for this project.");
  }
}

async function watchStatus(): Promise<void> {
  banner();
  gp.header("Watch Status");

  const sessionsDir = join(homedir(), ".gitpal", "sessions");
  if (!existsSync(sessionsDir)) {
    gp.info("No watchers have ever been started.");
    return;
  }

  const pidFiles = readdirSync(sessionsDir).filter((f) => f.endsWith(".pid"));

  if (pidFiles.length === 0) {
    gp.info("No watchers are currently configured.");
    return;
  }

  const rows: Array<{ project: string; status: string; pid: string }> = [];

  // Projects-root watcher gets a special label
  const projectsWatcherRunning = isProjectsWatcherRunning();
  rows.push({
    project: "~/projects (new dirs)",
    status: projectsWatcherRunning ? chalk.green("watching") : chalk.dim("stopped"),
    pid: projectsWatcherRunning ? chalk.dim("auto") : chalk.dim("—"),
  });

  for (const pidFileName of pidFiles) {
    if (pidFileName === "_projects-watcher.pid") continue; // handled above
    const pidPath = join(sessionsDir, pidFileName);
    const dirPath = join(sessionsDir, pidFileName.replace(".pid", ".dir"));

    const dirName = existsSync(dirPath)
      ? (await Bun.file(dirPath).text()).trim()
      : pidFileName.replace(".pid", "");

    const pidStr = await Bun.file(pidPath).text();
    const pid = parseInt(pidStr, 10);

    const alive = await Bun.$`kill -0 ${pid}`.quiet().nothrow();
    const running = alive.exitCode === 0;

    rows.push({
      project: dirName.split("/").pop() ?? dirName,
      status: running ? chalk.green("watching") : chalk.dim("stopped"),
      pid: running ? String(pid) : chalk.dim("—"),
    });
  }

  gp.blank();
  for (const row of rows) {
    console.log(`  ${row.project.padEnd(25)}  ${row.status}  ${chalk.dim("pid " + row.pid)}`);
  }
  gp.blank();
}

async function watchProjects(): Promise<void> {
  if (isProjectsWatcherRunning()) {
    gp.info("Projects watcher is already running.");
    gp.info("Any new folder in ~/projects will be automatically set up.");
    return;
  }
  const pid = await startProjectsWatcher();
  gp.success(`Projects watcher started (PID ${pid}).`);
  gp.blank();
  gp.info("GitPal is now watching ~/projects for new folders.");
  gp.info("When you create a new project folder there, it will automatically:");
  console.log(chalk.dim("    1. Initialize a git repo"));
  console.log(chalk.dim("    2. Create a private GitHub repo"));
  console.log(chalk.dim("    3. Push the initial commit"));
  console.log(chalk.dim("    4. Start auto-committing your changes"));
  gp.blank();
}

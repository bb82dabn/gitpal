import { input, select, confirm } from "@inquirer/prompts";
import { isGhInstalled, isGhAuthenticated, ghAuthLogin, getGhUsername } from "../lib/gh.ts";
import { loadConfig, saveConfig } from "../lib/config.ts";
import { gp, banner } from "../lib/display.ts";
import chalk from "chalk";
import { homedir } from "node:os";
import { join } from "node:path";

const TOTAL_STEPS = 7;

// ── Helpers ──────────────────────────────────────────────────────────────────

async function isDockerInstalled(): Promise<boolean> {
  const r = await Bun.$`docker --version`.quiet().nothrow();
  return r.exitCode === 0;
}

async function installDocker(): Promise<boolean> {
  gp.info("Installing Docker via get.docker.com (requires sudo)...");
  const r = await Bun.$`curl -fsSL https://get.docker.com | sudo sh`.nothrow();
  if (r.exitCode !== 0) return false;
  // Add current user to docker group
  const user = Bun.env.USER ?? "brian";
  await Bun.$`sudo usermod -aG docker ${user}`.quiet().nothrow();
  return true;
}

async function isGhInPath(): Promise<boolean> {
  const r = await Bun.$`gh --version`.quiet().nothrow();
  return r.exitCode === 0;
}

async function installGhStandalone(): Promise<boolean> {
  const arch = process.arch === "arm64" ? "arm64" : "amd64";
  const version = "2.67.0";
  const url = `https://github.com/cli/cli/releases/download/v${version}/gh_${version}_linux_${arch}.tar.gz`;
  const binDir = join(homedir(), ".local", "bin");

  gp.info(`Installing gh CLI v${version} to ~/.local/bin/...`);
  await Bun.$`mkdir -p ${binDir}`.quiet();
  const r = await Bun.$`curl -sL ${url} | tar xz -C /tmp`.nothrow();
  if (r.exitCode !== 0) return false;
  const cp = await Bun.$`cp /tmp/gh_${version}_linux_${arch}/bin/gh ${join(binDir, "gh")}`.nothrow();
  if (cp.exitCode !== 0) return false;
  await Bun.$`chmod +x ${join(binDir, "gh")}`.quiet();
  gp.success("gh CLI installed.");
  return true;
}

async function getGitIdentity(): Promise<{ name: string; email: string }> {
  const nameR = await Bun.$`git config --global user.name`.quiet().nothrow();
  const emailR = await Bun.$`git config --global user.email`.quiet().nothrow();
  return {
    name: nameR.exitCode === 0 ? nameR.stdout.toString().trim() : "",
    email: emailR.exitCode === 0 ? emailR.stdout.toString().trim() : "",
  };
}

async function enableSystemdServices(): Promise<void> {
  const serviceDir = join(homedir(), ".config", "systemd", "user");
  await Bun.$`mkdir -p ${serviceDir}`.quiet();

  // Check if service files exist
  const serverService = join(serviceDir, "gp-server.service");
  const watcherService = join(serviceDir, "gp-projects-watcher.service");
  const { existsSync } = await import("node:fs");

  if (!existsSync(serverService) || !existsSync(watcherService)) {
    gp.warn("Systemd service files not found. Copy them first:");
    console.log(`    cp systemd/*.service ${serviceDir}/`);
    return;
  }

  await Bun.$`systemctl --user daemon-reload`.quiet().nothrow();
  await Bun.$`systemctl --user enable --now gp-server.service`.quiet().nothrow();
  await Bun.$`systemctl --user enable --now gp-projects-watcher.service`.quiet().nothrow();

  // Verify
  const serverActive = await Bun.$`systemctl --user is-active gp-server.service`.quiet().nothrow();
  const watcherActive = await Bun.$`systemctl --user is-active gp-projects-watcher.service`.quiet().nothrow();

  if (serverActive.stdout.toString().trim() === "active") {
    gp.success("Dashboard server running (port 4242)");
  } else {
    gp.warn("Dashboard server failed to start — check: systemctl --user status gp-server");
  }

  if (watcherActive.stdout.toString().trim() === "active") {
    gp.success("Projects watcher running");
  } else {
    gp.warn("Projects watcher failed to start — check: systemctl --user status gp-projects-watcher");
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

export async function runSetup(): Promise<void> {
  banner();
  gp.header("Machine Setup");
  gp.info("Setting up this machine for GitPal. Takes a couple of minutes.");
  gp.blank();

  const config = await loadConfig();

  // ── Step 1: Docker ───────────────────────────────────────────────────────
  gp.step(1, TOTAL_STEPS, "Checking Docker...");

  const dockerOk = await isDockerInstalled();
  if (dockerOk) {
    gp.success("Docker is installed.");
  } else {
    gp.warn("Docker is not installed.");
    const install = await confirm({ message: "Install Docker now? (requires sudo)", default: true });
    if (install) {
      const ok = await installDocker();
      if (ok) {
        gp.success("Docker installed. You may need to log out and back in for group changes.");
      } else {
        gp.warn("Docker installation failed. Install manually: curl -fsSL https://get.docker.com | sh");
      }
    } else {
      gp.info("Skipping Docker. Deploy features won't work without it.");
    }
  }

  // ── Step 2: gh CLI ───────────────────────────────────────────────────────
  gp.step(2, TOTAL_STEPS, "Checking GitHub CLI (gh)...");

  let ghOk = await isGhInPath();
  if (ghOk) {
    gp.success("GitHub CLI is installed.");
  } else {
    gp.info("GitHub CLI not found. Installing standalone binary...");
    ghOk = await installGhStandalone();
    if (!ghOk) {
      gp.warn("Could not auto-install gh. Install manually: https://cli.github.com");
      const proceed = await confirm({ message: "Continue without gh?", default: false });
      if (!proceed) {
        gp.info("Run `gp setup` again after installing gh.");
        return;
      }
    }
  }

  // ── Step 3: gh auth ──────────────────────────────────────────────────────
  gp.step(3, TOTAL_STEPS, "Checking GitHub authentication...");

  if (ghOk) {
    const ghAuthed = await isGhAuthenticated();
    if (!ghAuthed) {
      gp.info("You need to log in to GitHub. A browser window will open.");
      gp.blank();
      await ghAuthLogin();
    }

    // Set up git credential helper
    await Bun.$`gh auth setup-git`.quiet().nothrow();

    const username = await getGhUsername();
    if (username) {
      await saveConfig({ github_username: username });
      gp.success(`Logged in as ${username}`);
    } else {
      const manualUsername = await input({
        message: "Enter your GitHub username:",
        default: config.github_username,
      });
      await saveConfig({ github_username: manualUsername });
      gp.success(`Username saved: ${manualUsername}`);
    }
  } else {
    gp.warn("Skipping auth — gh not available.");
  }

  // ── Step 4: Git identity ─────────────────────────────────────────────────
  gp.step(4, TOTAL_STEPS, "Checking git identity...");

  const identity = await getGitIdentity();
  if (identity.name && identity.email) {
    gp.success(`Git identity: ${identity.name} <${identity.email}>`);
  } else {
    gp.info("Git needs a name and email for commits.");
    const gitName = await input({
      message: "Your name for git commits:",
      default: identity.name || Bun.env.USER || "Developer",
    });
    const gitEmail = await input({
      message: "Your email for git commits:",
      default: identity.email || "",
    });
    await Bun.$`git config --global user.name ${gitName}`.quiet();
    await Bun.$`git config --global user.email ${gitEmail}`.quiet();
    gp.success(`Git identity set: ${gitName} <${gitEmail}>`);
  }

  // ── Step 5: Watch patterns ───────────────────────────────────────────────
  gp.step(5, TOTAL_STEPS, "Which folders contain YOUR projects?");
  gp.blank();
  gp.info("GitPal will auto-watch repos inside these folders.");
  gp.info(`Your home dir is: ${homedir()}`);
  gp.blank();

  const patternChoice = await select({
    message: "Pick a preset or enter your own:",
    choices: [
      { name: `${join(homedir(), "projects")}/*`, value: "projects" },
      { name: `${homedir()}/* (everything in home)`, value: "home" },
      { name: "Enter custom patterns", value: "custom" },
    ],
  });

  let watchPatterns: string[];
  if (patternChoice === "home") {
    watchPatterns = [`${homedir()}/*`];
  } else if (patternChoice === "projects") {
    watchPatterns = [`${join(homedir(), "projects")}/*`];
  } else {
    const raw = await input({
      message: "Enter patterns separated by commas (use ~ for home):",
      default: `${join(homedir(), "projects")}/*`,
    });
    watchPatterns = raw.split(",").map((p) => p.trim());
  }

  await saveConfig({ watch_patterns: watchPatterns });
  gp.success(`Watch patterns: ${watchPatterns.join(", ")}`);

  // ── Step 6: Auto-push ────────────────────────────────────────────────────
  gp.step(6, TOTAL_STEPS, "Auto-push setting...");
  gp.blank();
  console.log(chalk.dim("  Auto-push: after every auto-commit, also push to GitHub automatically."));
  console.log(chalk.dim("  If off, commits stay local until you run gp push."));
  gp.blank();

  const autoPushChoice = await select({
    message: "Auto-push to GitHub after every auto-commit?",
    choices: [
      { name: "Yes — push automatically (fully hands-free)", value: true },
      { name: "No — keep commits local, I'll push manually with gp push", value: false },
    ],
  });
  await saveConfig({ auto_push: autoPushChoice });
  gp.success(`Auto-push: ${autoPushChoice ? "enabled" : "disabled"}`);

  // ── Step 7: Systemd services ─────────────────────────────────────────────
  gp.step(7, TOTAL_STEPS, "Enabling systemd services...");

  await enableSystemdServices();

  // ── Done ─────────────────────────────────────────────────────────────────
  gp.blank();
  gp.header("Setup Complete");
  gp.success(`Machine: ${config.machine_name} (${config.machine_id})`);
  gp.success("GitPal is configured and ready.");
  gp.blank();
  gp.info("What to do next:");
  console.log("    gp status          — see all your projects");
  console.log("    gp doctor          — full health check");
  console.log("    gp push            — push commits to GitHub");
  console.log("    localhost:4242     — open the dashboard");
  gp.blank();
}

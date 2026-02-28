import { input, select, confirm } from "@inquirer/prompts";
import { isGhInstalled, isGhAuthenticated, ghAuthLogin, getGhUsername } from "../lib/gh.ts";
import { loadConfig, saveConfig } from "../lib/config.ts";
import { isOllamaRunning } from "../lib/ai.ts";
import { gp, banner } from "../lib/display.ts";
import chalk from "chalk";
import { homedir } from "node:os";
import { join } from "node:path";

export async function runSetup(): Promise<void> {
  banner();
  gp.header("First-Time Setup");
  gp.info("Let's get you set up. This only takes a couple of minutes.");
  gp.blank();

  const config = await loadConfig();

  // ── Step 1: gh CLI ────────────────────────────────────────────────────────
  gp.step(1, 5, "Checking GitHub CLI (gh)...");

  const ghInstalled = await isGhInstalled();
  if (!ghInstalled) {
    gp.warn("GitHub CLI is not installed.");
    gp.info("Install it with:");
    console.log();
    console.log('    curl -fsSL https://cli.github.com/install.sh | sh');
    console.log('    # or: sudo apt install gh');
    console.log();
    const proceed = await confirm({ message: "Have you installed gh and want to continue?", default: false });
    if (!proceed) {
      gp.info("Run `gp setup` again after installing gh.");
      return;
    }
  } else {
    gp.success("GitHub CLI is installed.");
  }

  // ── Step 2: gh auth ───────────────────────────────────────────────────────
  gp.step(2, 5, "Checking GitHub authentication...");

  const ghAuthed = await isGhAuthenticated();
  if (!ghAuthed) {
    gp.info("You need to log in to GitHub. A browser window will open.");
    gp.blank();
    await ghAuthLogin();
  }

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

  // ── Step 3: Watch patterns ────────────────────────────────────────────────
  gp.step(3, 5, "Which folders contain YOUR projects?");
  gp.blank();
  gp.info("GitPal will auto-watch repos inside these folders.");
  gp.info(`Your home dir is: ${homedir()}`);
  gp.blank();

  const patternChoice = await select({
    message: "Pick a preset or enter your own:",
    choices: [
      { name: `${homedir()}/* (everything in home)`, value: "home" },
      { name: `${join(homedir(), "projects")}/*`, value: "projects" },
      { name: `${join(homedir(), "vibecode-projects")}/*`, value: "vibecode" },
      { name: "Enter custom patterns", value: "custom" },
    ],
  });

  let watchPatterns: string[];
  if (patternChoice === "home") {
    watchPatterns = [`${homedir()}/*`];
  } else if (patternChoice === "projects") {
    watchPatterns = [`${join(homedir(), "projects")}/*`];
  } else if (patternChoice === "vibecode") {
    watchPatterns = [`${join(homedir(), "vibecode-projects")}/*`];
  } else {
    const raw = await input({
      message: "Enter patterns separated by commas (use ~ for home):",
      default: `${homedir()}/*`,
    });
    watchPatterns = raw.split(",").map((p) => p.trim());
  }

  await saveConfig({ watch_patterns: watchPatterns });
  gp.success(`Watch patterns saved: ${watchPatterns.join(", ")}`);

  // ── Step 4: Idle timeout ──────────────────────────────────────────────────
  gp.step(4, 5, "How long should GitPal wait after you stop coding before it commits?");
  gp.blank();

  const idleChoice = await select({
    message: "Idle timeout:",
    choices: [
      { name: "2 minutes (recommended)", value: 120 },
      { name: "5 minutes", value: 300 },
      { name: "10 minutes", value: 600 },
      { name: "30 minutes", value: 1800 },
    ],
  });

  await saveConfig({ idle_seconds: idleChoice });
  gp.success(`Idle timeout: ${idleChoice / 60} minute(s)`);

  // ── Step 5: Auto-push ───────────────────────────────────────────────
  gp.step(5, 6, "Auto-push setting...");
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

  // ── Step 6: Ollama check ──────────────────────────────────────────────
  gp.step(6, 6, "Checking Ollama (for AI commit messages)...");
  gp.step(5, 5, "Checking Ollama (for AI commit messages)...");

  const ollamaOk = await isOllamaRunning();
  if (ollamaOk) {
    gp.success("Ollama is running. AI commit messages are enabled.");
  } else {
    gp.warn("Ollama is not running.");
    gp.info("AI commit messages will fall back to 'chore: auto-save HH:MM' until Ollama starts.");
    gp.info("Start Ollama with: ollama serve");
    gp.info("Install a model with: ollama pull llama3.2");
  }

  // ── Done ──────────────────────────────────────────────────────────────────
  gp.blank();
  gp.header("Setup Complete");
  gp.success("GitPal is configured and ready.");
  gp.blank();
  gp.info("What to do next:");
  console.log("    gp status          — see all your projects");
  console.log("    cd <project>       — shell hook will prompt to init ungitted projects");
  console.log("    gp init            — manually init a project");
  console.log("    gp push            — push commits to GitHub");
  console.log("    gp undo            — safely restore a previous version");
  gp.blank();
  gp.info("For automatic commits to work, reload your shell:");
  console.log("    source ~/.bashrc");
  gp.blank();
}

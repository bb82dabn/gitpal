import { input, select, confirm } from "@inquirer/prompts";
import { isGitRepo, gitInit, gitAdd, gitCommit, hasRemote, gitPush } from "../lib/git.ts";
import { isGhInstalled, isGhAuthenticated, ghRepoCreate } from "../lib/gh.ts";
import { loadConfig } from "../lib/config.ts";
import { gp, banner } from "../lib/display.ts";
import { basename } from "node:path";
import { existsSync, writeFileSync } from "node:fs";
import { writeReadme, generateRepoMeta, applyRepoMeta } from "../lib/readme.ts";

const GITIGNORE_TEMPLATES: Record<string, string> = {
  node: `# Node
node_modules/
dist/
build/
.cache/
*.tsbuildinfo

# Environment
.env
.env.local
.env.*.local

# OS
.DS_Store
Thumbs.db

# Logs
*.log
npm-debug.log*

# Editor
.vscode/settings.json
.idea/
`,
  python: `# Python
__pycache__/
*.py[cod]
*.egg-info/
.venv/
venv/
dist/
build/

# Environment
.env
.env.local

# OS
.DS_Store
Thumbs.db

# Editor
.vscode/settings.json
.idea/
`,
  generic: `# Environment
.env
.env.local
.env.*.local

# OS
.DS_Store
Thumbs.db
*.log

# Editor
.vscode/settings.json
.idea/
`,
};

function detectProjectType(dir: string): "node" | "python" | "generic" {
  if (existsSync(`${dir}/package.json`) || existsSync(`${dir}/bun.lockb`)) return "node";
  if (existsSync(`${dir}/requirements.txt`) || existsSync(`${dir}/pyproject.toml`)) return "python";
  return "generic";
}

function createGitignore(dir: string): void {
  const gitignorePath = `${dir}/.gitignore`;
  if (existsSync(gitignorePath)) return; // Don't overwrite existing
  const type = detectProjectType(dir);
  writeFileSync(gitignorePath, GITIGNORE_TEMPLATES[type] ?? GITIGNORE_TEMPLATES.generic!);
}

export async function runInit(dir: string = process.cwd(), nonInteractive = false): Promise<void> {
  if (!nonInteractive) {
    banner();
    gp.header("Init Project");
  }

  const alreadyRepo = await isGitRepo(dir);
  const alreadyHasRemote = alreadyRepo && (await hasRemote(dir));

  if (alreadyHasRemote) {
    gp.success("This project is already on GitHub.");
    return;
  }

  const config = await loadConfig();
  const defaultName = basename(dir);

  let repoName = defaultName;
  let isPrivate = true;

  if (!nonInteractive) {
    repoName = await input({
      message: "Repository name:",
      default: defaultName,
    });

    const visibility = await select({
      message: "Visibility:",
      choices: [
        { name: "Private (only you can see it)", value: "private" },
        { name: "Public (anyone can see it)", value: "public" },
      ],
    });
    isPrivate = visibility === "private";
  }

  // ── Step 1: git init ──────────────────────────────────────────────────────
  if (!alreadyRepo) {
    gp.step(1, 4, "Initializing git...");
    await gitInit(dir);
    createGitignore(dir);
    gp.success("Git initialized + .gitignore created");
  } else {
    gp.step(1, 4, "Git already initialized — connecting to GitHub");
  }

  // Step 2: Generate README
  gp.info("Generating README...");
  await writeReadme(dir);
  gp.success("README.md generated");

  // Step 3: First commit (includes README)
  gp.step(2, 4, "Creating initial commit...");
  await gitAdd(dir);
  await gitCommit(dir, "Initial commit").catch(() => {
    // Might fail if nothing to commit -- that's fine
  });
  gp.success("Initial commit created");

  // ── Step 3: Create GitHub repo ────────────────────────────────────────────
  const ghInstalled = await isGhInstalled();
  const ghAuthed = ghInstalled && (await isGhAuthenticated());

  if (!ghInstalled || !ghAuthed) {
    gp.warn("GitHub CLI is not installed or authenticated.");
    gp.info("Run `gp setup` first, then come back.");
    gp.info(`Your local git repo is ready. Push manually with:`);
    console.log(`    git remote add origin https://github.com/${config.github_username}/${repoName}.git`);
    console.log(`    git push -u origin main`);
    return;
  }

  gp.step(3, 4, `Creating GitHub repo: ${config.github_username}/${repoName}...`);

  const fullName = `${config.github_username}/${repoName}`;
  try {
    await ghRepoCreate({
      name: fullName,
      private: isPrivate,
      dir,
    });
    gp.success(`Repo created: https://github.com/${fullName}`);

  // Set GitHub repo description, topics, homepage
  try {
    const meta = await generateRepoMeta(dir);
    await applyRepoMeta(fullName, meta);
    if (!nonInteractive) gp.success(`GitHub metadata set: description + ${meta.topics.length} topics`);
  } catch { /* non-fatal */ }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    gp.error(`Failed to create GitHub repo: ${msg}`);
    gp.info("You can create it manually at github.com and then run: git push -u origin main");
    return;
  }

  // ── Step 4: Confirm push (gh repo create --push already pushed) ─────────────
  gp.step(4, 4, "Verifying push...");
  const pushed = await Bun.$`git -C ${dir} ls-remote --heads origin`.quiet().nothrow();
  if (pushed.exitCode !== 0) {
    // gh didn't push for some reason — try manually
    await Bun.$`git -C ${dir} push -u origin HEAD`.quiet().nothrow();
  }

  // ── Done ──────────────────────────────────────────────────────────────────
  gp.blank();
  gp.success(`Project is live on GitHub:`);
  console.log(`    https://github.com/${fullName}`);
  gp.blank();
  gp.info("GitPal will now auto-commit your work when you're idle. No action needed.");
  gp.blank();
}

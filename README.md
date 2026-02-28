# gitpal

> GitPal — Git automation and assistance tool for developers seeking effortless version control

## Description

GitPal automates and simplifies Git workflows by providing intelligent commands, background watchers, and AI-powered commit message generation and README creation. It serves developers who want to reduce the friction of managing Git repositories, automate routine tasks like committing and pushing, and maintain project context effortlessly.

## Features

- **CLI Commands** (via `gp`):
  - `gp setup`: Configure GitPal environment and shell integration.
  - `gp init`: Initialize a Git repository with optional non-interactive mode.
  - `gp push`: Stage, commit (with AI-generated messages), and push changes.
  - `gp undo`: Undo commits (soft or hard).
  - `gp status`: Show Git status with hints.
  - `gp watch`: Run a watcher daemon to auto-commit changes after idle period.
  - `gp readme`: Generate or update README.md using AI summarization of project files.
  - `gp snapshot`: Create a snapshot commit with optional message.
  - `gp log`: Show Git log with options for JSON output and diffs.
  - `gp context`: Generate and display project context cheat sheet.
  - `gp new`: Create new projects from templates.
  - `gp doctor`: Diagnose and optionally fix repository issues.
  - `gp digest`: Generate a daily AI-written project digest ("GitPal Gazette") with screenshots and stats.
  - `gp stash`: Manage Git stash with push, pop, and list subcommands.
  - Additional commands: `blame`, `clean`, `diff`, `open`, `recent`, `setup`, `shell-hook`, `snapshot-log`, `status-hint`, `sync`, `undo`.

- **Background Watchers**:
  - `gp-watcher`: Watches a Git repository directory for changes, auto-stages, commits with AI-generated messages after idle timeout.
  - `gp-projects-watcher`: Watches root project directories (e.g., `~/projects`) for new or changed repos.

- **AI Integration**:
  - Generates conventional commit messages from diffs.
  - Generates README.md files summarizing project context.
  - Supports OpenAI and Ollama AI providers.

- **Shell Integration**:
  - Installs a shell hook to automatically trigger GitPal hooks on directory changes (`install-shell.sh`).
  - Overrides `cd` command to run GitPal shell hooks silently in background.

- **Project Context Management**:
  - Maintains `.gp/context.md` cheat sheets with recent commits, TODOs, stack info, and uncommitted changes.

- **Auto-deploy Support**:
  - Detects Docker Compose or `deploy.sh` in projects and runs deploy commands after successful push.

- **GitHub CLI Integration**:
  - Checks for `gh` CLI presence and authentication.
  - Can create GitHub repos and update repo metadata (description, topics).

- **Dashboard UI**:
  - Serves a web dashboard (`src/public/index.html`) on port 4242 showing project summaries, statuses, and actions.

## Tech Stack

| Technology          | Role                                  |
|---------------------|-------------------------------------|
| JavaScript / TypeScript | Core language for CLI, server, and libraries |
| Bun                 | Runtime and bundler for running and building the app |
| Git                 | Version control system integrated via CLI and libraries |
| GitHub CLI (`gh`)   | GitHub integration for repo creation and metadata updates |
| OpenAI API          | AI-powered commit message and README generation |
| Ollama              | Alternative AI provider for local AI model usage |
| Docker / Docker Compose | Auto-deploy support for projects with containers |
| Chokidar            | File system watcher used in watcher daemons |
| Chalk               | Console output styling and formatting |
| Execa               | Process execution and command running |
| HTTP Server (Bun.serve) | Serves the web dashboard and API endpoints |

## Architecture

- **CLI Entry Point (`src/index.ts`)**: Parses commands and dispatches to command modules under `src/commands/`.
- **Commands (`src/commands/`)**: Implement individual CLI commands like `push`, `init`, `readme`, `stash`, etc.
- **Library Modules (`src/lib/`)**:
  - `git.ts`: Git command wrappers and status parsing.
  - `ai.ts`: AI integration for commit messages and README generation.
  - `config.ts`: Configuration loading, saving, and management.
  - `watcher.ts`: Watcher daemon logic for auto-committing changes.
  - `deploy.ts`: Auto-deploy logic after pushes.
  - `gh.ts`: GitHub CLI integration.
  - `display.ts`: Console output formatting.
  - `context.ts`: Project context file generation.
  - `readme.ts`: README generation logic.
- **Watcher Daemons**:
  - `watcher-daemon.ts`: Watches a single project directory.
  - `projects-watcher-daemon.ts`: Watches root directories for new projects.
- **Server (`src/server.ts`)**: HTTP server providing a dashboard UI and API endpoints for project summaries and actions.
- **Public UI (`src/public/index.html`)**: Frontend dashboard served by the server.
- **Shell Integration (`install-shell.sh`)**: Installs shell hooks to trigger GitPal on directory changes.

## Prerequisites

- **Bun** runtime (tested with latest Bun; Bun is required to run and build)
- **Git** installed and available in PATH
- **GitHub CLI (`gh`)** installed and authenticated for GitHub integration (optional but recommended)
- **Docker** and **Docker Compose** installed for auto-deploy features (optional)
- **Google Chrome Stable** installed at `/usr/bin/google-chrome-stable` for screenshot generation in digest (optional)
- **OpenAI API key** (optional, for AI features)
- **Bash shell** (for shell integration script)

## Installation & Setup

1. **Install dependencies:**

   ```bash
   bun install
   ```

2. **Build binaries:**

   ```bash
   bun run build
   ```

3. **Install GitPal CLI and daemons to local bin:**

   ```bash
   bun run install-bin
   ```

   This copies compiled binaries (`gp`, `gp-watcher`, `gp-projects-watcher`, `gp-server`) to `~/.local/bin` and sets executable permissions.

4. **Install shell integration:**

   ```bash
   source ~/.bashrc
   ```

   (After running `bun run install-bin`, the script appends GitPal shell hooks to `~/.bashrc`. Run `source ~/.bashrc` to activate.)

5. **Run initial setup:**

   ```bash
   gp setup
   ```

   This guides you through configuring GitPal, including AI provider settings and watch patterns.

## Running

### Development

Run the CLI or server directly with Bun:

```bash
bun run src/index.ts <command> [args]
bun run src/server.ts
```

### Production

Use the compiled binaries installed in `~/.local/bin`:

```bash
gp <command> [args]
gp-server
gp-watcher <project-dir>
gp-projects-watcher
```

## Docker

No `docker-compose.yml` or `docker-compose.yaml` file is included in the project root, so no official Docker Compose commands are provided for GitPal itself.

However, GitPal supports auto-deploying projects that contain Docker Compose files by detecting them and running appropriate commands after pushes.

## API Overview

The server (`src/server.ts`) exposes a JSON API on port 4242 with endpoints including:

- **GET `/api/projects`**: Lists watched Git projects with summaries:
  - Name, last commit info, dirty status, changed files count
  - Watcher running status
  - Remote presence and URL

- **POST `/api/action`**: Accepts JSON body with `{ action: "push" | "sync" | "undo", project: string }` to trigger Git actions on projects.

- **GET `/api/doctor`**: Returns diagnostic info about project health and Git status.

- **GET `/`**: Serves the GitPal Dashboard UI (`index.html`).

## Environment Variables

| Variable          | Description                                                  | Required |
|-------------------|--------------------------------------------------------------|----------|
| `OPENAI_API_KEY`  | API key for OpenAI to enable AI-powered commit messages and README generation | No       |
| `OLLAMA_URL`      | URL for Ollama local AI server (default: `http://localhost:11434`) | No       |
| `OLLAMA_MODEL`    | Ollama model name to use (default: `llama3.2`)               | No       |
| `OPENAI_MODEL`    | OpenAI model to use (default: `gpt-4.1-mini`)                | No       |
| `GITHUB_USERNAME` | GitHub username used for GitHub repo metadata updates (default: `bb82dabn`) | No       |

Note: Environment variables are loaded automatically by Bun; no `.env` file is used.

---

# Summary

GitPal is a comprehensive Git automation tool designed to reduce the complexity of Git workflows. It combines CLI commands, background watchers, AI-powered commit and README generation, shell integration, and a web dashboard to provide a seamless Git experience for developers managing multiple projects.

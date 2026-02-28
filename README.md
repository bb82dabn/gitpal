# GitPal

Git on autopilot. A CLI tool that watches your projects, auto-commits with AI-generated messages, pushes to GitHub, and generates a daily newspaper-style digest.

Built for solo developers who want effortless version control and project insights.

---

## Description

GitPal automates Git workflows by watching your project directories for changes, generating meaningful commit messages using AI (OpenAI or Ollama), and pushing updates to GitHub automatically. It also generates a daily AI-written "GitPal Gazette" digest summarizing your work with screenshots and system health info, accessible via a web dashboard. This tool solves the problem of tedious manual commits and provides continuous project monitoring and reporting.

---

## Features

- **CLI with 21 commands** including:
  - `gp push`: Stage, commit with AI-generated message, and push to GitHub.
  - `gp snapshot`: Commit locally without pushing.
  - `gp undo`: Restore previous states safely.
  - `gp status`: Show git status of all tracked projects.
  - `gp watch`: Start/stop file watchers per project.
  - `gp digest`: Generate the daily GitPal Gazette.
  - `gp doctor`: Run full system health checks with optional auto-fix.
  - `gp readme`: Regenerate README.md files using AI.
  - `gp context`: Generate project cheat sheets (`.gp/context.md`).
  - `gp new <name>`: Scaffold new projects.
  - `gp stash`: Stash and restore uncommitted changes.
  - `gp open`: Open project repository on GitHub.
  - `gp clean`: Remove build artifacts and caches.
  - `gp serve`: Start the web dashboard.

- **File watchers**:
  - `gp-watcher`: Per-project daemon watching for changes and auto-committing.
  - `gp-projects-watcher`: Watches root project directories for new projects.

- **AI integrations**:
  - Generates concise, conventional commit messages from git diffs.
  - Regenerates README files with AI assistance.
  - Writes daily newspaper-style digests summarizing commits and project status.

- **Web dashboard** (`gp-server`):
  - Runs on `localhost:4242`.
  - Displays system health (disk, memory, Docker containers, AI provider status).
  - Shows tracked projects with watcher status and recent commits.
  - Presents the GitPal Gazette digest with articles and screenshots.

- **Automatic deployment support**:
  - Detects `deploy.sh` or `docker-compose.yml` in projects and runs deploy commands after pushes.

- **Shell integration**:
  - Adds a shell hook to automatically detect when you `cd` into git projects and start watchers.

- **Offline queueing**:
  - Supports offline commit queues and pushes when network is restored.

---

## Tech Stack

| Technology           | Role                          |
|---------------------|-------------------------------|
| Bun                 | JavaScript runtime and bundler|
| TypeScript          | Language                      |
| Git                 | Version control integration   |
| OpenAI API          | AI commit message generation  |
| Ollama              | Alternative AI provider       |
| Docker              | Deployment and container monitoring |
| GitHub CLI (`gh`)   | GitHub repo management        |
| Chokidar            | File watching                 |
| Chalk               | CLI output styling            |
| Execa               | Running shell commands        |
| WebSocket (Bun)     | Web dashboard real-time updates |
| HTML/CSS/JS         | Web dashboard UI              |

---

## Architecture

GitPal consists of several components installed as binaries and daemons:

- **CLI (`gp`)**: Main command-line interface with 21 commands located in `src/commands/`.
- **Watcher daemons**:
  - `gp-watcher`: Watches a single project directory for changes, auto-commits after idle timeout.
  - `gp-projects-watcher`: Watches configured root directories (e.g., `~/projects`) for new projects.
- **Web server (`gp-server`)**: Serves the web dashboard on port 4242, providing project summaries, health checks, and the GitPal Gazette.
- **Configuration and state**: Stored in `~/.gitpal/` including config, sessions (PID files), logs, screenshots, and digest data.
- **Shell integration**: Adds a hook to your shell to detect directory changes and start watchers automatically.
- **AI integration**: Abstracted in `src/lib/ai.ts` supporting OpenAI and Ollama for commit messages and README generation.
- **Git integration**: `src/lib/git.ts` wraps git commands for status, commit, push, diff, log, stash, and blame.
- **Deployment**: `src/lib/deploy.ts` detects Docker or custom deploy scripts and runs them after pushes.

---

## Prerequisites

- **Bun** runtime (latest recommended; install via https://bun.sh)
- **Git** installed and accessible in PATH
- **GitHub CLI (`gh`)** installed and authenticated for GitHub integration
- **Docker** (optional, for deployment and monitoring)
- **Google Chrome Stable** (`/usr/bin/google-chrome-stable`) for project screenshots (optional)
- **AI provider**:
  - OpenAI API key (set in config) or
  - Ollama running locally (`ollama serve`)

---

## Installation & Setup

```bash
# Install Bun if not installed
curl -fsSL https://bun.sh/install | bash

# Clone the repository
git clone https://github.com/bb82dabn/gitpal.git
cd gitpal

# Install dependencies
bun install

# Build binaries and install to ~/.local/bin
bun run install-bin

# Add shell integration (adds hook to ~/.bashrc)
# Then reload shell config
source ~/.bashrc

# Run initial setup wizard
gp setup
```

The `gp setup` command walks you through:

- Connecting your GitHub account
- Choosing AI provider and configuring API keys or Ollama URL
- Setting directories to watch for projects

---

## Running

### Development

Run the CLI or daemons directly with Bun:

```bash
bun run src/index.ts <command> [args]
bun run src/watcher-daemon.ts <project-dir>
bun run src/projects-watcher-daemon.ts
bun run src/server.ts
```

### Production

Use installed binaries from `~/.local/bin`:

```bash
gp <command> [args]
gp-watcher <project-dir>
gp-projects-watcher
gp-server
```

---

## Docker

No `docker-compose.yml` or Docker setup provided for GitPal itself.

However, GitPal supports deploying your own projects with Docker:

- Detects `docker-compose.yml` or `deploy.sh` in projects.
- Runs `docker compose build` and `docker compose up -d` automatically after pushes.

---

## API Overview

GitPal does not expose a public REST API but provides a web dashboard server (`gp-server`) with these route groups:

- `/api/projects` — lists tracked projects with status and commits
- `/api/doctor` — system health checks (disk, memory, Docker, AI provider)
- `/api/gazette` — daily digest data including articles and screenshots
- `/api/actions` — accept POST requests to trigger actions like push, sync, undo on projects

The dashboard UI is served from `src/public/index.html` and bundled frontend assets.

---

## Environment Variables

GitPal primarily uses a JSON config file (`~/.gitpal/config.json`) but also respects environment variables for AI keys.

| Variable          | Description                              | Required          |
|-------------------|------------------------------------------|-------------------|
| `OPENAI_API_KEY`  | OpenAI API key for commit message generation and README regeneration | If using OpenAI AI provider |
| `OLLAMA_URL`      | URL of local Ollama server (default: `http://localhost:11434`) | If using Ollama AI provider |
| `GITHUB_USERNAME` | GitHub username for repo operations (stored in config) | Recommended       |

Note: Bun automatically loads `.env` files if present.

---

# Summary

GitPal is a comprehensive CLI and daemon-based tool that automates Git workflows with AI-powered commit messages, automatic pushes, project watching, and a rich web dashboard featuring a daily AI-written digest. It integrates tightly with GitHub, Docker, and AI providers (OpenAI or Ollama) to provide a seamless, hands-off version control experience for solo developers.

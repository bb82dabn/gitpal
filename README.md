<p align="center">
  <img src="assets/gitpal-logo-v2.png" width="200" alt="GitPal">
</p>
<h1 align="center">GitPal</h1>
<p align="center">Git on autopilot. Push, commit, watch, and digest — without thinking about it.</p>

---

## Description

GitPal is an automated Git workflow tool designed for developers who want to simplify and streamline their version control processes. It watches project directories, auto-commits changes with AI-generated commit messages, pushes to GitHub, and generates a daily newspaper-style digest called **The GitPal Gazette** summarizing project activity. It solves the problem of manual Git operations and helps users maintain healthy, up-to-date repositories effortlessly.

---

## Features

- **CLI Commands:**
  - `gp push`: Stage all changes, generate AI commit message, and push to GitHub.
  - `gp undo`: Restore previous states using snapshots.
  - `gp snapshot`: Commit locally without pushing.
  - `gp watch`: Auto-commit after idle timeout.
  - `gp digest`: Generate The GitPal Gazette daily digest.
  - `gp readme`: AI-generate or update README.md and GitHub metadata.
  - `gp context`: Generate a `.gp/context.md` project cheat sheet.
  - `gp new <name>`: Scaffold a new project.
  - `gp doctor`: Diagnose repository health and optionally fix issues.
  - `gp log`: Display git log with JSON and diff output options.
  - `gp stash`: Manage git stashes (push, pop, list).
  - `gp status`: Show git status with hints.
  - `gp diff`: Show git diff.
  - `gp blame`: Show git blame.
  - `gp open`: Open repository on GitHub.
  - `gp clean`: Clean untracked files.
  - `gp sync`: Pull and push changes.

- **The GitPal Gazette:**
  - Newspaper-style daily digest with AI-written articles for every active project.
  - Four editions daily: Morning (6 AM), Noon (12 PM), Evening (6 PM), Midnight (12 AM).
  - Includes DALL-E generated illustrations, satirical comics, project screenshots, infrastructure health, and uncommitted work sidebar.
  - Printable letter-size PDF archives.
  - Accessible via the web dashboard.

- **Dashboard & API:**
  - Runs on port 4242 (`gp-server`).
  - Displays watched projects, commit feeds, system health, and Gazette archive.
  - Supports API actions like push, sync, undo on projects.

- **Background Services:**
  - `gp-watcher`: Watches a project directory, auto-commits after idle timeout.
  - `gp-projects-watcher`: Watches `~/projects/*` for new repositories.
  - `gp-server`: Web dashboard and API server.

- **Shell Integration:**
  - Adds a `cd` alias that triggers a background GitPal shell hook to detect ungitted directories and start watchers automatically.

- **AI Integration:**
  - Uses OpenAI or Ollama for generating commit messages, README content, Gazette articles, and DALL-E images.
  - Supports fallback heuristics if AI is unavailable.

- **GitHub Integration:**
  - Uses GitHub CLI (`gh`) to create repositories and update metadata (description, topics, homepage).

- **Auto-deploy Support:**
  - Detects Docker Compose or custom `deploy.sh` scripts to rebuild/restart services after push.

---

## Tech Stack

| Technology         | Role                                      |
|--------------------|-------------------------------------------|
| Bun                | JavaScript runtime, build tool, and server|
| TypeScript         | Language for source code                    |
| Git                | Version control system                      |
| OpenAI API         | AI commit messages, README, Gazette, images|
| Ollama             | Alternative AI provider                     |
| Google Chrome       | Headless browser for screenshots and PDFs |
| Docker             | Deployment and container management        |
| GitHub CLI (`gh`)  | GitHub repository management                |
| Chokidar           | File system watcher (dependency)            |
| Chalk              | CLI output styling                          |
| Execa              | Process execution                           |

---

## Architecture

GitPal is a CLI-driven monorepo project structured around several core components:

- **CLI Entrypoint (`src/index.ts`)**: Parses commands and dispatches to command modules.
- **Commands (`src/commands/`)**: Implements individual CLI commands such as push, watch, digest, readme, stash, etc.
- **Library Modules (`src/lib/`)**: Core logic for Git operations, AI integration, configuration management, deployment, GitHub API, watcher management, and display utilities.
- **Background Daemons:**
  - `gp-watcher` (`src/watcher-daemon.ts`): Watches a single project directory for changes and auto-commits.
  - `gp-projects-watcher` (`src/projects-watcher-daemon.ts`): Watches root directories for new projects.
  - `gp-server` (`src/server.ts`): Runs a web dashboard and API server on port 4242.
- **Shell Integration (`install-shell.sh`)**: Hooks into shell `cd` command to trigger GitPal hooks automatically.
- **Public Assets (`src/public/index.html`)**: Web dashboard frontend served by `gp-server`.

The CLI commands interact with the watcher daemons and server to provide a seamless experience of automated git operations, project monitoring, and reporting.

---

## Prerequisites

- Bun runtime (tested with latest Bun)
- Git (command-line tool)
- Google Chrome (for headless screenshots and PDF generation)
- OpenAI API key (for AI features) or Ollama running locally
- Optional but recommended:
  - GitHub CLI (`gh`) for repository creation and metadata updates
  - Docker and Docker Compose for auto-deploy support

---

## Installation & Setup

```bash
# Install dependencies
bun install

# Build binaries and server
bun run build

# Install binaries to ~/.local/bin and set permissions
bun run install-bin

# Run setup to configure AI provider, watch patterns, and other settings
gp setup

# Optionally install cron jobs for daily digest editions
gp digest --install-cron
```

After installation, add GitPal shell integration:

```bash
# This adds a cd alias to your ~/.bashrc for automatic watcher triggering
bash install-shell.sh
source ~/.bashrc
```

---

## Running

### Development

Run the CLI directly with Bun:

```bash
bun run src/index.ts <command> [args]
```

Run the server:

```bash
bun run src/server.ts
```

Run watcher daemons manually (for development):

```bash
bun run src/watcher-daemon.ts <project-dir>
bun run src/projects-watcher-daemon.ts
```

### Production

Use installed binaries:

```bash
gp <command> [args]
gp-server      # runs the dashboard server on port 4242
gp-watcher <dir>       # runs watcher daemon for a project directory
gp-projects-watcher    # watches root projects directories for new repos
```

Background services are intended to be managed via systemd user services (not included in repo).

---

## Docker

No `docker-compose.yml` or Dockerfile provided for GitPal itself.

However, GitPal supports auto-deploy for projects containing `docker-compose.yml` or `deploy.sh` scripts by rebuilding and restarting services after `gp push`.

---

## API Overview

The backend server (`gp-server`) exposes a JSON API and web dashboard on port 4242. It provides:

- **Project listing**: Lists watched projects with status, last commit, watcher state, remote info.
- **Project actions**: API endpoints to trigger `push`, `sync`, and `undo` commands on projects.
- **System health**: Displays Docker container health, disk usage.
- **Gazette archive**: Browse and download past daily digest editions and PDFs.

The server is implemented in `src/server.ts` and serves the frontend from `src/public/index.html`.

---

## Environment Variables

| Variable         | Description                                    | Required |
|------------------|------------------------------------------------|----------|
| `OPENAI_API_KEY` | OpenAI API key for AI commit messages, README, Gazette, and images | Yes (if using OpenAI) |
| `OLLAMA_URL`     | URL of local Ollama server (default: `http://localhost:11434`) | No (default provided) |
| `OLLAMA_MODEL`   | Ollama model name (default: `llama3.2`)        | No (default provided) |
| `OPENAI_MODEL`   | OpenAI model name (default: `gpt-4.1-mini`)    | No (default provided) |
| `GITHUB_USERNAME`| GitHub username used for repo metadata updates | No (default: `bb82dabn`) |

Note: Environment variables are loaded automatically by Bun from `.env` files if present.

---

# License

MIT License

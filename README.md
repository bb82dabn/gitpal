# gitpal

Automated Git workflow CLI and background watcher with AI-powered commit messages and project management for developers.

## Description

GitPal streamlines Git operations by providing a comprehensive CLI with 22 commands, background file watchers for automatic commits, and a web dashboard on port 4242. It integrates AI (OpenAI or Ollama) to generate commit messages, README files, and daily digests ("The GitPal Gazette"), solving the problem of tedious manual Git management and improving developer productivity.

## Features

- **CLI Commands (22 total)** including:
  - `gp push`: stage all changes, generate AI commit messages, and push to GitHub
  - `gp undo`: restore previous commits with safety snapshots
  - `gp snapshot`: commit locally without pushing
  - `gp watch`: auto-commit after idle timeout on file changes
  - `gp digest`: generate daily digest newspaper summarizing project activity
  - `gp readme`: AI-generate or update README.md and GitHub metadata
  - `gp context`: generate `.gp/context.md` project cheat sheet
  - `gp new <name>`: scaffold new projects from templates (Next.js, Express, Bun script, static site, blank)
  - `gp doctor`: diagnose repo health and optionally fix issues
  - `gp stash`: manage git stashes (push, pop, list)
  - `gp clean`: remove build artifacts, node_modules, dangling Docker images
  - `gp sync`: pull latest changes with rebase, supports syncing all watched repos
  - `gp open`: open GitHub repo page in browser
  - `gp blame <file>`: show git blame with formatted output
  - `gp diff`: show nicely formatted uncommitted changes

- **Background Daemons:**
  - `gp-watcher`: watches a single project directory for file changes, auto-commits when thresholds are met
  - `gp-projects-watcher`: monitors `~/projects/*` for new projects, auto-initializes git repos, creates GitHub repos, and starts per-project watchers

- **Web Dashboard:**
  - Runs on port 4242 via `src/server.ts` using Bun.serve()
  - Serves React-based UI from `src/public/index.html`
  - Provides REST API endpoints for project status, logs, and real-time updates

- **AI Integration:**
  - Supports OpenAI API or local Ollama via environment variables
  - Generates commit messages, README content, and daily digest summaries
  - Abstracted in `src/lib/ai.ts`

- **GitHub CLI Integration:**
  - Uses `gh` CLI for repo creation, PRs, issues, releases
  - Wrapped in `src/lib/gh.ts`

- **Config & State Management:**
  - User config stored in `~/.gitpal/config.json` (validated with Zod)
  - Session state in `~/.gitpal/sessions/`
  - Project metadata in `.gitpal/` directory inside repos

- **Shell Integration:**
  - `install-shell.sh` installs shell hooks for automatic watcher triggering on `cd`

- **Project Scaffolding:**
  - Templates for Next.js, Express, Bun scripts, static sites, and blank projects

- **Deployment Utilities:**
  - Docker and deployment helpers via `src/lib/deploy.ts`
  - Supports docker-compose and CI/CD integration

- **Logging & Output:**
  - Terminal output styled with Chalk (`src/lib/display.ts`)
  - Logs stored under `~/.gitpal/log/`

## Tech Stack

| Technology               | Role                                   |
|--------------------------|--------------------------------------|
| Bun                      | JavaScript runtime and bundler       |
| TypeScript               | Language                            |
| Chokidar                 | File watching                        |
| OpenAI API / Ollama      | AI-powered commit messages, README, digests |
| GitHub CLI (`gh`)        | GitHub repository and PR management  |
| Chalk                    | Terminal output styling               |
| Zod                      | Configuration schema validation      |
| @inquirer/prompts        | Interactive CLI prompts               |
| React (in web dashboard) | UI for web dashboard                  |

## Architecture

- **CLI (`gp`)**: Entry point in `src/index.ts` dispatches to 22 commands in `src/commands/`. Commands use core logic in `src/lib/`.
- **Background Watchers**:
  - `gp-watcher` (`src/watcher-daemon.ts`): watches a single project directory, auto-commits on changes.
  - `gp-projects-watcher` (`src/projects-watcher-daemon.ts`): watches `~/projects/*`, auto-initializes new projects, creates GitHub repos, and spawns `gp-watcher` per project.
- **Web Dashboard**: `src/server.ts` serves React UI and provides API endpoints on port 4242.
- **MCP Server**: `src/mcp.ts` implements Model Context Protocol for AI assistants to query GitPal context and run commands.
- **Core Libraries**: `src/lib/` contains modules for AI, git, GitHub, config, deploy, watcher, display, context, and README generation.
- **Shell Integration**: `install-shell.sh` installs shell hooks for automatic context generation and watcher triggering on directory changes.

## Prerequisites

- **Bun runtime** (tested with latest Bun; see CLAUDE.md for Bun conventions)
- **Git** (command line tools)
- **GitHub CLI (`gh`)** installed and authenticated
- **Docker** (optional, for deployment features)
- **Google Chrome Stable** (for PDF generation of Gazette, path `/usr/bin/google-chrome-stable` expected)
- **Node.js** (for some templates, e.g., Next.js scaffold)
- **TypeScript** 5.x (peer dependency)

## Installation & Setup

```bash
# Clone the repository
git clone <repo-url>
cd gitpal

# Install dependencies with Bun
bun install

# Build all binaries
bun run build

# Install binaries and setup shell integration and systemd services
bun run install-bin

# Source your shell config to enable shell hooks
source ~/.bashrc
```

The `install-bin` script:

- Builds 4 binaries: `gp`, `gp-watcher`, `gp-projects-watcher`, `gp-server`
- Copies them to `~/.local/bin/` and makes them executable
- Copies web dashboard assets to `~/.local/share/gitpal/`
- Installs systemd user services from `systemd/`
- Runs `install-shell.sh` to install shell cd hooks

## Running

### Development

```bash
# Run CLI commands directly with Bun
bun run src/index.ts <command> [args]
```

### Production

After installation (`install-bin`), run commands via installed binaries:

```bash
gp <command> [args]
```

### Background Daemons

- Start single-project watcher manually or via systemd:

```bash
gp-watcher /path/to/project
```

- Start projects watcher (monitors `~/projects/*`):

```bash
gp watch projects
# or start systemd user service: gp-projects-watcher.service
```

### Web Dashboard

Run the server:

```bash
gp-server
```

Access the dashboard at [http://localhost:4242](http://localhost:4242).

Or start systemd user service `gp-server.service`.

## Docker

No `docker-compose.yml` or Docker configuration files detected in the project root. Deployment utilities exist in `src/lib/deploy.ts` but require user-provided Docker compose files.

## API Overview

The backend server (`src/server.ts`) provides REST API endpoints for:

- Project status and metadata
- Logs and recent commits
- Real-time updates for watchers

The MCP server (`src/mcp.ts`) exposes Model Context Protocol endpoints for AI assistants to query project context and execute commands.

## Environment Variables

| Variable         | Description                                           | Required |
|------------------|-------------------------------------------------------|----------|
| `OPENAI_API_KEY` | API key for OpenAI integration (used for AI features) | No*      |
| `OLLAMA_BASE_URL`| Base URL for local Ollama AI server (alternative AI provider) | No*      |

\* At least one AI provider environment variable (`OPENAI_API_KEY` or `OLLAMA_BASE_URL`) should be set to enable AI-powered features like commit message generation, README creation, and digest summaries.

---

# Summary

GitPal is a comprehensive Git workflow automation tool combining CLI commands, background watchers, AI integration, and a web dashboard to simplify Git operations, project management, and documentation for developers. It requires Bun runtime, Git, GitHub CLI, and optionally Docker and AI API keys. Installation includes building binaries, setting up shell hooks, and systemd services for seamless background operation.

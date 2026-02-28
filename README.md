# gitpal

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

This project was created using `bun init` in bun v1.3.9. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.

---

## Description

`gitpal` is a CLI tool for automating Git workflows with AI-powered commit messages, real-time file monitoring, and GitHub integration. It solves the problem of manual Git management by auto-committing changes, generating READMEs, and syncing with GitHub. Designed for developers who want to focus on coding rather than Git operations.

---

## Features

- **Automated Git commits** with AI-generated conventional commit messages
- **GitHub integration** for repo creation, deployment, and metadata updates
- **Real-time file monitoring** with auto-saving and auto-committing
- **AI-powered README generation** using Ollama
- **Docker deployment automation** via `docker-compose`
- **Stash/unstash** uncommitted changes without losing work
- **Project health checks** for disk space, memory, and container status
- **Customizable watch patterns** for directory monitoring
- **Command-line interface** with over 20 Git-related commands

---

## Tech Stack

| Technology        | Role                          |
|-------------------|-------------------------------|
| **Bun**           | Primary runtime and build tool |
| **TypeScript**    | Static typing and modern syntax |
| **Node.js**       | Underlying runtime             |
| **@inquirer/prompts** | Interactive CLI prompts     |
| **chalk**         | Terminal styling              |
| **chokidar**      | File system watcher           |
| **execa**         | Cross-platform process spawning |
| **SQLite**        | Local database for config     |
| **Ollama**        | AI model for commit messages  |

---

## Architecture

`gitpal` is a monorepo with a CLI entry point (`src/index.ts`) and modular architecture:

1. **CLI Core** (`src/index.ts`): Main entry point handling command dispatch
2. **Commands** (`src/commands/`): 20+ CLI commands for Git operations (e.g., `push`, `stash`, `new`)
3. **Libraries** (`src/lib/`): Core functionality:
   - `git.ts`: Git operations (status, commit, diff)
   - `ai.ts`: AI commit message generation
   - `gh.ts`: GitHub API integration
   - `watcher.ts`: Background file monitoring
   - `config.ts`: Configuration management
4. **Watchers** (`src/watcher-daemon.ts`, `projects-watcher-daemon.ts`): Background processes for real-time monitoring
5. **Context Management** (`src/lib/context.ts`): Generates `.gp/context.md` cheat sheets
6. **Deployment** (`src/lib/deploy.ts`): Docker-compose automation for deployments

---

## Prerequisites

- **Bun** v1.3.9+ (https://bun.sh)
- **Node.js** v18+ (for some dependencies)
- **TypeScript** v5.0+
- **Ollama** (for AI commit messages)
- **Docker** (for deployment automation)

---

## Installation & Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   bun install
   ```
3. Build and install binaries:
   ```bash
   bun run install-bin
   ```
   This installs `gp`, `gp-watcher`, and `gp-projects-watcher` to `~/.local/bin`

---

## Running

### Development
```bash
bun run index.ts
```

### Production
```bash
gp <command>
```

---

## Docker

No Dockerfile provided. Use `docker-compose.yml` if present for containerization.

---

## API Overview

### GitHub API
- `gh auth login`: Authenticate with GitHub
- `gh repo create`: Create new repository
- `gh api user`: Get GitHub username
- `gh deploy`: Custom deploy script execution

### Git API
- `git status`/`git diff`/`git log`: Core Git operations
- `git add`/`git commit`: Auto-commit workflow
- `git push`: Remote repository synchronization

---

## Environment Variables

| Variable              | Description                                                                 | Required |
|-----------------------|-----------------------------------------------------------------------------|----------|
| `OLLAMA_MODEL`        | AI model to use for commit messages (default: `llama3.2`)                  | Optional |
| `OLLAMA_URL`          | Ollama server URL (default: `http://localhost:11434`)                      | Optional |
| `GITPAL_WATCH_PATTERNS` | Directories to monitor (comma-separated)                                   | Optional |
| `GITPAL_IDLE_SECONDS` | Auto-commit idle threshold in seconds (default: 120)                      | Optional |
| `GITPAL_AUTO_PUSH`    | Automatically push after auto-commits (default: `false`)                   | Optional |
| `GITPAL_GITHUB_USERNAME` | GitHub username for repo creation (default: `bb82dabn`)                   | Optional |

These variables are loaded from `~/.gitpal/config.json` and `.env` files.

# gitpal

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

This project was created using `bun init` in bun v1.3.9. [Bun](https://bun.sh) is a fast all-in-one JavaScript runtime.

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
- **Interactive shell hook** for detecting ungitted dirs and starting watchers
- **Daily digest** of project changes and system health
- **Stash management** for uncommitted changes
- **System health checks** for disk, memory, Docker, and Ollama
- **Project context files** for quick reference

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
7. **Server** (`src/server.ts`): Web interface for project monitoring and management

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

Use `docker-compose.yml` if present for containerization:

```bash
docker-compose up -d
```

---

## API Overview

### GitHub API
- `gh auth login`: Authenticate with GitHub
- `gh repo create`: Create new repository
- `gh api user`: Get GitHub username
- `gh deploy`: Custom deploy script execution

### Git API
- `git status`/`git diff`/`git log`: Core Git operations
- `g

---

## Environment Variables

| Variable              | Description                                                                 | Required |
|----------------------|-----------------------------------------------------------------------------|----------|
| `WATCH_PATTERNS`     | Comma-separated list of directories to watch                                | false    |
| `EXCLUDE_PATTERNS`   | Comma-separated list of directories to exclude from watching               | false    |
| `IDLE_SECONDS`       | Seconds of inactivity before auto-committing                               | false    |
| `OLLAMA_MODEL`       | Ollama model to use for AI commit messages                                 | false    |
| `OLLAMA_URL`         | URL of Ollama server                                                       | false    |
| `OPENAI_API_KEY`     | OpenAI API key for AI commit messages                                     | false    |
| `OPENAI_MODEL`       | OpenAI model to use for AI commit messages                                | false    |
| `AI_PROVIDER`        | AI provider (openai/ollama)                                               | false    |
| `GITHUB_USERNAME`    | GitHub username for repo creation and deployment                          | false    |
| `AUTO_PUSH`          | Automatically push changes to remote                                       | false    |

# GitPal Architecture & Patterns

GitPal is an automated Git workflow CLI that streamlines commit messages, project management, and daily digests. Built with Bun runtime and TypeScript, it integrates with GitHub CLI, OpenAI/Ollama, and file watchers.

## Project Purpose

Automated Git workflow tool providing: CLI commands for commits/pushes, background watchers for file changes, web dashboard (port 4242), AI-powered commit messages, and daily digest newspaper ("The GitPal Gazette").

## Tech Stack

- **Runtime**: Bun (see CLAUDE.md for Bun conventions)
- **Language**: TypeScript
- **File Watching**: Chokidar
- **AI Integration**: OpenAI API or Ollama (local)
- **GitHub Integration**: GitHub CLI (gh)
- **UI**: Chalk for terminal output, HTML/React for web dashboard
- **Config**: Zod for schema validation
- **Prompts**: @inquirer/prompts for interactive CLI

## Architecture Overview

### Entry Points

- **CLI (gp)**: src/index.ts — command dispatcher, 22 commands
- **Web Dashboard**: src/server.ts — Bun.serve() on port 4242
- **MCP Server**: src/mcp.ts — Model Context Protocol for AI assistants
- **Watchers**: src/watcher-daemon.ts (single project), src/projects-watcher-daemon.ts (~/projects/*)

### Module Structure

- **src/commands/**: 22 CLI commands (push, status, watch, digest, etc.)
- **src/lib/**: Core modules (AI, config, git, GitHub, deploy, watcher, display, context, readme)
- **src/public/**: Web dashboard HTML/CSS/JS

## Key Conventions

### Command Pattern

Commands are dispatched from index.ts via switch statement. Each command is a separate file in src/commands/ with a run* function. Options are parsed from process.argv and passed as typed objects.

### Config & State

User config stored in ~/.gitpal/config.json (validated with Zod). Session state in ~/.gitpal/sessions/. Project metadata in .gitpal/ directory within each repo.

### AI Integration

ai.ts abstracts OpenAI/Ollama. Supports both APIs via environment variables (OPENAI_API_KEY or OLLAMA_BASE_URL). Used for commit messages, README generation, and digest summaries.

### Background Daemons

- **gp-watcher**: Monitors single project, auto-commits on file changes
- **gp-projects-watcher**: Monitors ~/projects/*, spawns gp-watcher for each project
- Both use Chokidar for file watching, Bun.spawn() for process management

### Display & Output

display.ts provides Chalk-based terminal output (gp.log, gp.error, gp.success). Web dashboard uses Bun.serve() with HTML imports and React components.

## Build & Distribution

Build script compiles 4 binaries: gp, gp-watcher, gp-projects-watcher, gp-server. Installed to ~/.local/bin/. Shell integration via install-shell.sh (cd hook).

## Reference

See CLAUDE.md for Bun-specific conventions (Bun.serve, Bun.file, Bun.$, etc.).

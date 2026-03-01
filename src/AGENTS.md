# src/ Module Structure

Core application modules for GitPal CLI, web server, MCP integration, and background watchers.

## Entry Points

### index.ts
Main CLI dispatcher. Parses process.argv, routes to 22 command handlers via switch statement. Handles --help, --version, and command-specific flags. Exports main() async function.

### server.ts
Web dashboard server. Bun.serve() on port 4242. Serves HTML from src/public/, provides REST API endpoints for project status, logs, and real-time updates. Manages PID file for daemon lifecycle.

### mcp.ts
Model Context Protocol server. Enables AI assistants to query GitPal context, run commands, and access project information. Implements MCP resource and tool handlers.

### watcher-daemon.ts
Single-project file watcher. Uses Chokidar to monitor file changes, auto-commits when thresholds met. Runs as background daemon spawned by gp watch command.

### projects-watcher-daemon.ts
Multi-project watcher. Monitors ~/projects/* directory, spawns gp-watcher for each project. Handles project creation/deletion dynamically.

## Library Modules (src/lib/)

### ai.ts
OpenAI/Ollama abstraction. Generates commit messages, README content, digest summaries. Supports both APIs via environment variables. Handles token counting and streaming responses.

### config.ts
User configuration management. Reads/writes ~/.gitpal/config.json. Zod schema validation. Stores API keys, preferences, project settings.

### git.ts
Git operations wrapper. Executes git commands via Bun.$. Provides: status, log, diff, commit, push, pull, stash, blame, reset. Parses output into typed objects.

### gh.ts
GitHub CLI wrapper. Executes gh commands. Provides: repo info, PR creation, issue queries, release management. Requires gh CLI installed.

### deploy.ts
Docker and deployment utilities. Manages docker-compose, build scripts, deploy.sh execution. Used by deploy command and CI/CD integration.

### watcher.ts
Chokidar file watching abstraction. Configures ignore patterns, debouncing, event handlers. Used by watcher-daemon.ts and watch command.

### display.ts
Terminal output with Chalk. Exports gp object with log, error, success, warn, info methods. Provides banner(), table(), and formatting utilities.

### context.ts
Project context generation. Reads .gitpal/context.json, generates AI-friendly project summary. Used by context command and AI features.

### readme.ts
README generation. Uses AI to create/update README.md based on project structure and git history. Generates GitHub metadata (topics, description).

## Directory Structure

```
src/
  commands/          22 CLI command handlers
  lib/               Core library modules
  public/            Web dashboard HTML/CSS/JS
  index.ts           CLI entry point
  server.ts          Web server
  mcp.ts             MCP server
  watcher-daemon.ts  Single-project watcher
  projects-watcher-daemon.ts  Multi-project watcher
```

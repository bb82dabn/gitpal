# GitPal

Git on autopilot. A CLI tool that watches your projects, commits changes with AI-written messages, pushes to GitHub, and generates a daily newspaper-style digest of everything that happened.

Built for solo developers who want version control without thinking about it.

## What it does

- **Watches your project directories** for file changes and auto-commits after idle periods
- **Generates commit messages** using OpenAI (gpt-4.1-mini) or Ollama — no more "update files" messages
- **Pushes to GitHub** automatically, with offline queue support for when you're disconnected
- **Takes screenshots** of running web projects via headless Chrome
- **Publishes The GitPal Gazette** — a daily AI-written newspaper digest of your work, viewable in a web dashboard at `localhost:4242`
- **Regenerates READMEs** using AI after every push
- **Monitors system health** — disk, memory, Docker containers, AI provider status
- **Runs as systemd services** — survives reboots, auto-restarts dead watchers

## Quick start

```bash
# Install Bun if you don't have it
curl -fsSL https://bun.sh/install | bash

# Clone and install
git clone https://github.com/bb82dabn/gitpal.git
cd gitpal
bun install
bun run install-bin

# Set up
gp setup
```

Setup walks you through connecting GitHub, choosing an AI provider, and configuring which directories to watch.

## Commands

| Command | What it does |
|---|---|
| `gp push` | Stage, commit with AI message, push to GitHub |
| `gp snapshot` | Commit locally without pushing |
| `gp undo` | Safely restore a previous state (always snapshots first) |
| `gp status` | Show all projects and their git status |
| `gp watch` | Start/stop file watchers for a project |
| `gp digest` | Generate The GitPal Gazette |
| `gp doctor` | Full system health check with auto-fix |
| `gp readme` | Regenerate README with AI |
| `gp context` | Generate `.gp/context.md` project cheat sheet |
| `gp new <name>` | Scaffold a new project |
| `gp diff` | Show uncommitted changes |
| `gp log` | Show recent commit history |
| `gp blame <file>` | Git blame with formatting |
| `gp stash` | Stash/unstash uncommitted changes |
| `gp open` | Open the project on GitHub |
| `gp clean` | Remove build artifacts and caches |
| `gp serve` | Start the web dashboard |

## The GitPal Gazette

A daily newspaper-style digest rendered in the web dashboard. Each edition includes:

- AI-written narrative articles about what changed in each project
- Live screenshots of running web applications
- Sidebar with uncommitted work and infrastructure health
- Classic broadsheet layout with serif typography

Run `gp digest` to generate an edition, then visit `localhost:4242` and click the Digest tab.

## Web Dashboard

GitPal includes a web dashboard at `localhost:4242` with:

- **Doctor panel** — live system health (disk, memory, Docker, AI provider, push queue)
- **Projects panel** — all tracked projects with watcher status and last commit
- **Commit feed** — recent commits across all projects
- **Gazette tab** — The GitPal Gazette daily digest

Start it with `gp serve` or let the systemd service handle it.

## Configuration

Stored in `~/.gitpal/config.json`:

```jsonc
{
  "watch_patterns": ["/home/you/projects/*"],
  "idle_seconds": 120,          // seconds of inactivity before auto-commit
  "ai_provider": "openai",     // "openai" or "ollama"
  "openai_api_key": "sk-...",
  "openai_model": "gpt-4.1-mini",
  "auto_push": true
}
```

## Architecture

```
~/.local/bin/
  gp                  CLI (21 commands)
  gp-watcher          per-project file watcher daemon
  gp-projects-watcher watches ~/projects/ for new folders
  gp-server           web dashboard on port 4242

~/.gitpal/
  config.json          configuration
  sessions/            PID files for running daemons
  screenshots/         project screenshots for the Gazette
  log/
    gazette.json       latest Gazette data
    digest.md          plaintext digest
    gitpal.log         watcher activity log
```

Each project gets a `.gp/` directory with `context.md` (project cheat sheet) and `commit-history.md`.

## Requirements

- [Bun](https://bun.sh) v1.3+
- Git
- [GitHub CLI](https://cli.github.com/) (`gh`)
- Google Chrome (for screenshots)
- OpenAI API key or [Ollama](https://ollama.ai) (for AI features)
- Docker (optional, for container health monitoring)
- Linux with systemd (for auto-start services)

## License

MIT

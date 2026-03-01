# src/lib/

Core library modules. Shared logic imported by commands and daemons.

## Modules

| File | Purpose |
|------|---------|
| `ai.ts` | AI integration. OpenAI API and Ollama for commit messages, README generation, Gazette articles, DALL-E images. Handles provider switching and fallback heuristics. |
| `config.ts` | User configuration management. Reads/writes from `~/.config/gitpal/`. Stores AI provider settings, watch patterns, preferences. |
| `git.ts` | Git operations wrapper. Staging, committing, pushing, pulling, log, diff, blame, stash. Uses execa for process execution. |
| `gh.ts` | GitHub CLI (`gh`) wrapper. Repository creation, metadata updates (description, topics, homepage). |
| `deploy.ts` | Auto-deploy support. Detects Docker Compose or custom `deploy.sh` scripts, rebuilds/restarts after push. |
| `watcher.ts` | File system watcher using Chokidar. Monitors project directories for changes, triggers auto-commit after configurable idle timeout. |
| `display.ts` | CLI output formatting with Chalk. Status messages, progress indicators, tables. |
| `context.ts` | Project context generation. Analyzes codebase structure for `.gp/context.md` cheat sheets. |
| `readme.ts` | AI-powered README generation. Analyzes project files, generates structured README content via ai.ts. |

## Dependencies Between Modules

- `ai.ts` reads settings from `config.ts`
- `git.ts` is used by nearly every command
- `gh.ts` depends on GitHub CLI being installed
- `watcher.ts` uses `git.ts` for auto-commits
- `display.ts` is used everywhere for output

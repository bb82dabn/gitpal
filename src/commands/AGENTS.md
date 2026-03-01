# src/commands/

One file per CLI command. Each exports a default async function called by `src/index.ts`.

## Commands

| File | Command | Description |
|------|---------|-------------|
| `push.ts` | `gp push` | Stage all, generate AI commit message, push to GitHub |
| `undo.ts` | `gp undo` | Restore previous states using snapshots |
| `snapshot-log.ts` | `gp snapshot` | Commit locally without pushing |
| `watch.ts` | `gp watch` | Auto-commit after idle timeout |
| `digest.ts` | `gp digest` | Generate The GitPal Gazette daily digest |
| `gazette-pdf.ts` | (internal) | PDF generation for the Gazette |
| `readme.ts` | `gp readme` | AI-generate or update README.md and GitHub metadata |
| `context.ts` | `gp context` | Generate `.gp/context.md` project cheat sheet |
| `new.ts` | `gp new <name>` | Scaffold a new project |
| `doctor.ts` | `gp doctor` | Diagnose repo health, optionally fix issues |
| `recent.ts` | `gp log` | Display git log with JSON and diff options |
| `stash.ts` | `gp stash` | Manage git stashes (push, pop, list) |
| `status.ts` | `gp status` | Show git status |
| `status-hint.ts` | (internal) | Status display with contextual hints |
| `diff.ts` | `gp diff` | Show git diff |
| `blame.ts` | `gp blame` | Show git blame |
| `open.ts` | `gp open` | Open repository on GitHub in browser |
| `clean.ts` | `gp clean` | Clean untracked files |
| `sync.ts` | `gp sync` | Pull and push changes |
| `setup.ts` | `gp setup` | Configure AI provider, watch patterns, settings |
| `init.ts` | `gp init` | Initialize GitPal for a project |
| `shell-hook.ts` | (internal) | Shell cd hook for auto-watcher triggering |

## Pattern

All commands follow the same structure: import from `../lib/`, parse args, execute, display output via `lib/display.ts`.

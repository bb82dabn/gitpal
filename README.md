<p align="center">
  <img src="assets/gitpal-logo.png" width="200" alt="GitPal">
</p>
<h1 align="center">GitPal</h1>
<p align="center">Git on autopilot. Push, commit, watch, and digest — without thinking about it.</p>


## What it does

GitPal watches your projects, auto-commits with AI-generated messages, pushes to GitHub, captures screenshots, and publishes a daily newspaper-style digest called **The GitPal Gazette**.

## Commands

```
gp push          Stage all, AI commit message, push to GitHub
gp push --yes    Same but skip confirmation
gp undo          Restore a previous state (snapshots first)
gp snapshot      Commit locally without pushing
gp watch         Auto-commit after idle timeout
gp digest        Generate The GitPal Gazette
gp readme        AI-generate README + update GitHub metadata
gp context       Generate .gp/context.md project cheat sheet
gp new <name>    Scaffold a new project
gp doctor        Diagnose repo health
gp log           Git log with JSON output option
gp stash         Push, pop, list stashes
gp status        Git status with hints
gp diff          Show diff
gp blame         Git blame
gp open          Open repo on GitHub
gp clean         Clean untracked files
gp sync          Pull + push
```

## The GitPal Gazette

A newspaper-style daily digest of all your projects. Four editions:

| Edition | Time | Lookback |
|---------|------|----------|
| Morning | 6 AM | 6 hours |
| Noon | 12 PM | 6 hours |
| Evening | 6 PM | 6 hours |
| The Midnight Gospel | 12 AM | 24 hours |

Each edition includes:
- AI-written articles for every active project
- DALL-E generated illustrations (featured article + joke cartoons)
- 1-2 satirical "Comics & Oddities" articles
- Project screenshots (Chrome headless, validated)
- Infrastructure health (Docker containers, disk usage)
- Uncommitted work sidebar
- Printable letter-size PDF archive

Browse past editions in the web dashboard at `localhost:4242`.

## Dashboard

`gp-server` runs on port 4242. Shows all watched projects, commit feeds, system health, and the Gazette with archive browser and PDF downloads.

## Background services

- **gp-watcher** — watches a project directory, auto-commits after idle
- **gp-projects-watcher** — watches `~/projects/*` for new repos
- **gp-server** — web dashboard + API on port 4242

All managed via systemd user services.

## Setup

```bash
bun install
bun run build
bun run install-bin    # installs to ~/.local/bin
gp setup               # configure AI provider, watch patterns
gp digest --install-cron  # install 4-edition cron schedule
```

## Requirements

- [Bun](https://bun.sh)
- Git
- Google Chrome (for screenshots and PDF generation)
- OpenAI API key (for AI commit messages, articles, DALL-E images)
- Optional: GitHub CLI (`gh`) for repo creation/metadata
- Optional: Docker for auto-deploy support

## Config

Stored at `~/.gitpal/config.json`. Set via `gp setup` or edit directly.

## License

MIT
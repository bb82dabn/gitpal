/**
 * `gp digest` — The GitPal Gazette.
 * AI-written newspaper-style daily digest with project screenshots.
 * Run manually, or via cron at 9am.
 * Output goes to ~/.gitpal/log/gazette.json and is printed to stdout.
 */

import { readdirSync, statSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { loadConfig } from "../lib/config.ts";
import { isGitRepo, gitStatus, gitDiff } from "../lib/git.ts";
import { aiComplete } from "../lib/ai.ts";
import { gp, banner } from "../lib/display.ts";
import chalk from "chalk";
import { runReadme } from "./readme.ts";

const HOME = homedir();
const GAZETTE_PATH = join(HOME, ".gitpal", "log", "gazette.json");
const DIGEST_PATH = join(HOME, ".gitpal", "log", "digest.md");
const SCREENSHOTS_DIR = join(HOME, ".gitpal", "screenshots");
const CHROME_BIN = "/usr/bin/google-chrome-stable";

// Known non-web ports (databases, caches, etc.)
const DB_PORTS = new Set(["5432", "3306", "27017", "6379", "6380", "6381", "9200", "5672", "2181"]);

// ── Types ─────────────────────────────────────────────────────────────────

export interface GazetteArticle {
  project: string;
  headline: string;
  body: string;
  commits: number;
  linesAdded: number;
  linesRemoved: number;
  screenshot: string | null;
  featured: boolean;
}

export interface GazetteData {
  name: string;
  date: string;
  generated: string;
  edition: string;
  articles: GazetteArticle[];
  uncommitted: Array<{ name: string; changes: number }>;
  health: {
    containers: { total: number; healthy: number; unhealthy: number; names: string[] };
    disk: { text: string; percent: number };
  };
  totalCommits: number;
  totalProjects: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────

async function getProjectDirs(): Promise<string[]> {
  const config = await loadConfig();
  const dirs: string[] = [];
  for (const pattern of config.watch_patterns) {
    const base = pattern.replace("~", HOME).replace(/\/\*$/, "");
    try {
      for (const entry of readdirSync(base)) {
        if (entry.startsWith(".")) continue;
        const full = join(base, entry);
        if (statSync(full).isDirectory()) dirs.push(full);
      }
    } catch { /* ok */ }
  }
  return dirs;
}

async function getYesterdayCommits(dir: string): Promise<string[]> {
  try {
    const r = await Bun.$`git -C ${dir} log --oneline --since="yesterday" --until="now"`.quiet().nothrow();
    return r.stdout.toString().trim().split("\n").filter(Boolean);
  } catch { return []; }
}

async function getYesterdayDiffStats(dir: string): Promise<{ added: number; removed: number; files: string[] }> {
  try {
    const r = await Bun.$`git -C ${dir} log --since="yesterday" --until="now" --stat --format=""`.quiet().nothrow();
    const output = r.stdout.toString();
    let added = 0, removed = 0;
    const files: string[] = [];

    for (const line of output.split("\n")) {
      const fileMatch = line.match(/^\s*(.+?)\s+\|\s+\d+/);
      if (fileMatch) files.push(fileMatch[1].trim());

      const statMatch = line.match(/(\d+) insertions?\(\+\)/);
      const delMatch = line.match(/(\d+) deletions?\(-\)/);
      if (statMatch) added += parseInt(statMatch[1], 10);
      if (delMatch) removed += parseInt(delMatch[1], 10);
    }

    return { added, removed, files };
  } catch { return { added: 0, removed: 0, files: [] }; }
}

async function getContainerStatus(): Promise<{ healthy: string[]; unhealthy: string[] }> {
  const healthy: string[] = [];
  const unhealthy: string[] = [];
  try {
    const r = await Bun.$`docker ps --format "{{.Names}}|{{.Status}}"`.quiet().nothrow();
    for (const line of r.stdout.toString().trim().split("\n").filter(Boolean)) {
      const [name, status] = line.split("|");
      if (!name) continue;
      if ((status ?? "").includes("unhealthy") || (status ?? "").includes("Restarting")) {
        unhealthy.push(`${name} (${status})`);
      } else {
        healthy.push(name);
      }
    }
  } catch { /* docker not available */ }
  return { healthy, unhealthy };
}

async function getDiskUsage(): Promise<{ text: string; percent: number }> {
  try {
    const r = await Bun.$`df -h /`.quiet().nothrow();
    const line = r.stdout.toString().split("\n")[1] ?? "";
    const parts = line.split(/\s+/);
    const percent = parseInt((parts[4] ?? "0").replace("%", ""), 10);
    return {
      text: `${parts[2] ?? "?"} used of ${parts[1] ?? "?"} (${parts[4] ?? "?"}%)`,
      percent: Number.isFinite(percent) ? percent : 0,
    };
  } catch { return { text: "unknown", percent: 0 }; }
}

// ── Screenshot capture ────────────────────────────────────────────────────

function getWebPort(projectDir: string): string | null {
  // Check docker-compose.yml for port mappings
  for (const composeName of ["docker-compose.yml", "docker-compose.yaml"]) {
    const composePath = join(projectDir, composeName);
    if (!existsSync(composePath)) continue;

    try {
      const content = readFileSync(composePath, "utf8");
      // Match port mappings like "3456:80" or "4840:3000"
      const portMatches = content.match(/["']?(\d+):\d+["']?/g) ?? [];
      for (const match of portMatches) {
        const hostPort = match.replace(/["']/g, "").split(":")[0];
        if (hostPort && !DB_PORTS.has(hostPort)) return hostPort;
      }
    } catch { /* ok */ }
  }

  return null;
}

async function captureScreenshot(projectName: string, port: string): Promise<string | null> {
  mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  const outPath = join(SCREENSHOTS_DIR, `${projectName}.png`);
  const url = `http://localhost:${port}/`;

  try {
    const result = await Bun.$`${CHROME_BIN} --headless --disable-gpu --no-sandbox --screenshot=${outPath} --window-size=1280,800 ${url}`.quiet().nothrow().timeout(15_000);
    if (result.exitCode === 0 && existsSync(outPath)) {
      return `${projectName}.png`;
    }
  } catch { /* timeout or crash */ }

  return null;
}

// ── AI narrative generation ───────────────────────────────────────────────

async function generateArticle(
  projectName: string,
  commits: string[],
  stats: { added: number; removed: number; files: string[] },
): Promise<{ headline: string; body: string }> {
  const commitList = commits.slice(0, 15).join("\n");
  const fileList = stats.files.slice(0, 20).join(", ");

  const prompt = `You are a newspaper journalist writing for "The GitPal Gazette," a daily tech newspaper.
Write a short article (2-3 sentences) about the following code changes in the project "${projectName}".

Yesterday's commits:
${commitList}

Changes: ${stats.added} lines added, ${stats.removed} lines removed.
Files changed: ${fileList || "various files"}

Rules:
- Write in a journalistic, matter-of-fact newspaper style (think NY Times tech section)
- Focus on what was accomplished and why it matters
- Be specific about features and changes — no vague statements
- Do NOT use buzzwords, marketing language, or exclamation marks
- Output ONLY the article body text. No headline, no quotes around it, no markdown.`;

  const headlinePrompt = `Write a newspaper headline (max 8 words) for this software project update:
Project: ${projectName}
Commits: ${commitList}
Output ONLY the headline text. No quotes, no period at the end, no markdown.`;

  // Run headline and body in parallel
  const [body, headline] = await Promise.all([
    aiComplete(prompt, 200),
    aiComplete(headlinePrompt, 30),
  ]);

  return {
    headline: headline ?? `Updates Ship for ${projectName.charAt(0).toUpperCase() + projectName.slice(1)}`,
    body: body ?? `The ${projectName} project saw ${commits.length} commit(s) yesterday, with ${stats.added} lines added and ${stats.removed} lines removed across ${stats.files.length} file(s).`,
  };
}

// ── Main export ───────────────────────────────────────────────────────────

export async function runDigest(quiet = false): Promise<void> {
  if (!quiet) {
    banner();
    gp.header("The GitPal Gazette");
    gp.info("Gathering stories...");
    gp.blank();
  }

  const dirs = await getProjectDirs();
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const timeStr = now.toLocaleTimeString();

  // Determine edition based on time of day
  const hour = now.getHours();
  const edition = hour < 12 ? "Morning Edition" : hour < 17 ? "Afternoon Edition" : "Evening Edition";

  // ── Collect project data ──────────────────────────────────────────────
  const articles: GazetteArticle[] = [];
  let totalCommits = 0;

  for (const dir of dirs) {
    if (!(await isGitRepo(dir))) continue;
    const commits = await getYesterdayCommits(dir);
    if (commits.length === 0) continue;

    const name = dir.split("/").pop() ?? dir;
    totalCommits += commits.length;
    const stats = await getYesterdayDiffStats(dir);

    if (!quiet) gp.info(`Writing article for ${chalk.cyan(name)}...`);

    // Generate AI narrative
    const { headline, body } = await generateArticle(name, commits, stats);

    // Try to capture screenshot
    const port = getWebPort(dir);
    let screenshot: string | null = null;
    if (port) {
      if (!quiet) gp.info(`  Capturing screenshot (port ${port})...`);
      screenshot = await captureScreenshot(name, port);
    }

    articles.push({
      project: name,
      headline,
      body,
      commits: commits.length,
      linesAdded: stats.added,
      linesRemoved: stats.removed,
      screenshot,
      featured: false,
    });
  }

  // Mark the article with the most commits as featured
  if (articles.length > 0) {
    const sorted = [...articles].sort((a, b) => b.commits - a.commits);
    sorted[0].featured = true;
  }

  // ── Uncommitted work ──────────────────────────────────────────────────
  const uncommitted: Array<{ name: string; changes: number }> = [];
  for (const dir of dirs) {
    if (!(await isGitRepo(dir))) continue;
    const status = await gitStatus(dir);
    if (status.hasChanges) {
      uncommitted.push({
        name: dir.split("/").pop() ?? dir,
        changes: status.staged + status.unstaged + status.untracked,
      });
    }
  }

  // ── System health ─────────────────────────────────────────────────────
  const { healthy, unhealthy } = await getContainerStatus();
  const disk = await getDiskUsage();

  // ── Build gazette data ────────────────────────────────────────────────
  const gazette: GazetteData = {
    name: "The GitPal Gazette",
    date: dateStr,
    generated: timeStr,
    edition,
    articles,
    uncommitted,
    health: {
      containers: {
        total: healthy.length + unhealthy.length,
        healthy: healthy.length,
        unhealthy: unhealthy.length,
        names: unhealthy,
      },
      disk,
    },
    totalCommits,
    totalProjects: articles.length,
  };

  // ── Save to files ─────────────────────────────────────────────────────
  mkdirSync(join(HOME, ".gitpal", "log"), { recursive: true });
  writeFileSync(GAZETTE_PATH, JSON.stringify(gazette, null, 2));

  // Also write legacy digest.md for backwards compat
  const mdLines: string[] = [];
  mdLines.push(`# The GitPal Gazette — ${dateStr}`);
  mdLines.push(`*${edition} · Generated at ${timeStr}*`);
  mdLines.push("");
  for (const article of articles) {
    mdLines.push(`## ${article.headline}`);
    mdLines.push(`**${article.project}** · ${article.commits} commit(s) · +${article.linesAdded} -${article.linesRemoved}`);
    mdLines.push("");
    mdLines.push(article.body);
    mdLines.push("");
  }
  if (uncommitted.length > 0) {
    mdLines.push("## On the Editor's Desk");
    for (const p of uncommitted) mdLines.push(`- **${p.name}** — ${p.changes} file(s) uncommitted`);
    mdLines.push("");
  }
  mdLines.push("## Infrastructure Report");
  if (unhealthy.length > 0) {
    mdLines.push(`⚠ ${unhealthy.length} unhealthy container(s)`);
  } else {
    mdLines.push(`✓ All ${healthy.length} container(s) healthy`);
  }
  mdLines.push(`Disk: ${disk.text}`);
  mdLines.push("");
  writeFileSync(DIGEST_PATH, mdLines.join("\n"));

  // ── Terminal output ───────────────────────────────────────────────────
  if (!quiet) {
    gp.blank();
    console.log(chalk.bold.underline(`  THE GITPAL GAZETTE`));
    console.log(chalk.dim(`  ${edition} · ${dateStr}`));
    gp.blank();

    if (articles.length === 0) {
      gp.info("No commits yesterday — slow news day.");
    } else {
      for (const article of articles) {
        const marker = article.featured ? chalk.yellow("★") : chalk.dim("·");
        console.log(`  ${marker} ${chalk.bold(article.headline)}`);
        console.log(chalk.dim(`    ${article.project} · ${article.commits} commits · +${article.linesAdded} -${article.linesRemoved}`));
        // Wrap body text
        const words = article.body.split(" ");
        let line = "    ";
        for (const word of words) {
          if (line.length + word.length > 80) {
            console.log(line);
            line = "    " + word;
          } else {
            line += (line.length > 4 ? " " : "") + word;
          }
        }
        if (line.trim()) console.log(line);
        gp.blank();
      }
    }

    if (uncommitted.length > 0) {
      gp.warn(`Uncommitted: ${uncommitted.map(p => p.name).join(", ")}`);
    }
    if (unhealthy.length > 0) {
      gp.warn(`Unhealthy: ${unhealthy.join(", ")}`);
    } else if (healthy.length > 0) {
      gp.success(`${healthy.length} container(s) healthy`);
    }
    gp.info(`Disk: ${disk.text}`);
    gp.blank();
    console.log(chalk.dim(`  Gazette saved to: ${GAZETTE_PATH}`));
    gp.blank();
  }
}

/** Regenerate README for every project — called by daily cron */
export async function runDailyReadmeRefresh(quiet = false): Promise<void> {
  const dirs = await getProjectDirs();
  for (const dir of dirs) {
    const name = dir.split("/").pop() ?? dir;
    if (!quiet) gp.info(`Refreshing README for ${name}...`);
    await runReadme(dir).catch(() => { /* non-fatal */ });
  }
}

/** Install a cron job to run `gp digest --cron` at 9am daily */
export async function installDigestCron(): Promise<void> {
  const gpPath = join(HOME, ".local", "bin", "gp");
  const cronLine = `0 9 * * * ${gpPath} digest --cron >> ${join(HOME, ".gitpal", "log", "digest-cron.log")} 2>&1`;

  const existing = await Bun.$`crontab -l`.quiet().nothrow();
  const currentCron = existing.exitCode === 0 ? existing.stdout.toString() : "";

  if (currentCron.includes("gp digest")) {
    gp.info("Digest cron job already installed.");
    return;
  }

  const newCron = currentCron.trimEnd() + "\n" + cronLine + "\n";
  const tmpFile = join(HOME, ".gitpal", "_cron.tmp");
  await Bun.write(tmpFile, newCron);
  const result = await Bun.$`crontab ${tmpFile}`.quiet().nothrow();
  await Bun.$`rm -f ${tmpFile}`.quiet().nothrow();
  if (result.exitCode !== 0) {
    gp.error(`Failed to install cron: ${result.stderr.toString().trim()}`);
    return;
  }
  gp.success("Digest cron job installed — runs daily at 9am.");
  gp.info(`Log: ${join(HOME, ".gitpal", "log", "digest-cron.log")}`);
}

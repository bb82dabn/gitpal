/**
 * `gp digest` — The GitPal Gazette.
 * AI-written newspaper-style daily digest with project screenshots.
 * Run manually, or via cron at 9am.
 * Output goes to ~/.gitpal/log/gazette.json (latest) and archived to ~/.gitpal/log/gazette/YYYY-MM-DD/EDITION.json.
 */

import { readdirSync, statSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { loadConfig } from "../lib/config.ts";
import { isGitRepo, gitStatus, gitDiff } from "../lib/git.ts";
import { aiComplete, aiImageToFile } from "../lib/ai.ts";
import { gp, banner } from "../lib/display.ts";
import chalk from "chalk";
import { runReadme } from "./readme.ts";
import { generateGazettePdf } from "./gazette-pdf.ts";

const HOME = homedir();
const LOG_DIR = join(HOME, ".gitpal", "log");
const GAZETTE_PATH = join(LOG_DIR, "gazette.json");
const GAZETTE_MORNING_PATH = join(LOG_DIR, "gazette-morning.json");
const GAZETTE_NOON_PATH = join(LOG_DIR, "gazette-noon.json");
const GAZETTE_EVENING_PATH = join(LOG_DIR, "gazette-evening.json");
const GAZETTE_MIDNIGHT_PATH = join(LOG_DIR, "gazette-midnight.json");
const GAZETTE_ARCHIVE_DIR = join(LOG_DIR, "gazette");
const DIGEST_PATH = join(LOG_DIR, "digest.md");
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
  joke?: boolean;
  aiGeneratedImage?: string | null;
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

async function getCommitsSince(dir: string, hours: number): Promise<string[]> {
  try {
    const r = await Bun.$`git -C ${dir} log --oneline --since="${hours} hours ago" --until="now"`.quiet().nothrow();
    return r.stdout.toString().trim().split("\n").filter(Boolean);
  } catch { return []; }
}

async function getDiffStatsSince(dir: string, hours: number): Promise<{ added: number; removed: number; files: string[] }> {
  try {
    const r = await Bun.$`git -C ${dir} log --since="${hours} hours ago" --until="now" --stat --format=""`.quiet().nothrow();
    const output = r.stdout.toString();
    let added = 0, removed = 0;
    const files: string[] = [];
    for (const line of output.split("\n")) {
      const fileMatch = line.match(/^\s*(.+?)\s+\|\s+\d+/);
      if (fileMatch?.[1]) files.push(fileMatch[1].trim());
      const statMatch = line.match(/(\d+) insertions?\(\+\)/);
      const delMatch = line.match(/(\d+) deletions?\(-\)/);
      if (statMatch?.[1]) added += parseInt(statMatch[1], 10);
      if (delMatch?.[1]) removed += parseInt(delMatch[1], 10);
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

  // Pre-check: is the port actually serving HTTP?
  try {
    const probe = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!probe.ok) return null;
    const ct = probe.headers.get("content-type") ?? "";
    // Skip non-HTML responses (API-only services, raw JSON, etc.)
    if (!ct.includes("html") && !ct.includes("text")) return null;
  } catch { return null; }

  try {
    const proc = Bun.spawn([CHROME_BIN, "--headless", "--disable-gpu", "--no-sandbox", `--screenshot=${outPath}`, "--window-size=1280,800", url], { stdout: "ignore", stderr: "ignore" });
    const timer = setTimeout(() => proc.kill(), 15_000);
    await proc.exited;
    clearTimeout(timer);
    if (existsSync(outPath)) {
      // Skip tiny screenshots — likely error pages or blank screens
      const size = statSync(outPath).size;
      if (size < 50_000) {
        try { Bun.spawnSync(["rm", "-f", outPath]); } catch {}
        return null;
      }
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
  isMidnight = false,
): Promise<{ headline: string; body: string }> {
  const commitList = commits.slice(0, 20).join("\n");
  const fileList = stats.files.slice(0, 20).join(", ");
  const window = isMidnight ? "last 24 hours" : "recent hours";

  const prompt = isMidnight
    ? `You are a senior journalist writing the comprehensive nightly edition of "The GitPal Gazette."
Write a detailed 3-4 sentence retrospective on the project "${projectName}" covering everything accomplished in the last 24 hours.

Commits: ${commitList}

Changes: ${stats.added} lines added, ${stats.removed} lines removed.
Files: ${fileList || "various files"}

Rules:
- Write in a reflective, authoritative newspaper style — this is the day's final word
- Synthesize the day's work into a coherent narrative
- Be specific. No buzzwords, no exclamation marks.
- Output ONLY the article body text. No headline, no markdown.`
    : `You are a newspaper journalist writing for "The GitPal Gazette."
Write a short article (2-3 sentences) about the following code changes in the project "${projectName}".

Recent commits:
${commitList}

Changes: ${stats.added} lines added, ${stats.removed} lines removed.
Files changed: ${fileList || "various files"}

Rules:
- Write in a journalistic, matter-of-fact newspaper style (think NY Times tech section)
- Focus on what was accomplished and why it matters
- Be specific about features and changes — no vague statements
- Do NOT use buzzwords, marketing language, or exclamation marks
- Output ONLY the article body text. No headline, no quotes around it, no markdown.`;

  const headlinePrompt = isMidnight
    ? `Write a newspaper headline (max 10 words) for this 24-hour retrospective of software project "${projectName}":
${commitList}
Output ONLY the headline. No quotes, no period, no markdown.`
    : `Write a newspaper headline (max 8 words) for this software project update:
Project: ${projectName}
Commits: ${commitList}
Output ONLY the headline text. No quotes, no period at the end, no markdown.`;

  const [body, headline] = await Promise.all([
    aiComplete(prompt, isMidnight ? 300 : 200),
    aiComplete(headlinePrompt, 30),
  ]);

  return {
    headline: headline ?? `Updates Ship for ${projectName.charAt(0).toUpperCase() + projectName.slice(1)}`,
    body: body ?? `The ${projectName} project saw ${commits.length} commit(s) in the ${window}, with ${stats.added} lines added and ${stats.removed} removed.`,
  };
}
async function generateJokeArticles(
  realArticles: GazetteArticle[],
  edition: string,
): Promise<GazetteArticle[]> {
  if (realArticles.length === 0) return [];

  // Pick 1-2 projects to satirize — prefer the most active ones
  const count = realArticles.length >= 4 ? 2 : 1;
  const pool = [...realArticles].sort((a, b) => b.commits - a.commits).slice(0, 5);
  const picks: GazetteArticle[] = [];
  const used = new Set<string>();
  while (picks.length < count && pool.length > used.size) {
    const idx = Math.floor(Math.random() * pool.length);
    const pick = pool[idx]!;
    if (!used.has(pick.project)) { picks.push(pick); used.add(pick.project); }
  }

  return Promise.all(picks.map(async (real) => {
    const projectDesc = `${real.project} (${real.commits} commits, +${real.linesAdded} -${real.linesRemoved} lines)`;

    const bodyPrompt = `You are a satirical tech columnist writing the "Comics & Oddities" section of The GitPal Gazette.
Write a 2-3 sentence absurdist, funny fake news article about the software project "${real.project}" for the ${edition}.
Base it loosely on this real activity: ${projectDesc}.
Think: AI sentience, robot uprising, developer drama, tech industry satire, extremely mundane events treated as epic news.
Be specific to the project name and what it plausibly does. Be genuinely funny, not just random.
Output ONLY the article body. No headline, no quotes, no markdown.`;

    const headlinePrompt = `Write a funny satirical newspaper headline (max 10 words) for a joke article about the software project "${real.project}".
The real activity was: ${projectDesc}.
Make it absurdist or deadpan. Output ONLY the headline. No quotes, no period, no markdown.`;

    const [body, headline] = await Promise.all([
      aiComplete(bodyPrompt, 200),
      aiComplete(headlinePrompt, 30),
    ]);

    return {
      project: real.project,
      headline: headline ?? `${real.project} Does Something Unprecedented`,
      body: body ?? `The ${real.project} project continues to raise questions no one asked.`,
      commits: real.commits,
      linesAdded: real.linesAdded,
      linesRemoved: real.linesRemoved,
      screenshot: null,
      featured: false,
      joke: true,
    } as GazetteArticle & { joke: true };
  }));
}

// ── Main export ───────────────────────────────────────────────────────────

export async function runDigest(quiet = false, forceEdition?: "morning" | "noon" | "evening" | "midnight"): Promise<void> {
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
  const dateKey = now.toISOString().slice(0, 10); // e.g. 2026-02-28

  // Determine edition based on time of day (or forced override)
  const hour = now.getHours();
  let edition: string;
  let editionKey: "morning" | "noon" | "evening" | "midnight";
  let lookbackHours: number;
  if (forceEdition) {
    editionKey = forceEdition;
    edition = forceEdition === "morning" ? "Morning Edition"
      : forceEdition === "noon" ? "Noon Edition"
      : forceEdition === "evening" ? "Evening Edition"
      : "The Midnight Gospel";
    lookbackHours = forceEdition === "midnight" ? 24 : 6;
  } else if (hour === 0) {
    edition = "The Midnight Gospel";
    editionKey = "midnight";
    lookbackHours = 24;
  } else if (hour < 12) {
    edition = "Morning Edition";
    editionKey = "morning";
    lookbackHours = 6;
  } else if (hour < 18) {
    edition = "Noon Edition";
    editionKey = "noon";
    lookbackHours = 6;
  } else {
    edition = "Evening Edition";
    editionKey = "evening";
    lookbackHours = 6;
  }

  // ── Collect project data ──────────────────────────────────────────────
  const articles: GazetteArticle[] = [];
  let totalCommits = 0;

  for (const dir of dirs) {
    if (!(await isGitRepo(dir))) continue;
    const commits = await getCommitsSince(dir, lookbackHours);
    if (commits.length === 0) continue;

    const name = dir.split("/").pop() ?? dir;
    totalCommits += commits.length;
    const stats = await getDiffStatsSince(dir, lookbackHours);

    if (!quiet) gp.info(`Writing article for ${chalk.cyan(name)}...`);

    // Generate AI narrative
    const { headline, body } = await generateArticle(name, commits, stats, editionKey === "midnight");

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

  // Mark featured + generate illustration
  if (articles.length > 0) {
    const sorted = [...articles].sort((a, b) => b.commits - a.commits);
    sorted[0]!.featured = true;
    const feat = sorted[0]!;
    if (!quiet) gp.info(`Generating illustration for "${feat.project}"...`);
    const featImgPath = join(SCREENSHOTS_DIR, `gazette-${dateKey}-${editionKey}-${feat.project}.png`);
    const featPrompt = `A vintage newspaper woodcut engraving illustration for a tech article titled "${feat.headline}" about a software project called "${feat.project}". Style: 1920s editorial illustration, black and white crosshatching, dramatic composition, absolutely no text or words in the image.`;
    const featSaved = await aiImageToFile(featPrompt, featImgPath, "natural").catch(() => null);
    if (featSaved) feat.aiGeneratedImage = `/screenshots/gazette-${dateKey}-${editionKey}-${feat.project}.png`;
  }

  // ── Joke articles (Comics & Oddities section) ────────────────────────────
  if (!quiet) gp.info("Writing joke articles + generating cartoons...");
  const jokeArticles = await generateJokeArticles(articles, edition);
  await Promise.all(jokeArticles.map(async (joke) => {
    const jokeImgPath = join(SCREENSHOTS_DIR, `gazette-${dateKey}-${editionKey}-${joke.project}-joke.png`);
    const jokePrompt = `A satirical editorial cartoon for a funny tech newspaper article titled "${joke.headline}" about software project "${joke.project}". Style: absurdist pen-and-ink comic, exaggerated characters, humorous. Absolutely no text or words in the image.`;
    const jokeSaved = await aiImageToFile(jokePrompt, jokeImgPath, "vivid").catch(() => null);
    if (jokeSaved) joke.aiGeneratedImage = `/screenshots/gazette-${dateKey}-${editionKey}-${joke.project}-joke.png`;
  }));
  articles.push(...jokeArticles);

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
  mkdirSync(LOG_DIR, { recursive: true });

  // Archive by date: ~/.gitpal/log/gazette/YYYY-MM-DD/morning.json
  const archiveDayDir = join(GAZETTE_ARCHIVE_DIR, dateKey);
  mkdirSync(archiveDayDir, { recursive: true });
  writeFileSync(join(archiveDayDir, `${editionKey}.json`), JSON.stringify(gazette, null, 2));

  // Generate PDF archive
  if (!quiet) gp.info("Generating PDF...");
  const pdfPath = await generateGazettePdf(gazette, archiveDayDir, editionKey).catch(() => null);
  if (!quiet) {
    if (pdfPath) gp.success(`PDF saved: ${pdfPath}`);
    else gp.warn("PDF generation failed (non-fatal)");
  }

  // Current-edition files (morning/noon/evening)
  const editionPath = editionKey === "morning" ? GAZETTE_MORNING_PATH
    : editionKey === "noon" ? GAZETTE_NOON_PATH
    : editionKey === "evening" ? GAZETTE_EVENING_PATH
    : GAZETTE_MIDNIGHT_PATH;
  writeFileSync(editionPath, JSON.stringify(gazette, null, 2));
  // Keep gazette.json as latest
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

/** Install cron jobs for all four Gazette editions: 6am, noon, 6pm, midnight */
export async function installDigestCron(): Promise<void> {
  const gpPath = join(HOME, ".local", "bin", "gp");
  const logPath = join(HOME, ".gitpal", "log", "digest-cron.log");
  const cronLines = [
    `0 6  * * * ${gpPath} digest --cron >> ${logPath} 2>&1`,
    `0 12 * * * ${gpPath} digest --cron >> ${logPath} 2>&1`,
    `0 18 * * * ${gpPath} digest --cron >> ${logPath} 2>&1`,
    `0 0  * * * ${gpPath} digest --cron >> ${logPath} 2>&1`,
  ];

  const existing = await Bun.$`crontab -l`.quiet().nothrow();
  const currentCron = existing.exitCode === 0 ? existing.stdout.toString() : "";

  const withoutOld = currentCron
    .split("\n")
    .filter(l => !l.includes("gp digest"))
    .join("\n")
    .trimEnd();

  const newCron = withoutOld + "\n" + cronLines.join("\n") + "\n";
  const tmpFile = join(HOME, ".gitpal", "_cron.tmp");
  await Bun.write(tmpFile, newCron);
  const result = await Bun.$`crontab ${tmpFile}`.quiet().nothrow();
  await Bun.$`rm -f ${tmpFile}`.quiet().nothrow();
  if (result.exitCode !== 0) {
    gp.error(`Failed to install cron: ${result.stderr.toString().trim()}`);
    return;
  }
  gp.success("Gazette crons installed — 6am, noon, 6pm, midnight.");
  gp.info(`Log: ${logPath}`);
}

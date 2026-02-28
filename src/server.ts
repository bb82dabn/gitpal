#!/usr/bin/env bun
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { gitDiff, gitLog, gitStatus, hasRemote, isGitRepo } from "./lib/git.ts";
import { loadConfig, type GitPalConfig } from "./lib/config.ts";

type DoctorStatus = "pass" | "warn" | "fail";

interface DoctorItem {
  label: string;
  status: DoctorStatus;
  detail: string;
}

interface ProjectSummary {
  name: string;
  lastCommit: {
    hash: string;
    message: string;
    relativeDate: string;
  };
  dirty: boolean;
  changedFiles: number;
  watcherRunning: boolean;
  hasRemote: boolean;
  remoteUrl: string;
}

interface ActionRequest {
  action: "push" | "sync" | "undo";
  project: string;
}

const HOME = homedir();
const SESSIONS_DIR = join(HOME, ".gitpal", "sessions");
const SERVER_PID = join(SESSIONS_DIR, "gp-server.pid");
const PORT = 4242;

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function textResponse(data: string, status = 200): Response {
  return new Response(data, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

function expandHome(path: string): string {
  return path.replace(/^~(?=\/|$)/, HOME);
}

function getWatchRoots(config: GitPalConfig): string[] {
  const patterns = config.watch_patterns.length > 0 ? config.watch_patterns : ["~/projects/*"];
  const roots = patterns
    .map((pattern) => expandHome(pattern).replace(/\/\*$/, ""))
    .filter((root) => existsSync(root));

  return roots.length > 0 ? roots : [join(HOME, "projects")];
}

function parseSize(value: string): number {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)([A-Za-z]+)$/);
  if (!match) return 0;
  const amount = Number(match[1]);
  const unit = (match[2] ?? "").toLowerCase();
  const multipliers: Record<string, number> = {
    b: 1,
    k: 1024,
    kb: 1024,
    ki: 1024,
    kib: 1024,
    m: 1024 ** 2,
    mb: 1024 ** 2,
    mi: 1024 ** 2,
    mib: 1024 ** 2,
    g: 1024 ** 3,
    gb: 1024 ** 3,
    gi: 1024 ** 3,
    gib: 1024 ** 3,
    t: 1024 ** 4,
    tb: 1024 ** 4,
    ti: 1024 ** 4,
    tib: 1024 ** 4,
  };
  return amount * (multipliers[unit] ?? 0);
}

async function isPidRunning(pid: number): Promise<boolean> {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  const result = await Bun.$`kill -0 ${pid}`.quiet().nothrow();
  return result.exitCode === 0;
}

function slugify(dir: string): string {
  return dir.replace(/[^a-zA-Z0-9]/g, "_").replace(/_+/g, "_").slice(-40);
}

async function isWatcherRunning(projectDir: string): Promise<boolean> {
  const pidFile = join(SESSIONS_DIR, `${slugify(projectDir)}.pid`);
  if (!existsSync(pidFile)) return false;
  const raw = await Bun.file(pidFile).text();
  const pid = parseInt(raw.trim(), 10);
  if (!Number.isFinite(pid)) return false;
  return isPidRunning(pid);
}

async function getRemoteUrl(dir: string): Promise<string> {
  const result = await Bun.$`git -C ${dir} remote get-url origin`.quiet().nothrow();
  if (result.exitCode !== 0) return "";
  return result.stdout.toString().trim();
}

async function listProjects(): Promise<ProjectSummary[]> {
  const config = await loadConfig();
  const roots = getWatchRoots(config);
  const projects: ProjectSummary[] = [];

  for (const root of roots) {
    let entries: string[] = [];
    try {
      entries = readdirSync(root);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.startsWith(".")) continue;
      const fullPath = join(root, entry);
      try {
        if (!statSync(fullPath).isDirectory()) continue;
      } catch {
        continue;
      }

      if (!(await isGitRepo(fullPath))) continue;
      const status = await gitStatus(fullPath);
      const commits = await gitLog(fullPath, 1);
      const lastCommit = commits[0];
      const remoteExists = await hasRemote(fullPath);
      const remoteUrl = remoteExists ? await getRemoteUrl(fullPath) : "";
      const watcherRunning = await isWatcherRunning(fullPath);
      const changedFiles = status.staged + status.unstaged + status.untracked;

      projects.push({
        name: entry,
        lastCommit: lastCommit
          ? { hash: lastCommit.shortHash, message: lastCommit.message, relativeDate: lastCommit.relativeDate }
          : { hash: "", message: "No commits yet", relativeDate: "" },
        dirty: status.hasChanges,
        changedFiles,
        watcherRunning,
        hasRemote: remoteExists,
        remoteUrl,
      });
    }
  }

  return projects.sort((a, b) => a.name.localeCompare(b.name));
}

async function resolveProjectDir(project: string): Promise<string | null> {
  const config = await loadConfig();
  const roots = getWatchRoots(config);
  for (const root of roots) {
    const candidate = join(root, project);
    try {
      if (statSync(candidate).isDirectory()) return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

async function getDoctorItems(): Promise<DoctorItem[]> {
  const items: DoctorItem[] = [];

  const diskResult = await Bun.$`df -h /`.quiet().nothrow();
  if (diskResult.exitCode === 0) {
    const lines = diskResult.stdout.toString().trim().split("\n");
    const parts = lines[1]?.split(/\s+/) ?? [];
    const percentRaw = parts[4] ?? "";
    const percent = parseInt(percentRaw.replace("%", ""), 10);
    const status: DoctorStatus = Number.isFinite(percent)
      ? (percent >= 90 ? "fail" : percent >= 80 ? "warn" : "pass")
      : "warn";
    const detail = Number.isFinite(percent) ? `${percent}% used` : "usage unavailable";
    items.push({ label: "Disk", status, detail });
  } else {
    items.push({ label: "Disk", status: "fail", detail: diskResult.stderr.toString().trim() || "df failed" });
  }

  const memResult = await Bun.$`free -h`.quiet().nothrow();
  if (memResult.exitCode === 0) {
    const lines = memResult.stdout.toString().trim().split("\n");
    const memLine = lines.find((line) => line.startsWith("Mem:")) ?? "";
    const parts = memLine.split(/\s+/);
    const total = parts[1] ?? "";
    const used = parts[2] ?? "";
    const usedBytes = parseSize(used);
    const totalBytes = parseSize(total);
    const ratio = totalBytes > 0 ? usedBytes / totalBytes : 0;
    const status: DoctorStatus = totalBytes === 0 ? "warn" : (ratio >= 0.9 ? "fail" : ratio >= 0.8 ? "warn" : "pass");
    const detail = total && used ? `${used} used / ${total} total` : "memory unavailable";
    items.push({ label: "Memory", status, detail });
  } else {
    items.push({ label: "Memory", status: "fail", detail: memResult.stderr.toString().trim() || "free failed" });
  }

  const dockerResult = await Bun.$`docker ps`.quiet().nothrow();
  if (dockerResult.exitCode === 0) {
    const lines = dockerResult.stdout.toString().trim().split("\n").filter(Boolean);
    const count = Math.max(lines.length - 1, 0);
    items.push({ label: "Docker", status: "pass", detail: `${count} running` });
  } else {
    items.push({ label: "Docker", status: "fail", detail: dockerResult.stderr.toString().trim() || "docker failed" });
  }

  const queuePath = join(HOME, ".gitpal", "push-queue.json");
  const queueFile = Bun.file(queuePath);
  if (await queueFile.exists()) {
    try {
      const queue = await queueFile.json() as unknown[];
      const count = Array.isArray(queue) ? queue.length : 0;
      items.push({
        label: "Push Queue",
        status: count > 0 ? "warn" : "pass",
        detail: count > 0 ? `${count} queued` : "empty",
      });
    } catch (err) {
      items.push({ label: "Push Queue", status: "warn", detail: err instanceof Error ? err.message : "invalid queue" });
    }
  } else {
    items.push({ label: "Push Queue", status: "pass", detail: "empty" });
  }

  return items;
}

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const { pathname } = url;

  if (pathname === "/" && req.method === "GET") {
    // In compiled binary, import.meta.url doesn't resolve to source dir.
    // Read from installed share path, falling back to source tree.
    const sharePath = join(HOME, ".local", "share", "gitpal", "index.html");
    const srcPath = join(HOME, "projects", "gitpal", "src", "public", "index.html");
    const htmlPath = existsSync(sharePath) ? sharePath : srcPath;
    const html = await Bun.file(htmlPath).text();
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  if (pathname === "/logo.png" && req.method === "GET") {
    const shareLogo = join(HOME, ".local", "share", "gitpal", "logo.png");
    const srcLogo = join(HOME, "projects", "gitpal", "assets", "logo.png");
    const logoPath = existsSync(shareLogo) ? shareLogo : srcLogo;
    if (existsSync(logoPath)) return new Response(Bun.file(logoPath), { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" } });
    return new Response("Not found", { status: 404 });
  }


  if (pathname === "/api/projects" && req.method === "GET") {
    const projects = await listProjects();
    return jsonResponse(projects);
  }

  if (pathname === "/api/commits" && req.method === "GET") {
    const project = url.searchParams.get("project") ?? "";
    if (!project) return jsonResponse({ ok: false, error: "Missing project" }, 400);
    const nRaw = url.searchParams.get("n");
    const n = nRaw ? Math.min(Math.max(parseInt(nRaw, 10) || 20, 1), 200) : 20;
    const dir = await resolveProjectDir(project);
    if (!dir) return jsonResponse({ ok: false, error: "Project not found" }, 404);
    const commits = await gitLog(dir, n);
    return jsonResponse(commits);
  }

  if (pathname === "/api/diff" && req.method === "GET") {
    const project = url.searchParams.get("project") ?? "";
    if (!project) return textResponse("Missing project", 400);
    const dir = await resolveProjectDir(project);
    if (!dir) return textResponse("Project not found", 404);
    const diff = await gitDiff(dir);
    const lines = diff.split("\n");
    return textResponse(lines.slice(0, 500).join("\n"));
  }

  if (pathname === "/api/doctor" && req.method === "GET") {
    const items = await getDoctorItems();
    return jsonResponse(items);
  }

  if (pathname === "/api/action" && req.method === "POST") {
    let payload: ActionRequest;
    try {
      payload = await req.json() as ActionRequest;
    } catch {
      return jsonResponse({ ok: false, error: "Invalid JSON" }, 400);
    }

    if (!payload || typeof payload.project !== "string" || typeof payload.action !== "string") {
      return jsonResponse({ ok: false, error: "Invalid payload" }, 400);
    }

    if (!(["push", "sync", "undo"] as const).includes(payload.action)) {
      return jsonResponse({ ok: false, error: "Invalid action" }, 400);
    }

    const dir = await resolveProjectDir(payload.project);
    if (!dir) return jsonResponse({ ok: false, error: "Project not found" }, 404);
    const result = await Bun.$`gp ${payload.action} --yes --quiet`.cwd(dir).nothrow();
    const output = `${result.stdout.toString()}${result.stderr.toString()}`.trim();
    return jsonResponse({ ok: result.exitCode === 0, output });
  }

  // Serve screenshot images
  if (pathname.startsWith("/screenshots/") && req.method === "GET") {
    const filename = pathname.slice("/screenshots/".length);
    if (filename.includes("..") || filename.includes("/")) {
      return new Response("Forbidden", { status: 403 });
    }
    const imgPath = join(HOME, ".gitpal", "screenshots", filename);
    if (!existsSync(imgPath)) return new Response("Not found", { status: 404 });
    const file = Bun.file(imgPath);
    return new Response(file, { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=300" } });
  }

  // PDF download: GET /api/digest/pdf?date=YYYY-MM-DD&edition=morning|noon|evening|midnight
  if (pathname === "/api/digest/pdf" && req.method === "GET") {
    const date = url.searchParams.get("date");
    const edition = url.searchParams.get("edition") ?? "morning";
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return new Response("Missing or invalid date", { status: 400 });
    }
    const pdfPath = join(HOME, ".gitpal", "log", "gazette", date, `${edition}.pdf`);
    if (!existsSync(pdfPath)) return new Response("PDF not found", { status: 404 });
    const file = Bun.file(pdfPath);
    const filename = `GitPal-Gazette-${date}-${edition}.pdf`;
    return new Response(file, { headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-cache, no-store, must-revalidate",
    }});
  }

  // Archive index: GET /api/digest/archive
  if (pathname === "/api/digest/archive" && req.method === "GET") {
    const archiveDir = join(HOME, ".gitpal", "log", "gazette");
    if (!existsSync(archiveDir)) return jsonResponse([]);
    const EDITIONS = ["morning", "noon", "evening", "midnight"] as const;
    const days: Array<{ date: string; editions: string[]; pdfs: string[] }> = [];
    let entries: string[] = [];
    try { entries = readdirSync(archiveDir); } catch { return jsonResponse([]); }
    const dateDirs = entries
      .filter(e => /^\d{4}-\d{2}-\d{2}$/.test(e))
      .filter(e => { try { return statSync(join(archiveDir, e)).isDirectory(); } catch { return false; } })
      .sort((a, b) => b.localeCompare(a)); // newest first
    for (const date of dateDirs) {
      const dayDir = join(archiveDir, date);
      const editions = EDITIONS.filter(ed => existsSync(join(dayDir, `${ed}.json`)));
      const pdfs = EDITIONS.filter(ed => existsSync(join(dayDir, `${ed}.pdf`)));
      if (editions.length > 0) days.push({ date, editions, pdfs });
    }
    return jsonResponse(days);
  }

  if (pathname === "/api/digest" && req.method === "GET") {
    const edition = url.searchParams.get("edition"); // morning | noon | evening | null (latest)
    const date = url.searchParams.get("date");       // YYYY-MM-DD | null (today/current)
    const logDir = join(HOME, ".gitpal", "log");
    const archiveDir = join(logDir, "gazette");

    // If a specific date is requested, read from archive
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      const editionKey = edition === "morning" ? "morning" : edition === "noon" ? "noon" : edition === "evening" ? "evening" : edition === "midnight" ? "midnight" : null;
      const dayDir = join(archiveDir, date);
      // Try requested edition, then fall back through the day's editions
      const candidates = editionKey
        ? [`${editionKey}.json`, "evening.json", "noon.json", "morning.json"]
        : ["evening.json", "noon.json", "morning.json"];
      for (const f of candidates) {
        const p = join(dayDir, f);
        if (existsSync(p)) {
          try { return jsonResponse(JSON.parse(readFileSync(p, "utf8"))); } catch { break; }
        }
      }
      return jsonResponse({ content: null, generated: null });
    }

    // No date — serve current edition files
    const editionFile = edition === "morning" ? "gazette-morning.json"
      : edition === "noon" ? "gazette-noon.json"
      : edition === "evening" ? "gazette-evening.json"
      : edition === "midnight" ? "gazette-midnight.json"
      : "gazette.json";
    const gazettePath = join(logDir, editionFile);
    const resolvedPath = existsSync(gazettePath) ? gazettePath : join(logDir, "gazette.json");
    if (existsSync(resolvedPath)) {
      try {
        const raw = readFileSync(resolvedPath, "utf8");
        const data = JSON.parse(raw);
        return jsonResponse(data);
      } catch { /* fall through to legacy */ }
    }
    // Legacy markdown fallback
    const digestPath = join(logDir, "digest.md");
    if (!existsSync(digestPath)) {
      return jsonResponse({ content: null, generated: null });
    }
    const content = readFileSync(digestPath, "utf8");
    const lines = content.split("\n");
    const generated = lines[1]?.replace(/^\*Generated at (.+)\*$/, "$1").trim() ?? null;
    return jsonResponse({ content, generated });
  }

  return new Response("Not found", { status: 404 });
}

async function main(): Promise<void> {
  await loadConfig();
  await Bun.write(SERVER_PID, String(process.pid));

  Bun.serve({
    port: PORT,
    fetch: handleRequest,
  });

  process.on("SIGTERM", () => {
    try { Bun.spawnSync(["rm", "-f", SERVER_PID]); } catch {}
    process.exit(0);
  });

  process.on("SIGINT", () => {
    try { Bun.spawnSync(["rm", "-f", SERVER_PID]); } catch {}
    process.exit(0);
  });

  console.log(`GitPal server running on http://localhost:${PORT}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

import { existsSync, readdirSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { join, extname, basename } from "node:path";
import { aiComplete } from "./ai.ts";

const MAX_FILE_CHARS = 4000;
const MAX_FILES_SAMPLED = 20;
const MAX_PRIORITY_DEPTH = 5; // how deep to search for priority files in monorepos

// File extensions worth reading for context
const READABLE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs",
  ".py", ".go", ".rs", ".rb", ".php",
  ".css", ".scss", ".html",
  ".json", ".toml", ".yaml", ".yml", ".env.example",
  ".sh", ".md",
]);

// Always read these by name if they exist
const PRIORITY_FILES = [
  "package.json", "pyproject.toml", "Cargo.toml", "go.mod",
  "bun.lockb", "requirements.txt", "Makefile", "Dockerfile",
  "docker-compose.yml", "docker-compose.yaml", ".env.example",
];

interface ProjectContext {
  name: string;
  structure: string;
  priorityFiles: Record<string, string>;
  sampledFiles: Array<{ path: string; content: string }>;
  stack: string[];
}

function detectStack(dir: string): string[] {
  const stack: string[] = [];
  if (existsSync(join(dir, "package.json"))) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as Record<string, unknown>;
      const deps = { ...pkg["dependencies"] as Record<string, string> ?? {}, ...pkg["devDependencies"] as Record<string, string> ?? {} };
      if (deps["next"]) stack.push("Next.js");
      else if (deps["react"]) stack.push("React");
      if (deps["express"]) stack.push("Express");
      if (deps["bun"]) stack.push("Bun");
      if (deps["prisma"] || deps["@prisma/client"]) stack.push("Prisma");
      if (deps["tailwindcss"]) stack.push("Tailwind CSS");
      if (deps["typescript"] || deps["@types/node"]) stack.push("TypeScript");
      else stack.push("JavaScript");
      if (deps["stripe"]) stack.push("Stripe");
      if (deps["socket.io"]) stack.push("WebSockets");
      if (deps["zustand"]) stack.push("Zustand");
      if (deps["drizzle-orm"]) stack.push("Drizzle");
    } catch { /* ok */ }
  }
  if (existsSync(join(dir, "requirements.txt")) || existsSync(join(dir, "pyproject.toml"))) stack.push("Python");
  if (existsSync(join(dir, "Cargo.toml"))) stack.push("Rust");
  if (existsSync(join(dir, "go.mod"))) stack.push("Go");
  if (existsSync(join(dir, "Dockerfile")) || existsSync(join(dir, "docker-compose.yml"))) stack.push("Docker");
  return stack;
}

function buildDirectoryTree(dir: string, depth = 0, maxDepth = 3): string {
  if (depth > maxDepth) return "";
  const lines: string[] = [];
  let entries: string[] = [];
  try {
    entries = readdirSync(dir).filter((e) =>
      !["node_modules", ".git", "dist", "build", ".cache", ".next", "__pycache__", "target"].includes(e) &&
      !e.startsWith(".")
    ).sort();
  } catch { return ""; }

  for (const entry of entries.slice(0, 20)) {
    const full = join(dir, entry);
    try {
      const stat = statSync(full);
      const indent = "  ".repeat(depth);
      if (stat.isDirectory()) {
        lines.push(`${indent}${entry}/`);
        lines.push(buildDirectoryTree(full, depth + 1, maxDepth));
      } else {
        lines.push(`${indent}${entry}`);
      }
    } catch { /* skip */ }
  }
  return lines.filter(Boolean).join("\n");
}

function sampleSourceFiles(dir: string): Array<{ path: string; content: string }> {
  const results: Array<{ path: string; content: string }> = [];
  const seen = new Set<string>();

  function walk(current: string, depth: number): void {
    if (depth > 4 || results.length >= MAX_FILES_SAMPLED) return;
    let entries: string[] = [];
    try {
      entries = readdirSync(current).filter((e) =>
        !["node_modules", ".git", "dist", "build", ".cache", ".next", "__pycache__", "target"].includes(e) &&
        !e.startsWith(".")
      );
    } catch { return; }

    for (const entry of entries) {
      if (results.length >= MAX_FILES_SAMPLED) break;
      const full = join(current, entry);
      try {
        const stat = statSync(full);
        if (stat.isDirectory()) {
          walk(full, depth + 1);
        } else if (READABLE_EXTENSIONS.has(extname(entry)) && !seen.has(full)) {
          seen.add(full);
          const raw = readFileSync(full, "utf8");
          const content = raw.length > MAX_FILE_CHARS ? raw.substring(0, MAX_FILE_CHARS) + "\n...[truncated]" : raw;
          const relPath = full.replace(dir + "/", "");
          results.push({ path: relPath, content });
        }
      } catch { /* skip */ }
    }
  }

  walk(dir, 0);
  return results;
}

/** Recursively find priority files anywhere in the project tree */
function findPriorityFiles(dir: string, depth = 0): Record<string, string> {
  const results: Record<string, string> = {};
  if (depth > MAX_PRIORITY_DEPTH) return results;
  let entries: string[] = [];
  try { entries = readdirSync(dir); } catch { return results; }

  for (const entry of entries) {
    if (["node_modules", ".git", "dist", "build", ".cache", ".next", "__pycache__", "target"].includes(entry)) continue;
    const full = join(dir, entry);
    try {
      const stat = statSync(full);
      if (stat.isDirectory()) {
        Object.assign(results, findPriorityFiles(full, depth + 1));
      } else if (PRIORITY_FILES.includes(entry) && !(entry in results)) {
        const raw = readFileSync(full, "utf8");
        const relPath = full.replace(dir.replace(/\/$/, "") + "/", "");
        const key = relPath;
        results[key] = raw.length > MAX_FILE_CHARS ? raw.substring(0, MAX_FILE_CHARS) + "\n...[truncated]" : raw;
      }
    } catch { /* skip */ }
  }
  return results;
}

function gatherContext(dir: string): ProjectContext {
  const name = basename(dir);
  const stack = detectStack(dir);
  const structure = buildDirectoryTree(dir);

  // Find priority files recursively (handles monorepos)
  const priorityFiles = findPriorityFiles(dir);

  const sampledFiles = sampleSourceFiles(dir);

  return { name, structure, priorityFiles, sampledFiles, stack };
}

function buildPrompt(ctx: ProjectContext): string {
  const sections: string[] = [];

  sections.push(`Project name: ${ctx.name}`);
  if (ctx.stack.length > 0) sections.push(`Detected stack: ${ctx.stack.join(", ")}`);

  sections.push(`\nDirectory structure:\n${ctx.structure}`);

  for (const [filename, content] of Object.entries(ctx.priorityFiles)) {
    sections.push(`\n--- ${filename} ---\n${content}`);
  }

  for (const file of ctx.sampledFiles) {
    sections.push(`\n--- ${file.path} ---\n${file.content}`);
  }

  const prompt = [
    "You are an expert technical writer. Write a thorough, information-rich README.md for this software project.",
    "Base everything strictly on the project files provided — do not invent or guess.",
    "",
    "REQUIRED SECTIONS (include all that apply):",
    "1. Title + one-line tagline describing what it does and for whom",
    "2. Description: 2-3 sentences — exactly what it does, the domain it serves, what problem it solves",
    "3. Features: concrete bullet list of real features visible in the code (routes, modules, UI pages, integrations)",
    "4. Tech Stack: table with Technology | Role columns",
    "5. Architecture: how the services/packages fit together (especially for monorepos or multi-service projects)",
    "6. Prerequisites: exact tools and versions needed",
    "7. Installation & Setup: step-by-step, with real commands from package.json/Makefile/scripts",
    "8. Running (dev and prod separately if both exist)",
    "9. Docker: exact compose commands if docker-compose.yml exists",
    "10. API Overview: list the main route groups or modules if a backend exists",
    "11. Environment Variables: table with Variable | Description | Required columns, using vars from the code",
    "",
    "RULES:",
    "- Use real details from the code. Name actual modules, routes, pages, services.",
    "- Never write filler like 'This project leverages modern technologies'",
    "- Never invent features not visible in the code",
    "- Output ONLY raw markdown. No preamble, no explanation, no surrounding code fences.",
    "",
    "PROJECT FILES:",
    sections.join("\n"),
  ].join("\n");
  return prompt;
}

export async function generateReadme(dir: string): Promise<string | null> {
  const ctx = gatherContext(dir);
  const prompt = buildPrompt(ctx);

  try {
    const result = await aiComplete(prompt, 3000);
    if (!result || result.length < 100) return buildFallbackReadme(ctx);
    return result.trim();
  } catch {
    return buildFallbackReadme(ctx);
  }
}

/** Minimal fallback if Ollama is unavailable */
function buildFallbackReadme(ctx: ProjectContext): string {
  const stack = ctx.stack.length > 0 ? ctx.stack.join(", ") : "Unknown";
  const hasPkg = "package.json" in ctx.priorityFiles;
  const hasDocker = "Dockerfile" in ctx.priorityFiles || "docker-compose.yml" in ctx.priorityFiles;

  return `# ${ctx.name}

> _README generated by GitPal — update this with a real description._

## Stack

${ctx.stack.map((s) => `- ${s}`).join("\n") || "- See source files"}

## Getting Started

${hasPkg ? "```bash\nnpm install\nnpm run dev\n```" : ""}
${hasDocker ? "```bash\ndocker compose up -d\n```" : ""}

## Project Structure

\`\`\`
${ctx.structure}
\`\`\`
`;
}

export async function writeReadme(dir: string): Promise<"written" | "failed"> {
  const content = await generateReadme(dir);
  if (!content) return "failed";
  try {
    writeFileSync(join(dir, "README.md"), content + "\n");
    return "written";
  } catch {
    return "failed";
  }
}

// ── Repo metadata (description, topics, homepage) ────────────────────────────

export interface RepoMeta {
  description: string;
  topics: string[];
  homepage: string;
}

const COMMON_TOPICS: Record<string, string[]> = {
  "next": ["nextjs", "react"],
  "react": ["react"],
  "express": ["express", "nodejs"],
  "nestjs": ["nestjs", "nodejs"],
  "@nestjs/core": ["nestjs", "nodejs"],
  "prisma": ["prisma"],
  "tailwindcss": ["tailwindcss"],
  "typescript": ["typescript"],
  "stripe": ["stripe", "payments"],
  "socket.io": ["websockets", "realtime"],
  "docker": ["docker"],
  "postgresql": ["postgresql"],
  "mongodb": ["mongodb"],
  "redis": ["redis"],
  "leaflet": ["leaflet", "maps"],
  "bullmq": ["queue", "workers"],
  "playwright": ["playwright", "testing"],
};

function detectTopicsFromPackage(dir: string): string[] {
  const topics = new Set<string>();
  // Search for package.json files in project (handles monorepos)
  function walk(current: string, depth: number): void {
    if (depth > 3) return;
    let entries: string[] = [];
    try { entries = readdirSync(current); } catch { return; }
    for (const entry of entries) {
      if (["node_modules", ".git", "dist", "build"].includes(entry)) continue;
      const full = join(current, entry);
      try {
        const stat = statSync(full);
        if (stat.isDirectory()) { walk(full, depth + 1); continue; }
        if (entry !== "package.json") continue;
        const pkg = JSON.parse(readFileSync(full, "utf8")) as Record<string, unknown>;
        const deps = { ...pkg["dependencies"] as Record<string, string> ?? {}, ...pkg["devDependencies"] as Record<string, string> ?? {} };
        for (const [dep, topicList] of Object.entries(COMMON_TOPICS)) {
          if (dep in deps) topicList.forEach((t) => topics.add(t));
        }
      } catch { /* skip */ }
    }
  }
  walk(dir, 0);
  if (existsSync(join(dir, "Dockerfile")) || existsSync(join(dir, "docker-compose.yml"))) topics.add("docker");
  if (existsSync(join(dir, "requirements.txt")) || existsSync(join(dir, "pyproject.toml"))) topics.add("python");
  if (existsSync(join(dir, "Cargo.toml"))) topics.add("rust");
  if (existsSync(join(dir, "go.mod"))) topics.add("golang");
  return Array.from(topics).slice(0, 20); // GitHub max is 20 topics
}

function detectHomepage(dir: string): string {
  // Check docker-compose for public domain env var or Caddyfile
  try {
    const composePath = join(dir, "docker-compose.yml");
    if (existsSync(composePath)) {
      const content = readFileSync(composePath, "utf8");
      const match = content.match(/PUBLIC_DOMAIN[=:-]\s*([\w.-]+\.[a-z]{2,})/i);
      if (match?.[1] && !match[1].includes("localhost") && !match[1].includes("example")) {
        return `https://${match[1]}`;
      }
    }
  } catch { /* ok */ }
  // Check nested docker-compose files for monorepos
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const sub = join(dir, entry);
      try {
        if (!statSync(sub).isDirectory()) continue;
        const composePath = join(sub, "docker-compose.yml");
        if (!existsSync(composePath)) continue;
        const content = readFileSync(composePath, "utf8");
        const match = content.match(/PUBLIC_DOMAIN[=:-]\s*([\w.-]+\.[a-z]{2,})/i);
        if (match?.[1] && !match[1].includes("localhost") && !match[1].includes("example")) {
          return `https://${match[1]}`;
        }
      } catch { /* ok */ }
    }
  } catch { /* ok */ }
  return "";
}

export async function generateRepoMeta(dir: string): Promise<RepoMeta> {
  const ctx = gatherContext(dir);
  const detectedTopics = detectTopicsFromPackage(dir);
  const homepage = detectHomepage(dir);

  // Build a concise prompt just for the description
  const fileNames = Object.keys(ctx.priorityFiles).slice(0, 5).join(", ");
  const sampledPaths = ctx.sampledFiles.slice(0, 3).map((f) => f.path).join(", ");
  const stackStr = ctx.stack.join(", ") || "unknown stack";
  const treeTop = ctx.structure.split("\n").slice(0, 8).join("\n");

  const prompt = [
    "You are writing metadata for a GitHub repository.",
    "Based on the project context below, output a JSON object with exactly these fields:",
    '  { "description": string, "topics": string[] }',
    "",
    "Rules:",
    "- description: ONE sentence (max 120 chars). What the project does, specifically. No generic filler like 'built with X'.",
    "- description must explain the PURPOSE of the project, not just its tech stack.",
    "- topics: 3-8 lowercase hyphenated tags relevant to the tech and domain (e.g. nextjs, docker, maps, news-aggregator)",
    "- Output ONLY the raw JSON object. No markdown, no explanation.",
    "",
    `Project name: ${ctx.name}`,
    `Stack: ${stackStr}`,
    `Key files: ${fileNames}`,
    `Source files: ${sampledPaths}`,
    `Structure:\n${treeTop}`,
  ].join("\n");

  try {
    const result = await aiComplete(prompt, 200);
    if (!result) throw new Error("AI returned null");

    // Extract JSON from response (model may wrap in markdown fences)
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in response");
    const parsed = JSON.parse(jsonMatch[0]) as { description?: string; topics?: string[] };

    const description = (parsed.description ?? "").substring(0, 350);
    if (!description || description.length < 10) throw new Error("Description too short");

    const aiTopics = (parsed.topics ?? []).map((t) => t.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").slice(0, 35));
    const allTopics = Array.from(new Set([...aiTopics, ...detectedTopics])).slice(0, 20);

    return { description, topics: allTopics, homepage };
  } catch {
    // Fallback: return empty description so we don't overwrite a good one with junk
    return { description: "", topics: detectedTopics, homepage };
  }
}

export async function applyRepoMeta(repoFullName: string, meta: RepoMeta): Promise<void> {
  // Don't overwrite an existing custom description with an AI-generated one
  const existing = await Bun.$`gh repo view ${repoFullName} --json description -q .description`.quiet().nothrow();
  const currentDesc = existing.stdout.toString().trim();
  const isGeneric = !currentDesc || /^\w+ — built with/.test(currentDesc);

  const args = ["repo", "edit", repoFullName];
  if (meta.description && isGeneric) args.push("--description", meta.description);
  if (meta.homepage) args.push("--homepage", meta.homepage);
  if (meta.topics.length > 0) args.push("--add-topic", meta.topics.join(","));
  await Bun.$`gh ${args}`.quiet().nothrow();
}

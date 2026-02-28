import { join } from "node:path";
import { homedir } from "node:os";

export interface GitPalConfig {
  watch_patterns: string[];
  exclude_patterns: string[];
  idle_seconds: number;
  ollama_model: string;
  ollama_url: string;
  github_username: string;
  auto_push: boolean;
}

const CONFIG_DIR = join(homedir(), ".gitpal");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");
const PROMPTED_PATH = join(CONFIG_DIR, "prompted.json");

const DEFAULTS: GitPalConfig = {
  watch_patterns: [],
  exclude_patterns: ["node_modules", ".git", "dist", "build", ".cache"],
  idle_seconds: 120,
  ollama_model: "llama3.2",
  ollama_url: "http://localhost:11434",
  github_username: "bb82dabn",
  auto_push: false,
};

export async function ensureConfigDir(): Promise<void> {
  await Bun.$`mkdir -p ${CONFIG_DIR} ${join(CONFIG_DIR, "sessions")} ${join(CONFIG_DIR, "log")}`.quiet();
}

export async function loadConfig(): Promise<GitPalConfig> {
  await ensureConfigDir();
  const file = Bun.file(CONFIG_PATH);
  if (!(await file.exists())) {
    await Bun.write(CONFIG_PATH, JSON.stringify(DEFAULTS, null, 2));
    return { ...DEFAULTS };
  }
  const raw = await file.json() as Partial<GitPalConfig>;
  return { ...DEFAULTS, ...raw };
}

export async function saveConfig(patch: Partial<GitPalConfig>): Promise<void> {
  await ensureConfigDir();
  const current = await loadConfig();
  const updated = { ...current, ...patch };
  await Bun.write(CONFIG_PATH, JSON.stringify(updated, null, 2));
}

export async function isWatched(dir: string): Promise<boolean> {
  const config = await loadConfig();
  if (config.watch_patterns.length === 0) return false;
  const home = homedir();
  const normalized = dir.replace(home, "~");
  for (const pattern of config.watch_patterns) {
    // Simple glob: ~/foo/* matches ~/foo/bar
    const base = pattern.replace(/\/\*$/, "");
    const expandedBase = base.replace("~", home);
    const expandedPattern = pattern.replace("~", home);
    // Exact match or wildcard child match
    if (dir === expandedBase || dir === expandedPattern) return true;
    if (pattern.endsWith("/*") && dir.startsWith(expandedBase + "/")) return true;
    if (normalized === base || normalized === pattern) return true;
    if (pattern.endsWith("/*") && normalized.startsWith(base + "/")) return true;
  }
  return false;
}

/** Track which directories we've already prompted about git init (avoid repeated prompts) */
export async function hasBeenPrompted(dir: string): Promise<boolean> {
  const file = Bun.file(PROMPTED_PATH);
  if (!(await file.exists())) return false;
  const list = await file.json() as string[];
  return list.includes(dir);
}

export async function markPrompted(dir: string): Promise<void> {
  const file = Bun.file(PROMPTED_PATH);
  const list: string[] = (await file.exists()) ? (await file.json() as string[]) : [];
  if (!list.includes(dir)) {
    list.push(dir);
    await Bun.write(PROMPTED_PATH, JSON.stringify(list, null, 2));
  }
}

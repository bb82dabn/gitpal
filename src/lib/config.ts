import { join } from "node:path";
import { hostname, homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";

export interface GitPalConfig {
  watch_patterns: string[];
  exclude_patterns: string[];
  idle_seconds: number;
  openai_api_key: string;
  openai_model: string;
  github_username: string;
  auto_push: boolean;
  /** Unique identifier for this machine (generated on first run) */
  machine_id: string;
  /** Human-friendly machine name (defaults to hostname) */
  machine_name: string;
  /** How often (seconds) to fetch+pull from remote in the watcher sync loop */
  sync_interval_seconds: number;
}

const CONFIG_DIR = join(homedir(), ".gitpal");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");
const PROMPTED_PATH = join(CONFIG_DIR, "prompted.json");

const DEFAULTS: Omit<GitPalConfig, "machine_id" | "machine_name"> & { machine_id: string; machine_name: string } = {
  watch_patterns: ["~/projects/*"],
  exclude_patterns: ["node_modules", ".git", "dist", "build", ".cache"],
  idle_seconds: 120,
  openai_api_key: "",
  openai_model: "gpt-4.1-mini",
  github_username: "bb82dabn",
  auto_push: false,
  machine_id: "",
  machine_name: "",
  sync_interval_seconds: 120,
};

export async function ensureConfigDir(): Promise<void> {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  mkdirSync(join(CONFIG_DIR, "sessions"), { recursive: true, mode: 0o700 });
  mkdirSync(join(CONFIG_DIR, "log"), { recursive: true, mode: 0o700 });
  chmodSync(CONFIG_DIR, 0o700);
  chmodSync(join(CONFIG_DIR, "sessions"), 0o700);
  chmodSync(join(CONFIG_DIR, "log"), 0o700);
}

async function writePrivateJson(path: string, data: unknown): Promise<void> {
  await Bun.write(path, JSON.stringify(data, null, 2));
  chmodSync(path, 0o600);
}

export async function loadConfig(): Promise<GitPalConfig> {
  await ensureConfigDir();
  const file = Bun.file(CONFIG_PATH);
  let raw: Partial<GitPalConfig> = {};
  if (await file.exists()) {
    chmodSync(CONFIG_PATH, 0o600);
    raw = await file.json() as Partial<GitPalConfig>;
  }
  const config = { ...DEFAULTS, ...raw };

  // Auto-generate machine identity on first load
  let dirty = false;
  if (!config.machine_id) {
    config.machine_id = randomUUID().slice(0, 8);
    dirty = true;
  }
  if (!config.machine_name) {
    config.machine_name = hostname();
    dirty = true;
  }
  if (dirty) {
    await writePrivateJson(CONFIG_PATH, config);
  }

  return config;
}

export async function saveConfig(patch: Partial<GitPalConfig>): Promise<void> {
  await ensureConfigDir();
  const current = await loadConfig();
  const updated = { ...current, ...patch };
  await writePrivateJson(CONFIG_PATH, updated);
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
    await writePrivateJson(PROMPTED_PATH, list);
  }
}

/** Returns the machine tag string for commit trailers, e.g. 'brians-laptop-a1b2c3d4' */
export async function getMachineTag(): Promise<string> {
  const config = await loadConfig();
  return `${config.machine_name}-${config.machine_id}`;
}

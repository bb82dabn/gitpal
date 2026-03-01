/**
 * Sync manifest — tracks which GitHub repos are synced to this machine.
 * Stored locally at ~/.gitpal/sync-manifest.json (per-machine, not synced).
 *
 * Used by the dashboard repo picker and `gp clone`.
 */

import { join } from "node:path";
import { homedir } from "node:os";
import { loadConfig, ensureConfigDir } from "./config.ts";

const MANIFEST_PATH = join(homedir(), ".gitpal", "sync-manifest.json");

export interface SyncedRepo {
  /** GitHub full name, e.g. "bb82dabn/myapp" */
  name: string;
  /** Clone URL */
  url: string;
  /** Local path on this machine */
  local_path: string;
  /** When this repo was added to sync */
  added_at: string;
}

export interface SyncManifest {
  machine_id: string;
  machine_name: string;
  synced_repos: SyncedRepo[];
}

export async function loadManifest(): Promise<SyncManifest> {
  await ensureConfigDir();
  const config = await loadConfig();
  const file = Bun.file(MANIFEST_PATH);

  if (await file.exists()) {
    const raw = await file.json() as Partial<SyncManifest>;
    return {
      machine_id: raw.machine_id ?? config.machine_id,
      machine_name: raw.machine_name ?? config.machine_name,
      synced_repos: raw.synced_repos ?? [],
    };
  }

  return {
    machine_id: config.machine_id,
    machine_name: config.machine_name,
    synced_repos: [],
  };
}

export async function saveManifest(manifest: SyncManifest): Promise<void> {
  await ensureConfigDir();
  await Bun.write(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
}

export async function addToManifest(repo: Omit<SyncedRepo, "added_at">): Promise<void> {
  const manifest = await loadManifest();
  // Dedupe by name
  manifest.synced_repos = manifest.synced_repos.filter(r => r.name !== repo.name);
  manifest.synced_repos.push({
    ...repo,
    added_at: new Date().toISOString(),
  });
  await saveManifest(manifest);
}

export async function removeFromManifest(repoName: string): Promise<void> {
  const manifest = await loadManifest();
  manifest.synced_repos = manifest.synced_repos.filter(r => r.name !== repoName);
  await saveManifest(manifest);
}

export async function isInManifest(repoName: string): Promise<boolean> {
  const manifest = await loadManifest();
  return manifest.synced_repos.some(r => r.name === repoName);
}

/** List GitHub repos for the authenticated user via `gh` CLI. */
export async function listGitHubRepos(): Promise<Array<{
  name: string;
  fullName: string;
  url: string;
  isPrivate: boolean;
  pushedAt: string;
  defaultBranch: string;
}>> {
  const result = await Bun.$`gh repo list --limit 200 --json name,nameWithOwner,url,isPrivate,pushedAt,defaultBranchRef`.quiet().nothrow();

  if (result.exitCode !== 0) return [];

  const raw = JSON.parse(result.stdout.toString()) as Array<{
    name: string;
    nameWithOwner: string;
    url: string;
    isPrivate: boolean;
    pushedAt: string;
    defaultBranchRef: { name: string } | null;
  }>;

  return raw.map(r => ({
    name: r.name,
    fullName: r.nameWithOwner,
    url: r.url,
    isPrivate: r.isPrivate,
    pushedAt: r.pushedAt,
    defaultBranch: r.defaultBranchRef?.name ?? "main",
  }));
}

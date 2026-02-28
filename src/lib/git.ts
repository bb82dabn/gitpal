import { join } from "node:path";

export interface CommitInfo {
  hash: string;
  shortHash: string;
  message: string;
  date: string;
  relativeDate: string;
  author: string;
  filesChanged: number;
}

export interface GitStatus {
  staged: number;
  unstaged: number;
  untracked: number;
  hasChanges: boolean;
  clean: boolean;
}

export async function isGitRepo(dir: string): Promise<boolean> {
  const result = await Bun.$`git -C ${dir} rev-parse --git-dir`.quiet().nothrow();
  return result.exitCode === 0;
}

export async function hasRemote(dir: string): Promise<boolean> {
  const result = await Bun.$`git -C ${dir} remote get-url origin`.quiet().nothrow();
  return result.exitCode === 0;
}

export async function hasCommits(dir: string): Promise<boolean> {
  const result = await Bun.$`git -C ${dir} rev-parse HEAD`.quiet().nothrow();
  return result.exitCode === 0;
}

export async function gitInit(dir: string): Promise<void> {
  await Bun.$`git -C ${dir} init`.quiet();
}

export async function gitStatus(dir: string): Promise<GitStatus> {
  const result = await Bun.$`git -C ${dir} status --porcelain`.quiet().nothrow();
  if (result.exitCode !== 0) return { staged: 0, unstaged: 0, untracked: 0, hasChanges: false, clean: true };

  const lines = result.stdout.toString().trim().split("\n").filter(Boolean);
  let staged = 0, unstaged = 0, untracked = 0;

  for (const line of lines) {
    const x = line[0] ?? " ";
    const y = line[1] ?? " ";
    if (x === "?") { untracked++; continue; }
    if (x !== " ") staged++;
    if (y !== " ") unstaged++;
  }

  const hasChanges = staged + unstaged + untracked > 0;
  return { staged, unstaged, untracked, hasChanges, clean: !hasChanges };
}

export async function gitDiff(dir: string): Promise<string> {
  // Diff of tracked changes (staged + unstaged). If nothing tracked, show untracked file names.
  const staged = await Bun.$`git -C ${dir} diff --cached`.quiet().nothrow();
  const unstaged = await Bun.$`git -C ${dir} diff`.quiet().nothrow();
  const combined = [staged.stdout.toString(), unstaged.stdout.toString()].join("\n").trim();

  if (combined.length > 0) return combined;

  // Fallback: list untracked file names
  const untracked = await Bun.$`git -C ${dir} ls-files --others --exclude-standard`.quiet().nothrow();
  const files = untracked.stdout.toString().trim();
  return files ? `New files added:\n${files}` : "";
}

export async function gitAdd(dir: string): Promise<void> {
  await Bun.$`git -C ${dir} add -A`.quiet();
}

export async function gitCommit(dir: string, message: string): Promise<void> {
  await Bun.$`git -C ${dir} commit -m ${message}`.quiet();
}

export async function gitPush(dir: string): Promise<void> {
  // Detect current branch name
  const branchResult = await Bun.$`git -C ${dir} branch --show-current`.quiet().nothrow();
  const branch = branchResult.stdout.toString().trim() || "main";
  await Bun.$`git -C ${dir} push -u origin ${branch}`;
}

export async function gitLog(dir: string, n = 10): Promise<CommitInfo[]> {
  const fmt = "%H|||%h|||%s|||%ci|||%cr|||%an";
  const result = await Bun.$`git -C ${dir} log -${n} --format=${fmt}`.quiet().nothrow();
  if (result.exitCode !== 0) return [];

  const lines = result.stdout.toString().trim().split("\n").filter(Boolean);
  const commits: CommitInfo[] = [];

  for (const line of lines) {
    const parts = line.split("|||");
    const hash = parts[0] ?? "";
    const shortHash = parts[1] ?? "";
    const message = parts[2] ?? "";
    const date = parts[3] ?? "";
    const relativeDate = parts[4] ?? "";
    const author = parts[5] ?? "";

    // Get files changed count for this commit
    const statResult = await Bun.$`git -C ${dir} diff-tree --no-commit-id -r --name-only ${hash}`.quiet().nothrow();
    const filesChanged = statResult.stdout.toString().trim().split("\n").filter(Boolean).length;

    commits.push({ hash, shortHash, message, date, relativeDate, author, filesChanged });
  }

  return commits;
}

export async function gitSnapshotCommit(dir: string): Promise<string> {
  const timestamp = new Date().toISOString().replace("T", " ").substring(0, 19);
  const message = `GitPal safety snapshot — ${timestamp}`;
  const status = await gitStatus(dir);

  if (status.hasChanges) {
    await gitAdd(dir);
    await gitCommit(dir, message);
  } else {
    // Create snapshot of current HEAD state by making an empty marker commit
    await Bun.$`git -C ${dir} commit --allow-empty -m ${message}`.quiet();
  }

  const hashResult = await Bun.$`git -C ${dir} rev-parse --short HEAD`.quiet();
  return hashResult.stdout.toString().trim();
}

export async function gitResetToHash(dir: string, hash: string, mode: "soft" | "mixed" | "hard"): Promise<void> {
  await Bun.$`git -C ${dir} reset --${mode} ${hash}`;
}

export async function gitSetRemote(dir: string, url: string): Promise<void> {
  const existing = await Bun.$`git -C ${dir} remote`.quiet().nothrow();
  if (existing.stdout.toString().includes("origin")) {
    await Bun.$`git -C ${dir} remote set-url origin ${url}`.quiet();
  } else {
    await Bun.$`git -C ${dir} remote add origin ${url}`.quiet();
  }
}

/** Returns the number of files in a directory (for "does this look like a project?") */
export async function countFiles(dir: string): Promise<number> {
  const result = await Bun.$`ls -1 ${dir}`.quiet().nothrow();
  return result.stdout.toString().trim().split("\n").filter(Boolean).length;
}

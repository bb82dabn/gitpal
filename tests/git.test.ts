import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { countFiles, getBranchStatus, gitDiff, gitStatus, hasCommits, isGitRepo } from "../src/lib/git.ts";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "gitpal-test-"));
  tempDirs.push(dir);
  return dir;
}

async function initRepo(dir: string): Promise<void> {
  await Bun.$`git -C ${dir} init`.quiet();
  await Bun.$`git -C ${dir} config user.name test-user`.quiet();
  await Bun.$`git -C ${dir} config user.email test@example.com`.quiet();
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("git helpers", () => {
  test("detects git repositories and counts directory entries", async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "notes.txt"), "hello\n");

    expect(await isGitRepo(dir)).toBe(false);
    expect(await countFiles(dir)).toBe(1);

    await initRepo(dir);

    expect(await isGitRepo(dir)).toBe(true);
  });

  test("reports staged, unstaged, and untracked changes", async () => {
    const dir = makeTempDir();
    await initRepo(dir);

    const trackedFile = join(dir, "tracked.txt");
    writeFileSync(trackedFile, "one\n");
    await Bun.$`git -C ${dir} add tracked.txt`.quiet();
    await Bun.$`git -C ${dir} commit -m initial`.quiet();

    writeFileSync(trackedFile, "two\n");
    await Bun.$`git -C ${dir} add tracked.txt`.quiet();
    writeFileSync(trackedFile, "three\n");
    writeFileSync(join(dir, "new-file.txt"), "new\n");

    expect(await gitStatus(dir)).toEqual({
      staged: 1,
      unstaged: 1,
      untracked: 1,
      hasChanges: true,
      clean: false,
    });
  });

  test("falls back to listing untracked files when no diff exists", async () => {
    const dir = makeTempDir();
    await initRepo(dir);

    writeFileSync(join(dir, "fresh.txt"), "content\n");

    expect(await gitDiff(dir)).toBe("New files added:\nfresh.txt");
  });

  test("reports commit presence and zeroed branch status without a remote", async () => {
    const dir = makeTempDir();
    await initRepo(dir);

    expect(await hasCommits(dir)).toBe(false);

    writeFileSync(join(dir, "tracked.txt"), "hello\n");
    await Bun.$`git -C ${dir} add tracked.txt`.quiet();
    await Bun.$`git -C ${dir} commit -m initial`.quiet();

    expect(await hasCommits(dir)).toBe(true);

    const status = await getBranchStatus(dir);
    expect(status.branch.length).toBeGreaterThan(0);
    expect(status.ahead).toBe(0);
    expect(status.behind).toBe(0);
    expect(status.diverged).toBe(false);
  });
});

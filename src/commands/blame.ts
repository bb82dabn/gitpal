/**
 * `gp blame <file>` — show who changed each line and when.
 * Nicely formatted alternative to raw `git blame`.
 */

import { gp, banner } from "../lib/display.ts";
import { isGitRepo } from "../lib/git.ts";
import { join, resolve } from "node:path";
import chalk from "chalk";

export async function runBlame(filePath: string | undefined, dir: string = process.cwd()): Promise<void> {
  if (!filePath) {
    gp.warn("Usage: gp blame <file>");
    return;
  }

  const absPath = resolve(dir, filePath);

  if (!(await isGitRepo(dir))) {
    gp.warn("Not a git repo.");
    return;
  }

  // Verify file exists in git
  const checkResult = await Bun.$`git -C ${dir} ls-files --error-unmatch ${absPath}`.quiet().nothrow();
  if (checkResult.exitCode !== 0) {
    gp.warn(`File not tracked by git: ${filePath}`);
    return;
  }

  banner();
  gp.header(`Blame — ${filePath}`);
  gp.blank();

  // --porcelain gives us structured output we can format nicely
  const result = await Bun.$`git -C ${dir} blame --porcelain ${absPath}`.quiet().nothrow();
  if (result.exitCode !== 0) {
    gp.warn(`Could not blame file: ${result.stderr.toString().trim()}`);
    return;
  }

  const lines = result.stdout.toString().split("\n");

  interface BlameBlock {
    hash: string;
    author: string;
    date: string;
    summary: string;
    lineNum: number;
    content: string;
  }

  const blocks: BlameBlock[] = [];
  let current: Partial<BlameBlock> = {};
  // Cache metadata by hash — git porcelain only emits it on first occurrence
  const commitMeta = new Map<string, { author: string; date: string; summary: string }>();

  for (const line of lines) {
    if (/^[0-9a-f]{40} \d+ (\d+)/.test(line)) {
      const m = line.match(/^([0-9a-f]{40}) \d+ (\d+)/);
      if (m) {
        const shortHash = m[1]!.slice(0, 8);
        const cached = commitMeta.get(shortHash);
        current = {
          hash: shortHash,
          lineNum: parseInt(m[2]!),
          // Pre-fill from cache if we've seen this commit before
          ...(cached ?? {}),
        };
      }
    } else if (line.startsWith("author "))    { current.author  = line.slice(7).trim(); }
    else if (line.startsWith("author-time ")) { current.date    = new Date(parseInt(line.slice(12)) * 1000).toISOString().slice(0, 10); }
    else if (line.startsWith("summary "))     { current.summary = line.slice(8).trim(); }
    else if (line.startsWith("\t")) {
      current.content = line.slice(1);
      if (current.hash && current.lineNum !== undefined) {
        // Cache metadata for this hash so repeated lines can reuse it
        if (current.author && !commitMeta.has(current.hash)) {
          commitMeta.set(current.hash, {
            author:  current.author ?? "unknown",
            date:    current.date ?? "",
            summary: current.summary ?? "",
          });
        }
        // Fill any missing fields from cache
        const cached = commitMeta.get(current.hash);
        if (cached) {
          current.author  ??= cached.author;
          current.date    ??= cached.date;
          current.summary ??= cached.summary;
        }
        blocks.push(current as BlameBlock);
      }
      current = {};
    }
  }

  if (blocks.length === 0) {
    gp.warn("No blame data found.");
    return;
  }

  // Track previous hash to color-alternate commit blocks
  let prevHash = "";
  let colorToggle = false;

  for (const b of blocks) {
    if (b.hash !== prevHash) {
      colorToggle = !colorToggle;
      prevHash = b.hash;
    }

    const hashPart   = chalk.dim(b.hash);
    const authorPart = chalk.cyan(b.author.slice(0, 16).padEnd(16));
    const datePart   = chalk.dim(b.date);
    const linePart   = chalk.dim(String(b.lineNum).padStart(4));
    const contentPart = colorToggle
      ? chalk.white(b.content)
      : chalk.gray(b.content);

    console.log(`  ${hashPart}  ${authorPart}  ${datePart}  ${linePart}  ${contentPart}`);
  }

  gp.blank();
}

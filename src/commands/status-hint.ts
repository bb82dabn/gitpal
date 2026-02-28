/**
 * `gp _status_hint` — called by the cd override to print a 2-line project summary.
 * Must be fast. No AI, no network calls, just git.
 */

import { isGitRepo, gitStatus, gitLog, hasRemote } from "../lib/git.ts";
import { isWatched } from "../lib/config.ts";
import chalk from "chalk";

export async function runStatusHint(dir: string = process.cwd()): Promise<void> {
  // Only show inside watched git repos
  if (!(await isWatched(dir))) return;
  if (!(await isGitRepo(dir))) return;

  const [status, commits, remote] = await Promise.all([
    gitStatus(dir),
    gitLog(dir, 1),
    hasRemote(dir),
  ]);

  const name = dir.split("/").pop() ?? dir;
  const lastCommit = commits[0]
    ? `${commits[0].relativeDate} — ${commits[0].message.substring(0, 50)}`
    : "no commits yet";

  const changeStr = status.clean
    ? chalk.green("clean")
    : chalk.yellow(`${status.staged + status.unstaged + status.untracked} unsaved`);

  const githubStr = remote ? "" : chalk.dim(" · not on GitHub");

  console.log(
    chalk.dim("  ") +
    chalk.cyan(name) +
    chalk.dim(" · last save: ") +
    chalk.white(lastCommit) +
    githubStr
  );
  console.log(
    chalk.dim("  status: ") + changeStr +
    (status.hasChanges ? chalk.dim(" · run gp push when ready") : "")
  );
}

/**
 * `gp open` — open the current project's GitHub page in the browser.
 */

import { gp, banner } from "../lib/display.ts";
import { isGitRepo, hasRemote } from "../lib/git.ts";
import chalk from "chalk";

export async function runOpen(dir: string = process.cwd()): Promise<void> {
  if (!(await isGitRepo(dir))) {
    gp.warn("Not a git repo. Run `gp init` first.");
    return;
  }

  if (!(await hasRemote(dir))) {
    gp.warn("This project isn't connected to GitHub yet.");
    gp.info("Run `gp init` to create a GitHub repo.");
    return;
  }

  const remoteResult = await Bun.$`git -C ${dir} remote get-url origin`.quiet().nothrow();
  const remoteUrl = remoteResult.stdout.toString().trim();

  // Normalise SSH and HTTPS remote URLs to a browser URL
  let webUrl = remoteUrl
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/\.git$/, "");

  if (!webUrl.startsWith("https://github.com/")) {
    gp.warn(`Remote URL doesn't look like GitHub: ${remoteUrl}`);
    return;
  }

  banner();
  gp.header("Opening GitHub");
  gp.blank();
  console.log(chalk.dim(`  ${webUrl}`));
  gp.blank();

  // xdg-open works on Linux; fallback to printing URL if it fails
  const result = await Bun.$`xdg-open ${webUrl}`.quiet().nothrow();
  if (result.exitCode !== 0) {
    // xdg-open not available — just print the URL clearly so user can click it
    gp.info("Could not open browser automatically. Copy the URL above.");
  }
}

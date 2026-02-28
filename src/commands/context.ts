/**
 * `gp context` — generate/refresh the .gp/context.md cheat sheet for a project.
 * Also called automatically by shell-hook on cd, and after gp push.
 */

import { writeContext, getContextPath } from "../lib/context.ts";
import { isGitRepo } from "../lib/git.ts";
import { gp, banner } from "../lib/display.ts";
import { basename } from "node:path";
import { readFileSync } from "node:fs";

export async function runContext(dir: string = process.cwd()): Promise<void> {
  banner();
  gp.header(`Context — ${basename(dir)}`);

  if (!(await isGitRepo(dir))) {
    gp.warn("Not a git repo. Run `gp init` first.");
    return;
  }

  gp.info("Reading project and generating context file...");
  await writeContext(dir);
  gp.success(`Context written to .gp/context.md`);
  gp.blank();

  // Print the generated file
  try {
    const content = readFileSync(getContextPath(dir), "utf8");
    console.log(content);
  } catch { /* ok */ }
}

import { writeReadme, updateReadmeChangelog, generateRepoMeta, applyRepoMeta } from "../lib/readme.ts";
import { isAIAvailable } from "../lib/ai.ts";
import { gp, banner } from "../lib/display.ts";
import { basename, join } from "node:path";
import { existsSync } from "node:fs";

export async function runReadme(dir: string = process.cwd()): Promise<void> {
  banner();
  gp.header(`Generate README — ${basename(dir)}`);

  const aiOk = await isAIAvailable();
  if (!aiOk) {
    gp.warn("No AI provider available. A basic template README will be generated.");
    gp.info("Configure OpenAI (openai_api_key) or start Ollama for AI-powered READMEs.");
  } else {
    gp.info("Reading your project files...");
  }

  const readmePath = join(dir, "README.md");
  const hasReadme = existsSync(readmePath);

  let result: string;
  if (hasReadme) {
    gp.info("README exists — updating changelog section...");
    result = await updateReadmeChangelog(dir);
  } else {
    gp.info("No README found — generating from scratch...");
    result = await writeReadme(dir);
  }

  if (result === "updated" || result === "written") {
    gp.blank();
    gp.success("README.md written.");

    // Set GitHub repo description, topics, homepage
    try {
      const remote = await Bun.$`git -C ${dir} remote get-url origin`.quiet().nothrow();
      const remoteUrl = remote.stdout.toString().trim();
      const repoFullName = remoteUrl.match(/github\.com[:/](.+?)(?:\.git)?$/)?.[1] ?? "";
      if (repoFullName) {
        gp.info("Setting GitHub description and topics...");
        const meta = await generateRepoMeta(dir);
        await applyRepoMeta(repoFullName, meta);
        gp.success(`GitHub updated: description + ${meta.topics.length} topics`);
        if (meta.homepage) gp.info(`Homepage: ${meta.homepage}`);
      }
    } catch { /* non-fatal — GitHub meta is best-effort */ }

    gp.info("Review it and then push: gp push");
  } else {
    gp.error("Failed to write README.md — check file permissions.");
  }
  gp.blank();
}

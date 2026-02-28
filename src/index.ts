#!/usr/bin/env bun
/**
 * GitPal CLI — entry point
 * Usage: gp <command> [args]
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { runSetup } from "./commands/setup.ts";
import { runInit } from "./commands/init.ts";
import { runPush, type PushOptions } from "./commands/push.ts";
import { runUndo, type UndoOptions } from "./commands/undo.ts";
import { runStatus } from "./commands/status.ts";
import { runWatch } from "./commands/watch.ts";
import { runReadme } from "./commands/readme.ts";
import { runShellHook } from "./commands/shell-hook.ts";
import { gp, banner } from "./lib/display.ts";
import { runSnapshot, runLog } from "./commands/snapshot-log.ts";
import { runContext } from "./commands/context.ts";
import { runNew } from "./commands/new.ts";
import { runDoctor, type DoctorOptions } from "./commands/doctor.ts";
import { runDigest, installDigestCron, runDailyReadmeRefresh } from "./commands/digest.ts";
import { runStatusHint } from "./commands/status-hint.ts";
import { runSync } from "./commands/sync.ts";
import { runBlame } from "./commands/blame.ts";
import { runStash } from "./commands/stash.ts";
import { runOpen } from "./commands/open.ts";
import { runDiff } from "./commands/diff.ts";
import { runRecent } from "./commands/recent.ts";
import { runClean } from "./commands/clean.ts";

const [, , cmd, ...args] = process.argv;

async function main(): Promise<void> {
  switch (cmd) {
    case "setup":
      await runSetup();
      break;

    case "init": {
      const dir = process.cwd();
      const nonInteractive = args.includes("--here") || args.includes("--non-interactive");
      await runInit(dir, nonInteractive);
      break;
    }

    case "push": {
      const pushOpts: PushOptions = {
        yes:     args.includes("--yes") || args.includes("-y"),
        quiet:   args.includes("--quiet") || args.includes("-q"),
        message: (() => {
          const mi = args.findIndex((a) => a === "--message" || a === "-m");
          return mi !== -1 ? args[mi + 1] : undefined;
        })(),
      };
      await runPush(process.cwd(), pushOpts);
      break;
    }

    case "undo": {
      const toHash = (() => {
        const ti = args.findIndex((a) => a === "--to");
        return ti !== -1 ? args[ti + 1] : undefined;
      })();
      const undoMode = args.includes("--hard") ? "hard" : "soft";
      await runUndo(process.cwd(), { to: toHash, mode: undoMode });
      break;
    }

    case "status":
      await runStatus();
      break;

    case "watch":
      await runWatch(args[0] ?? "status", process.cwd());
      break;

    case "readme":
      await runReadme(process.cwd());
      break;

    case "snapshot": {
      const snapMsg = (() => {
        const mi = args.findIndex((a) => a === "--message" || a === "-m");
        return mi !== -1 ? args[mi + 1] : undefined;
      })();
      const quiet = args.includes("--quiet") || args.includes("-q");
      await runSnapshot(process.cwd(), { message: snapMsg, quiet });
      break;
    }

    case "log": {
      const jsonMode = args.includes("--json");
      const diffMode = args.includes("--diff");
      const n = parseInt(args.find((a) => /^\d+$/.test(a)) ?? "15");
      await runLog(process.cwd(), { json: jsonMode, diff: diffMode, n });
      break;
    }

    case "context":
      await runContext(process.cwd());
      break;

    case "new": {
      const newName = args[0]?.startsWith("-") ? undefined : args[0];
      const newTemplate = (() => {
        const ti = args.findIndex((a) => a === "--template" || a === "-t");
        return ti !== -1 ? args[ti + 1] : undefined;
      })();
      await runNew(newName, newTemplate);
      break;
    }

    case "_shell_hook":
      await runShellHook(args[0] ?? process.cwd());
      break;

    case "_status_hint":
      await runStatusHint(process.cwd());
      break;

    case "doctor": {
      const doctorOpts: DoctorOptions = { fix: args.includes("--fix") };
      await runDoctor(doctorOpts);
      break;
    }

    case "digest":
      if (args.includes("--install-cron")) {
        await installDigestCron();
      } else {
        const isCron = args.includes("--cron") || args.includes("--quiet");
        const editionArg = args.find(a => a.startsWith("--edition="))?.split("=")[1];
        const forceEdition = editionArg === "morning" || editionArg === "noon" || editionArg === "evening" || editionArg === "midnight" ? editionArg : undefined;
        await runDigest(isCron, forceEdition);
      }
      break;

    case "blame":
      await runBlame(args[0], process.cwd());
      break;

    case "stash":
      await runStash(args[0] ?? "push", process.cwd());
      break;

    case "open":
      await runOpen(process.cwd());
      break;

    case "diff":
      await runDiff(process.cwd());
      break;

    case "recent":
      await runRecent();
      break;

    case "clean": {
      const cleanYes = args.includes("--yes") || args.includes("-y");
      await runClean(process.cwd(), cleanYes);
      break;
    }

    case "sync":
      await runSync(process.cwd());
      break;

    case "serve": {
      const pidFile = join(homedir(), ".gitpal", "sessions", "gp-server.pid");
      let running = false;

      if (await Bun.file(pidFile).exists()) {
        const raw = await Bun.file(pidFile).text();
        const pid = parseInt(raw.trim(), 10);
        if (Number.isFinite(pid)) {
          const alive = await Bun.$`kill -0 ${pid}`.quiet().nothrow();
          running = alive.exitCode === 0;
        }
      }

      if (running) {
        console.log("GitPal dashboard already running at http://localhost:4242");
        break;
      }

      const serverPath = join(homedir(), ".local", "bin", "gp-server");
      const child = Bun.spawn([serverPath], {
        detached: true,
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
      });
      child.unref();
      console.log("GitPal dashboard started at http://localhost:4242");
      break;
    }

    default:

      banner();
      console.log("  Commands:\n");
      console.log("  gp new <name>                    Scaffold a new project");
      console.log("  gp doctor                        System health check");
      console.log("  gp doctor --fix                  Health check + auto-fix issues");
      console.log("  gp recent                        All projects by last activity");
      console.log("  gp status                        All projects at a glance");
      console.log("  gp serve                          Start the web dashboard (localhost:4242)");
      console.log("  gp digest                        What changed yesterday + container health");
      console.log("  gp digest --install-cron         Auto-run digest at 9am daily");
      console.log("  gp push                          Commit + push to GitHub");
      console.log("  gp push --yes                    No confirmation prompt");
      console.log("  gp push --yes --quiet             Silent (for automation)");
      console.log("  gp sync                          Pull latest from GitHub");
      console.log("  gp diff                          Show current uncommitted changes");
      console.log("  gp snapshot                      Save locally without pushing");
      console.log("  gp undo                          Restore a previous version");
      console.log("  gp undo --to HASH                Restore to specific commit");
      console.log("  gp log                           Recent commits");
      console.log("  gp log --diff                    Recent commits with inline diffs");
      console.log("  gp log --json                    Machine-readable JSON log");
      console.log("  gp blame <file>                  Who changed each line and when");
      console.log("  gp stash                         Set aside uncommitted changes");
      console.log("  gp stash pop                     Restore stashed changes");
      console.log("  gp stash list                    Show all stashes");
      console.log("  gp open                          Open project on GitHub in browser");
      console.log("  gp clean                         Remove build artifacts + docker images");
      console.log("  gp context                       Project context cheat sheet");
      console.log("  gp readme                        Regenerate README + GitHub metadata");
      console.log("  gp init                          Connect project to GitHub");
      console.log("  gp setup                         First-time setup");
      console.log("  gp watch projects                Watch ~/projects for new folders");
      console.log("");
      break;
  }
}

main().catch((err) => {
  gp.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

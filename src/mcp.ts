/**
 * GitPal MCP Server
 * Exposes GitPal CLI commands as MCP tools for AI assistants.
 * Started via: gp mcp
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { execSync } from "node:child_process";
import { z } from "zod/v4";

function run(args: string[], cwd: string): string {
  try {
    const result = execSync(["gp", ...args].join(" "), {
      cwd,
      encoding: "utf8",
      timeout: 120_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return result.trim();
  } catch (err: unknown) {
    if (err && typeof err === "object" && "stdout" in err && "stderr" in err) {
      const e = err as { stdout?: string; stderr?: string; message?: string };
      const out = (e.stdout ?? "").trim();
      const errOut = (e.stderr ?? "").trim();
      return [out, errOut, e.message].filter(Boolean).join("\n").trim();
    }
    return String(err);
  }
}

function text(t: string) {
  return { content: [{ type: "text" as const, text: t || "(no output)" }] };
}

function registerTools(server: McpServer): void {
  server.tool(
    "gp_push",
    "Commit all changes and push to GitHub with an AI-generated commit message",
    {
      yes: z.boolean().optional().describe("Skip confirmation prompt"),
      quiet: z.boolean().optional().describe("Suppress output"),
      message: z.string().optional().describe("Custom commit message"),
      path: z.string().optional().describe("Project directory"),
    },
    ({ yes, quiet, message, path }) => {
      const args: string[] = ["push"];
      if (yes) args.push("--yes");
      if (quiet) args.push("--quiet");
      if (message) args.push("--message", JSON.stringify(message));
      return text(run(args, path ?? process.cwd()));
    },
  );

  server.tool(
    "gp_status",
    "Show status of all watched GitPal projects",
    {},
    () => text(run(["status"], process.cwd())),
  );

  server.tool(
    "gp_log",
    "Show recent git commits for a project",
    {
      n: z.number().int().optional().describe("Number of commits to show"),
      json: z.boolean().optional().describe("Output as JSON"),
      diff: z.boolean().optional().describe("Include diffs"),
      path: z.string().optional().describe("Project directory"),
    },
    ({ n, json, diff, path }) => {
      const args: string[] = ["log"];
      if (json) args.push("--json");
      if (diff) args.push("--diff");
      if (n !== undefined) args.push(String(n));
      return text(run(args, path ?? process.cwd()));
    },
  );

  server.tool(
    "gp_diff",
    "Show uncommitted changes in a project",
    { path: z.string().optional().describe("Project directory") },
    ({ path }) => text(run(["diff"], path ?? process.cwd())),
  );

  server.tool(
    "gp_snapshot",
    "Commit locally without pushing to GitHub",
    {
      message: z.string().optional().describe("Snapshot commit message"),
      quiet: z.boolean().optional().describe("Suppress output"),
      path: z.string().optional().describe("Project directory"),
    },
    ({ message, quiet, path }) => {
      const args: string[] = ["snapshot"];
      if (message) args.push("--message", JSON.stringify(message));
      if (quiet) args.push("--quiet");
      return text(run(args, path ?? process.cwd()));
    },
  );

  server.tool(
    "gp_undo",
    "Restore a previous git state (snapshots current state first)",
    {
      to: z.string().optional().describe("Commit hash to restore to"),
      hard: z.boolean().optional().describe("Hard reset"),
      path: z.string().optional().describe("Project directory"),
    },
    ({ to, hard, path }) => {
      const args: string[] = ["undo"];
      if (to) args.push("--to", to);
      if (hard) args.push("--hard");
      return text(run(args, path ?? process.cwd()));
    },
  );

  server.tool(
    "gp_context",
    "Show the project context cheat sheet (.gp/context.md)",
    { path: z.string().optional().describe("Project directory") },
    ({ path }) => text(run(["context"], path ?? process.cwd())),
  );

  server.tool(
    "gp_doctor",
    "Run system health check on GitPal setup",
    {
      fix: z.boolean().optional().describe("Auto-fix detected issues"),
      path: z.string().optional().describe("Project directory"),
    },
    ({ fix, path }) => {
      const args: string[] = ["doctor"];
      if (fix) args.push("--fix");
      return text(run(args, path ?? process.cwd()));
    },
  );

  server.tool(
    "gp_digest",
    "Generate the GitPal Gazette daily digest",
    {
      edition: z.string().optional().describe("Edition: morning, noon, evening, or midnight"),
      path: z.string().optional().describe("Project directory"),
    },
    ({ edition, path }) => {
      const args: string[] = ["digest"];
      if (edition) args.push(`--edition=${edition}`);
      return text(run(args, path ?? process.cwd()));
    },
  );

  server.tool(
    "gp_readme",
    "Regenerate README.md and update GitHub metadata",
    { path: z.string().optional().describe("Project directory") },
    ({ path }) => text(run(["readme"], path ?? process.cwd())),
  );

  server.tool(
    "gp_blame",
    "Show who changed each line in a file",
    {
      file: z.string().describe("File path to blame"),
      path: z.string().optional().describe("Project directory"),
    },
    ({ file, path }) => text(run(["blame", file], path ?? process.cwd())),
  );

  server.tool(
    "gp_sync",
    "Pull latest changes from GitHub",
    { path: z.string().optional().describe("Project directory") },
    ({ path }) => text(run(["sync"], path ?? process.cwd())),
  );

  server.tool(
    "gp_clean",
    "Remove build artifacts and untracked files",
    {
      yes: z.boolean().optional().describe("Skip confirmation"),
      path: z.string().optional().describe("Project directory"),
    },
    ({ yes, path }) => {
      const args: string[] = ["clean"];
      if (yes) args.push("--yes");
      return text(run(args, path ?? process.cwd()));
    },
  );

  server.tool(
    "gp_recent",
    "Show all projects sorted by last activity",
    {},
    () => text(run(["recent"], process.cwd())),
  );

  server.tool(
    "gp_open",
    "Open the project on GitHub in browser",
    { path: z.string().optional().describe("Project directory") },
    ({ path }) => text(run(["open"], path ?? process.cwd())),
  );
}

export async function runMcp(): Promise<void> {
  const server = new McpServer({
    name: "gitpal",
    version: "1.0.0",
  });

  registerTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

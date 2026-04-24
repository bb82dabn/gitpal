import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getContextPath, isContextStale, writeContext } from "../src/lib/context.ts";

const tempDirs: string[] = [];

function makeTempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "gitpal-context-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("context generation", () => {
  test("builds the expected context file path", () => {
    expect(getContextPath("/tmp/demo")).toBe("/tmp/demo/.gp/context.md");
  });

  test("treats missing context files as stale", () => {
    const dir = makeTempProject();
    expect(isContextStale(dir)).toBe(true);
  });

  test("writes starter project context and updates .gitignore", async () => {
    const dir = makeTempProject();
    const srcDir = join(dir, "src");
    await Bun.$`mkdir -p ${srcDir}`.quiet();

    writeFileSync(join(dir, "package.json"), JSON.stringify({
      dependencies: {
        react: "^19.0.0",
      },
      devDependencies: {
        typescript: "^5.0.0",
      },
    }, null, 2));
    writeFileSync(join(dir, ".gitignore"), "node_modules\n");
    writeFileSync(join(dir, "docker-compose.yml"), [
      "services:",
      "  web:",
      "    image: nginx:latest",
      "  db:",
      "    image: postgres:latest",
      "",
    ].join("\n"));
    writeFileSync(join(srcDir, "index.ts"), "// TODO: add more commands\nexport const ok = true;\n");

    await writeContext(dir);

    const context = readFileSync(getContextPath(dir), "utf8");
    const gitignore = readFileSync(join(dir, ".gitignore"), "utf8");

    expect(context).toContain("# ");
    expect(context).toContain("## Stack");
    expect(context).toContain("- React");
    expect(context).toContain("- TypeScript");
    expect(context).toContain("## Docker Services");
    expect(context).toContain("- web");
    expect(context).toContain("- db");
    expect(context).toContain("## TODOs Found in Code");
    expect(context).toContain("add more commands");
    expect(context).toContain("## How to Work on This Project");
    expect(gitignore).toContain(".gp/");
    expect(isContextStale(dir)).toBe(false);
  });
});

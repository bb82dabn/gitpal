/**
 * `gp new <name>` — scaffold a new project from a template,
 * git init, connect to GitHub, and start watching. One command.
 */

import { select, input } from "@inquirer/prompts";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { runInit } from "./init.ts";
import { gp, banner } from "../lib/display.ts";
import { loadConfig } from "../lib/config.ts";

const HOME = homedir();

// ── Templates ─────────────────────────────────────────────────────────────────

const TEMPLATES: Record<string, { label: string; description: string }> = {
  nextjs:   { label: "Next.js",         description: "App Router, Tailwind, TypeScript" },
  express:  { label: "Express API",     description: "Node.js REST API, TypeScript" },
  bun:      { label: "Bun script",      description: "Plain Bun/TypeScript script or tool" },
  html:     { label: "Static site",     description: "Plain HTML/CSS/JS, no framework" },
  blank:    { label: "Blank",           description: "Just git init and GitHub, no files" },
};

function writeNextjs(dir: string, name: string): void {
  writeFileSync(join(dir, "package.json"), JSON.stringify({
    name,
    version: "0.1.0",
    private: true,
    scripts: {
      dev: "next dev",
      build: "next build",
      start: "next start",
      lint: "next lint",
      typecheck: "tsc --noEmit",
    },
    dependencies: { next: "^15.0.0", react: "^19.0.0", "react-dom": "^19.0.0" },
    devDependencies: {
      typescript: "^5", "@types/node": "^22", "@types/react": "^19",
      tailwindcss: "^4", eslint: "^9", "eslint-config-next": "^15",
    },
  }, null, 2));

  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      target: "ES2017", lib: ["dom", "dom.iterable", "esnext"],
      allowJs: true, skipLibCheck: true, strict: true,
      noEmit: true, esModuleInterop: true, module: "esnext",
      moduleResolution: "bundler", resolveJsonModule: true,
      isolatedModules: true, jsx: "preserve", incremental: true,
      plugins: [{ name: "next" }],
      paths: { "@/*": ["./src/*"] },
    },
    include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
    exclude: ["node_modules"],
  }, null, 2));

  mkdirSync(join(dir, "src", "app"), { recursive: true });
  writeFileSync(join(dir, "src", "app", "page.tsx"),
`export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <h1 className="text-4xl font-bold">${name}</h1>
    </main>
  );
}
`);
  writeFileSync(join(dir, "src", "app", "layout.tsx"),
`import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "${name}",
  description: "",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`);
  writeFileSync(join(dir, "src", "app", "globals.css"), "@import \"tailwindcss\";\n");
  writeFileSync(join(dir, ".env.local"), `# ${name} environment variables\n`);
  writeFileSync(join(dir, ".gitignore"),
`.env\n.env.local\n.env.*.local\nnode_modules/\n.next/\ndist/\nbuild/\n.DS_Store\n*.log\n.gp/\n`);
  writeFileSync(join(dir, "next.config.ts"),
`import type { NextConfig } from "next";\nconst nextConfig: NextConfig = {};\nexport default nextConfig;\n`);
}

function writeExpress(dir: string, name: string): void {
  writeFileSync(join(dir, "package.json"), JSON.stringify({
    name, version: "0.1.0", private: true,
    scripts: { dev: "bun --watch src/index.ts", build: "bun build src/index.ts --outdir dist", start: "node dist/index.js", typecheck: "tsc --noEmit" },
    dependencies: { express: "^4.21.0" },
    devDependencies: { typescript: "^5", "@types/node": "^22", "@types/express": "^5", bun: "latest" },
  }, null, 2));

  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({
    compilerOptions: { target: "ES2022", module: "commonjs", lib: ["ES2022"], outDir: "dist", rootDir: "src", strict: true, esModuleInterop: true, skipLibCheck: true, resolveJsonModule: true },
    include: ["src"], exclude: ["node_modules", "dist"],
  }, null, 2));

  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "index.ts"),
`import express from "express";

const app = express();
const PORT = process.env.PORT ?? 3000;

app.use(express.json());

app.get("/", (_req, res) => {
  res.json({ ok: true, name: "${name}" });
});

app.listen(PORT, () => {
  console.log(\`${name} running on http://localhost:\${PORT}\`);
});
`);
  writeFileSync(join(dir, ".env"), `PORT=3000\n`);
  writeFileSync(join(dir, ".gitignore"), `.env\n.env.local\nnode_modules/\ndist/\n.DS_Store\n*.log\n.gp/\n`);
}

function writeBun(dir: string, name: string): void {
  writeFileSync(join(dir, "package.json"), JSON.stringify({
    name, version: "0.1.0", private: true,
    scripts: { start: "bun src/index.ts", typecheck: "bun run --bun tsc --noEmit" },
    devDependencies: { typescript: "^5", "@types/bun": "latest" },
  }, null, 2));
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({
    compilerOptions: { lib: ["ESNext"], target: "ESNext", module: "Preserve", moduleResolution: "Bundler", moduleDetection: "force", allowImportingTsExtensions: true, noEmit: true, composite: false, strict: true, downlevelIteration: true, skipLibCheck: true, jsx: "react-jsx", allowSyntheticDefaultImports: true, forceConsistentCasingInFileNames: true, allowJs: true },
  }, null, 2));
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "index.ts"), `console.log("${name} is running!");\n`);
  writeFileSync(join(dir, ".gitignore"), `node_modules/\ndist/\n.DS_Store\n*.log\n.gp/\n`);
}

function writeHtml(dir: string, name: string): void {
  writeFileSync(join(dir, "index.html"),
`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${name}</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <h1>${name}</h1>
  <script src="main.js"></script>
</body>
</html>
`);
  writeFileSync(join(dir, "style.css"), `* { box-sizing: border-box; margin: 0; padding: 0; }\nbody { font-family: system-ui, sans-serif; padding: 2rem; }\n`);
  writeFileSync(join(dir, "main.js"), `// ${name}\nconsole.log("${name} loaded");\n`);
  writeFileSync(join(dir, ".gitignore"), `.DS_Store\n*.log\n.gp/\n`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function runNew(nameArg?: string, templateArg?: string): Promise<void> {
  banner();
  gp.header("New Project");

  const config = await loadConfig();

  // Determine projects root from watch_patterns
  const projectsRoot = config.watch_patterns[0]
    ?.replace("~", HOME).replace(/\/\*$/, "")
    ?? join(HOME, "projects");

  // Get project name
  let name = nameArg;
  if (!name) {
    name = await input({ message: "Project name:", validate: (v) => v.trim().length > 0 || "Name required" });
  }
  name = name.trim().toLowerCase().replace(/\s+/g, "-");

  const dir = join(projectsRoot, name);

  if (existsSync(dir)) {
    gp.error(`Directory already exists: ${dir}`);
    gp.info("Pick a different name or cd into the existing project.");
    return;
  }

  // Get template
  let templateKey = templateArg ?? "";
  if (!templateKey || !(templateKey in TEMPLATES)) {
    const choice = await select({
      message: "What kind of project?",
      choices: Object.entries(TEMPLATES).map(([key, t]) => ({
        name: `${t.label.padEnd(16)} ${t.description}`,
        value: key,
        short: t.label,
      })),
    });
    templateKey = choice;
  }

  // Create dir + scaffold
  gp.info(`Creating ${name}/ in ${projectsRoot}...`);
  mkdirSync(dir, { recursive: true });

  switch (templateKey) {
    case "nextjs":  writeNextjs(dir, name);  break;
    case "express": writeExpress(dir, name); break;
    case "bun":     writeBun(dir, name);     break;
    case "html":    writeHtml(dir, name);    break;
    case "blank":   writeFileSync(join(dir, ".gitignore"), ".gp/\n.DS_Store\n*.log\n"); break;
  }

  gp.success(`Files created — ${TEMPLATES[templateKey]?.label}`);

  // Install deps if there's a package.json
  if (templateKey !== "html" && templateKey !== "blank") {
    const hasBunLock = existsSync(join(dir, "bun.lockb")) || templateKey === "bun";
    const installer = hasBunLock ? "bun" : "pnpm";
    gp.info(`Installing dependencies with ${installer}...`);
    const install = await Bun.$`${installer} install`.cwd(dir).nothrow();
    if (install.exitCode !== 0) {
      gp.warn("Dependency install failed — run it manually.");
    } else {
      gp.success("Dependencies installed.");
    }
  }

  // git init + GitHub
  gp.blank();
  await runInit(dir, true); // non-interactive

  gp.blank();
  gp.success(`Done! Your new project is ready:`);
  console.log(`    cd ~/projects/${name}`);
  if (templateKey === "nextjs") console.log(`    pnpm dev`);
  if (templateKey === "express" || templateKey === "bun") console.log(`    bun run dev`);
  gp.blank();
}

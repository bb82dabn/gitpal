import { loadConfig } from "./config.ts";

const MAX_DIFF_CHARS = 4000;

const PROMPT_TEMPLATE = (diff: string) => `You are a git commit message writer. Given the following git diff, write a concise conventional commit message.

Rules:
- Format: type: description (max 72 chars total)
- Types: feat, fix, refactor, style, docs, chore
- Be specific about WHAT changed — file names, feature names, what was added/removed
- Do NOT write vague messages like 'update files', 'auto-save', 'chore: updates', 'misc changes'
- Output ONLY the commit message. No explanation, no quotes, no markdown.

Diff:
${diff}`;

// ── Fallback: generate a descriptive message from diff stats ──────────────

function statFallback(diff: string): string {
  const lines = diff.split("\n");
  let added = 0, removed = 0;
  const files = new Set<string>();

  for (const line of lines) {
    if (line.startsWith("+++ b/")) files.add(line.slice(6).trim());
    else if (line.startsWith("--- a/")) files.add(line.slice(6).trim());
    else if (line.startsWith("+") && !line.startsWith("++")) added++;
    else if (line.startsWith("-") && !line.startsWith("--")) removed++;
  }

  const fileCount = files.size;
  const statPart = [
    added > 0 ? `+${added}` : "",
    removed > 0 ? `-${removed}` : "",
  ].filter(Boolean).join(", ");

  if (fileCount === 0) {
    const now = new Date();
    return `chore: auto-save ${now.toTimeString().substring(0, 5)}`;
  }

  // Prefix: guess intent from file names
  const fileList = [...files];
  const isNewFile = diff.includes("new file mode");
  const type = isNewFile ? "add" : "update";

  if (fileCount <= 3) {
    const names = fileList.map(f => f.split("/").pop() ?? f).join(", ");
    return statPart ? `${type} ${names} (${statPart})` : `${type} ${names}`;
  }

  return statPart
    ? `${type} ${fileCount} files (${statPart})`
    : `${type} ${fileCount} files`;
}

// Detect vague/generic messages Ollama sometimes returns
const VAGUE_PATTERNS = [
  /^chore: (auto-?save|updates?|misc|wip|changes?)$/i,
  /^(wip|misc|update|updates|auto-save|auto save)$/i,
  /^chore: update \d+ files?$/i,
  /^refactor: update files?$/i,
];

function isVague(msg: string): boolean {
  return VAGUE_PATTERNS.some(p => p.test(msg.trim()));
}

// ── Truncation: structured summary when diff is too large ─────────────────

function truncateDiff(diff: string): string {
  if (diff.length <= MAX_DIFF_CHARS) return diff;

  // Build a structured summary: per-file line counts
  const fileSections = diff.split(/(?=^diff --git )/m);
  const summaryLines: string[] = [`[Large diff — ${diff.length} chars. File-by-file summary:]`];

  for (const section of fileSections.slice(0, 20)) {
    const fileMatch = section.match(/^diff --git a\/.+ b\/(.+)/m);
    if (!fileMatch) continue;
    const fname = fileMatch[1] ?? "unknown";
    const added   = (section.match(/^\+[^+]/mg) ?? []).length;
    const removed = (section.match(/^-[^-]/mg) ?? []).length;
    const isNew   = section.includes("new file mode");
    const tag = isNew ? "[new]" : "";
    summaryLines.push(`  ${tag} ${fname}: +${added} -${removed}`);
  }

  return summaryLines.join("\n");
}

// ── Main export ────────────────────────────────────────────────────────────

export async function generateCommitMessage(diff: string): Promise<string> {
  if (!diff.trim()) return statFallback(diff);

  const config = await loadConfig();
  const truncated = truncateDiff(diff);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    const response = await fetch(`${config.ollama_url}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.ollama_model,
        prompt: PROMPT_TEMPLATE(truncated),
        stream: false,
        options: { temperature: 0.3, num_predict: 80 },
      }),
    });

    clearTimeout(timeout);

    if (!response.ok) return statFallback(diff);

    const data = await response.json() as { response?: string };
    const message = (data.response ?? "").trim().replace(/^["']|["']$/g, "");

    if (!message || message.length < 5 || isVague(message)) {
      return statFallback(diff);
    }

    return message.length > 72 ? message.substring(0, 72) : message;
  } catch {
    return statFallback(diff);
  }
}

export async function isOllamaRunning(): Promise<boolean> {
  const config = await loadConfig();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3_000);
    const res = await fetch(`${config.ollama_url}/api/tags`, { signal: controller.signal });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

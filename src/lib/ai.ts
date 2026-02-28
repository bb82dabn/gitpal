import { loadConfig, type GitPalConfig } from "./config.ts";

const MAX_DIFF_CHARS = 4000;

const COMMIT_PROMPT = (diff: string) => `You are a git commit message writer. Given the following git diff, write a concise conventional commit message.

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

// Detect vague/generic messages
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

// ── OpenAI chat completion ────────────────────────────────────────────────

interface OpenAIChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

async function callOpenAI(config: GitPalConfig, prompt: string, maxTokens = 80): Promise<string | null> {
  if (!config.openai_api_key) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.openai_api_key}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.openai_model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: maxTokens,
        temperature: 0.3,
      }),
    });

    clearTimeout(timeout);
    if (!response.ok) return null;

    const data = await response.json() as OpenAIChatResponse;
    return data.choices?.[0]?.message?.content?.trim() ?? null;
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

// ── Ollama (legacy fallback) ──────────────────────────────────────────────

interface OllamaResponse {
  response?: string;
}

async function callOllama(config: GitPalConfig, prompt: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(`${config.ollama_url}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.ollama_model,
        prompt,
        stream: false,
        options: { temperature: 0.3, num_predict: 80 },
      }),
    });

    clearTimeout(timeout);
    if (!response.ok) return null;

    const data = await response.json() as OllamaResponse;
    return data.response?.trim() ?? null;
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

// ── Unified AI call ───────────────────────────────────────────────────────

/** Send a prompt to the configured AI provider. Returns null on failure. */
export async function aiComplete(prompt: string, maxTokens = 80): Promise<string | null> {
  const config = await loadConfig();

  if (config.ai_provider === "openai" && config.openai_api_key) {
    return callOpenAI(config, prompt, maxTokens);
  }

  return callOllama(config, prompt);
}

// ── DALL-E image generation ───────────────────────────────────────────────

interface OpenAIImageResponse {
  data?: Array<{ url?: string }>;
}

/**
 * Generate an image via DALL-E 3 and return the URL, or null on failure.
 * style: 'vivid' (dramatic) | 'natural' (realistic)
 */
export async function aiImage(
  prompt: string,
  style: "vivid" | "natural" = "vivid",
): Promise<string | null> {
  const config = await loadConfig();
  if (!config.openai_api_key) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.openai_api_key}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: "dall-e-3",
        prompt,
        n: 1,
        size: "1024x1024",
        style,
        response_format: "url",
      }),
    });
    clearTimeout(timeout);
    if (!response.ok) return null;
    const data = await response.json() as OpenAIImageResponse;
    return data.data?.[0]?.url ?? null;
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

// ── Main export: commit messages ────────────────────────────────────────────

export async function generateCommitMessage(diff: string): Promise<string> {
  if (!diff.trim()) return statFallback(diff);

  const truncated = truncateDiff(diff);
  const message = await aiComplete(COMMIT_PROMPT(truncated));

  if (!message || message.length < 5 || isVague(message)) {
    return statFallback(diff);
  }

  // Strip wrapping quotes if present
  const cleaned = message.replace(/^["']|["']$/g, "");
  return cleaned.length > 72 ? cleaned.substring(0, 72) : cleaned;
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

/** Check if the configured AI provider is reachable */
export async function isAIAvailable(): Promise<boolean> {
  const config = await loadConfig();

  if (config.ai_provider === "openai" && config.openai_api_key) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5_000);
      const res = await fetch("https://api.openai.com/v1/models", {
        headers: { "Authorization": `Bearer ${config.openai_api_key}` },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return res.ok;
    } catch {
      return false;
    }
  }

  return isOllamaRunning();
}

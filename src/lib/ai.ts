import { loadConfig } from "./config.ts";

const MAX_DIFF_CHARS = 4000;

const PROMPT_TEMPLATE = (diff: string) => `You are a git commit message writer. Given the following git diff, write a concise conventional commit message.

Rules:
- Format: type: description (max 72 chars total)
- Types: feat, fix, refactor, style, docs, chore
- Be specific about what changed, not how
- Output ONLY the commit message. No explanation, no quotes, no markdown.

Diff:
${diff}`;

function truncateDiff(diff: string): string {
  if (diff.length <= MAX_DIFF_CHARS) return diff;

  // Extract file names from diff header lines
  const fileLines = diff
    .split("\n")
    .filter((l) => l.startsWith("diff --git") || l.startsWith("+++ b/") || l.startsWith("New files"))
    .slice(0, 20)
    .join("\n");

  return `[Diff truncated — ${diff.length} chars]\nFiles changed:\n${fileLines}`;
}

export async function generateCommitMessage(diff: string): Promise<string> {
  if (!diff.trim()) {
    return fallbackMessage();
  }

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
        options: {
          temperature: 0.3,
          num_predict: 80,
        },
      }),
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return fallbackMessage();
    }

    const data = await response.json() as { response?: string };
    const message = (data.response ?? "").trim().replace(/^["']|["']$/g, "");

    if (!message || message.length < 5) return fallbackMessage();
    // Ensure it doesn't exceed 72 chars
    return message.length > 72 ? message.substring(0, 72) : message;
  } catch {
    return fallbackMessage();
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

function fallbackMessage(): string {
  const now = new Date();
  const hhmm = now.toTimeString().substring(0, 5);
  return `chore: auto-save ${hhmm}`;
}

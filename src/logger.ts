/**
 * Minimal stderr logger. stdout is reserved for the MCP JSON-RPC stream, so
 * nothing in this server may ever write diagnostics there.
 */

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

let threshold: LogLevel = parseLevel(process.env.JIRA_MCP_LOG_LEVEL) ?? "info";
const secrets = new Set<string>();

function parseLevel(value: string | undefined): LogLevel | undefined {
  const v = value?.trim().toLowerCase();
  return v && v in RANK ? (v as LogLevel) : undefined;
}

/** Any value registered here is masked in every log line. */
export function registerSecret(value: string | undefined): void {
  if (value && value.length >= 6) secrets.add(value);
}

export function redact(text: string): string {
  let out = text;
  for (const s of secrets) out = out.split(s).join("****");
  return out;
}

function stringify(part: unknown): string {
  if (part instanceof Error) return part.stack ?? part.message;
  if (typeof part === "string") return part;
  try {
    return JSON.stringify(part);
  } catch {
    return String(part);
  }
}

function emit(level: Exclude<LogLevel, "silent">, parts: unknown[]): void {
  if (RANK[level] < RANK[threshold]) return;
  const line = parts.map(stringify).join(" ");
  process.stderr.write(`[multiinstance-jira-mcp] ${level.toUpperCase()} ${redact(line)}\n`);
}

export const log = {
  debug: (...parts: unknown[]) => emit("debug", parts),
  info: (...parts: unknown[]) => emit("info", parts),
  warn: (...parts: unknown[]) => emit("warn", parts),
  error: (...parts: unknown[]) => emit("error", parts),
  setLevel(level: string | undefined) {
    const parsed = parseLevel(level);
    if (parsed) threshold = parsed;
  },
};

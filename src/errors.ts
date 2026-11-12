import { redact } from "./logger.js";

/** An error whose message is meant to be shown to the user / model verbatim. */
export class UserError extends Error {
  override name = "UserError";
}

export class NotAuthenticatedError extends UserError {
  override name = "NotAuthenticatedError";
}

export class JiraHttpError extends Error {
  override name = "JiraHttpError";

  constructor(
    readonly instance: string,
    readonly status: number,
    readonly method: string,
    readonly url: string,
    readonly detail: string,
    readonly hint?: string,
  ) {
    super(
      `[${instance}] Jira responded ${status} to ${method} ${url}` +
        (detail ? `: ${detail}` : "") +
        (hint ? `\nHint: ${hint}` : ""),
    );
  }
}

export function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return redact(message);
}

/**
 * Extracts a readable message from a Jira error payload
 * (`{ errorMessages: [], errors: {} }`) or falls back to a truncated body.
 */
export function describeJiraErrorBody(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return "";
  try {
    const data = JSON.parse(trimmed) as { errorMessages?: unknown; errors?: unknown; message?: unknown };
    const parts: string[] = [];
    if (Array.isArray(data.errorMessages)) parts.push(...data.errorMessages.map(String));
    if (data.errors && typeof data.errors === "object") {
      for (const [field, msg] of Object.entries(data.errors as Record<string, unknown>)) {
        parts.push(`${field}: ${String(msg)}`);
      }
    }
    if (typeof data.message === "string") parts.push(data.message);
    if (parts.length > 0) return parts.join("; ");
  } catch {
    // not JSON
  }
  if (trimmed.startsWith("<")) return "(HTML response body omitted)";
  return trimmed.length > 500 ? `${trimmed.slice(0, 500)}…` : trimmed;
}

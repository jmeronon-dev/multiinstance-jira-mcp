import { UserError } from "../errors.js";
import { registerSecret } from "../logger.js";
import {
  AUTH_TYPES,
  DEPLOYMENTS,
  type ApiVersion,
  type AuthType,
  type Deployment,
  type InstanceConfig,
  type InstanceInput,
} from "./types.js";

const CLOUD_HOST_SUFFIXES = [".atlassian.net", ".jira.com", ".jira-dev.com"];

export function normalizeInstanceName(raw: string): string {
  const name = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!name) throw new UserError(`Invalid Jira instance name "${raw}". Use letters, digits, "-" or "_".`);
  return name;
}

export function normalizeBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new UserError(`Invalid Jira URL "${raw}". Expected something like https://your-company.atlassian.net`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new UserError(`Unsupported protocol in Jira URL "${raw}". Use http(s).`);
  }
  const path = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${path}`;
}

function validateUrl(raw: string, name: string): string {
  try {
    return new URL(raw).toString();
  } catch {
    throw new UserError(`Instance "${name}": invalid loginUrl "${raw}".`);
  }
}

export function inferDeployment(baseUrl: string): Deployment {
  const host = new URL(baseUrl).hostname.toLowerCase();
  return CLOUD_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix)) ? "cloud" : "server";
}

export function parseBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  const v = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off", ""].includes(v)) return false;
  return undefined;
}

export function parseInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value !== "string" || !value.trim()) return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : undefined;
}

export function parseProjectList(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  const items = Array.isArray(value) ? value : value.split(/[\s,;|]+/);
  const keys = items.map((k) => k.trim().toUpperCase()).filter(Boolean);
  return [...new Set(keys)];
}

function pickAuth(input: InstanceInput, token: string | undefined, name: string): AuthType {
  const explicit = input.auth?.trim().toLowerCase();
  if (explicit) {
    const aliases: Record<string, AuthType> = {
      basic: "basic",
      token: "basic",
      "api-token": "basic",
      bearer: "bearer",
      pat: "bearer",
      browser: "browser",
      sso: "browser",
      cookie: "browser",
      cookies: "browser",
    };
    const auth = aliases[explicit];
    if (!auth) {
      throw new UserError(
        `Instance "${name}": unknown auth "${input.auth}". Use one of ${AUTH_TYPES.join(", ")}.`,
      );
    }
    return auth;
  }
  if (token && input.email) return "basic";
  if (token) return "bearer";
  return "browser";
}

/** Returns a copy of `base` with every defined field of `override` applied on top. */
export function mergeInstanceInput(base: InstanceInput, override: InstanceInput): InstanceInput {
  const out: InstanceInput = { ...base };
  for (const [key, value] of Object.entries(override) as [keyof InstanceInput, unknown][]) {
    if (value !== undefined && value !== null && value !== "") {
      (out as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}

export function toInstanceConfig(
  input: InstanceInput,
  env: NodeJS.ProcessEnv = process.env,
): InstanceConfig {
  if (!input.name) throw new UserError("Every Jira instance needs a name.");
  const name = normalizeInstanceName(input.name);

  const rawUrl = input.url ?? input.baseUrl;
  if (!rawUrl) {
    throw new UserError(`Instance "${name}" has no URL. Set "url" (e.g. https://your-company.atlassian.net).`);
  }
  const baseUrl = normalizeBaseUrl(rawUrl);

  const tokenFromEnv = input.tokenEnv ? env[input.tokenEnv]?.trim() : undefined;
  if (input.tokenEnv && !tokenFromEnv && !input.token) {
    throw new UserError(`Instance "${name}": environment variable ${input.tokenEnv} (tokenEnv) is empty.`);
  }
  const token = input.token?.trim() || tokenFromEnv || undefined;
  const email = input.email?.trim() || undefined;
  const auth = pickAuth(input, token, name);

  if (auth === "basic" && (!email || !token)) {
    throw new UserError(
      `Instance "${name}": basic auth needs both "email" (or username) and "token" (API token or password).`,
    );
  }
  if (auth === "bearer" && !token) {
    throw new UserError(`Instance "${name}": bearer auth needs a "token" (personal access token).`);
  }

  let deployment: Deployment;
  if (input.deployment) {
    const d = input.deployment.trim().toLowerCase();
    const mapped = d === "datacenter" || d === "data-center" || d === "dc" ? "server" : d;
    if (!DEPLOYMENTS.includes(mapped as Deployment)) {
      throw new UserError(`Instance "${name}": deployment must be "cloud" or "server", got "${input.deployment}".`);
    }
    deployment = mapped as Deployment;
  } else {
    deployment = inferDeployment(baseUrl);
  }

  let apiVersion: ApiVersion = deployment === "cloud" ? 3 : 2;
  if (input.apiVersion !== undefined && input.apiVersion !== "") {
    const v = parseInteger(input.apiVersion);
    if (v !== 2 && v !== 3) {
      throw new UserError(`Instance "${name}": apiVersion must be 2 or 3, got "${input.apiVersion}".`);
    }
    apiVersion = v;
  }

  registerSecret(token);

  return {
    name,
    baseUrl,
    auth,
    email,
    token: auth === "browser" ? undefined : token,
    deployment,
    apiVersion,
    projectKeys: parseProjectList(input.projects),
    defaultProject: input.defaultProject?.trim().toUpperCase() || undefined,
    loginUrl: input.loginUrl?.trim() ? validateUrl(input.loginUrl.trim(), name) : undefined,
    description: input.description?.trim() || undefined,
    readOnly: parseBoolean(input.readOnly) ?? false,
  };
}

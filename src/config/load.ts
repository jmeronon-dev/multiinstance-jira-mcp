import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CliOptions } from "../cli.js";
import { DEFAULT_INSTANCE_NAME } from "../cli.js";
import { UserError } from "../errors.js";
import { log } from "../logger.js";
import {
  mergeInstanceInput,
  normalizeInstanceName,
  parseBoolean,
  parseInteger,
  toInstanceConfig,
} from "./normalize.js";
import type { AppConfig, ConfigFile, InstanceInput } from "./types.js";

const DEFAULTS = {
  loginTimeoutSeconds: 300,
  keepAliveSeconds: 300,
  maxAttachmentBytes: 20 * 1024 * 1024,
};

/** Environment-variable suffixes for each instance field (first match wins). */
const ENV_FIELDS: [keyof InstanceInput, string[]][] = [
  ["url", ["BASE_URL", "URL"]],
  ["email", ["EMAIL", "USERNAME"]],
  ["token", ["API_TOKEN", "TOKEN", "PAT"]],
  ["tokenEnv", ["TOKEN_ENV"]],
  ["auth", ["AUTH"]],
  ["deployment", ["DEPLOYMENT"]],
  ["apiVersion", ["API_VERSION"]],
  ["projects", ["PROJECTS"]],
  ["defaultProject", ["DEFAULT_PROJECT"]],
  ["loginUrl", ["LOGIN_URL"]],
  ["description", ["DESCRIPTION"]],
  ["readOnly", ["READ_ONLY"]],
];

export function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) return path.join(os.homedir(), p.slice(2));
  return p;
}

export function envKeyFor(instanceName: string): string {
  return instanceName.toUpperCase().replace(/[^A-Z0-9]/g, "_");
}

function readEnvFields(env: NodeJS.ProcessEnv, prefix: string): InstanceInput {
  const out: InstanceInput = {};
  for (const [field, suffixes] of ENV_FIELDS) {
    for (const suffix of suffixes) {
      const value = env[`${prefix}${suffix}`];
      if (value !== undefined && value !== "") {
        (out as Record<string, unknown>)[field] = value;
        break;
      }
    }
  }
  return out;
}

function hasAnyField(input: InstanceInput): boolean {
  return Object.values(input).some((v) => v !== undefined && v !== "");
}

export function instancesFromObject(
  value: InstanceInput[] | Record<string, InstanceInput> | undefined,
  source: string,
): InstanceInput[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) {
    return value.map((item, index) => {
      if (!item || typeof item !== "object") throw new UserError(`${source}: instance #${index + 1} is not an object.`);
      if (!item.name) throw new UserError(`${source}: instance #${index + 1} has no "name".`);
      return { ...item };
    });
  }
  if (typeof value === "object") {
    return Object.entries(value).map(([name, item]) => ({ ...item, name: item?.name ?? name }));
  }
  throw new UserError(`${source}: "instances" must be an array or an object keyed by instance name.`);
}

/**
 * Reads instances from the environment. Two styles are supported:
 *  - Single instance: JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, ... (name from JIRA_INSTANCE_NAME or "default")
 *  - Many instances:  JIRA_INSTANCES=work,client then JIRA_WORK_BASE_URL, JIRA_CLIENT_API_TOKEN, ...
 *    or JIRA_INSTANCES='[{"name":"work","url":"..."}]' (JSON)
 */
export function instancesFromEnv(env: NodeJS.ProcessEnv, forceSingle: Set<string> = new Set()): InstanceInput[] {
  const out: InstanceInput[] = [];
  const list = env.JIRA_INSTANCES?.trim();
  if (list) {
    if (list.startsWith("[") || list.startsWith("{")) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(list);
      } catch (e) {
        throw new UserError(`JIRA_INSTANCES is not valid JSON: ${(e as Error).message}`);
      }
      out.push(...instancesFromObject(parsed as InstanceInput[], "JIRA_INSTANCES"));
    } else {
      for (const name of list.split(/[\s,;]+/).filter(Boolean)) {
        out.push({ ...readEnvFields(env, `JIRA_${envKeyFor(name)}_`), name });
      }
    }
  }

  const singleName = env.JIRA_INSTANCE_NAME?.trim() || DEFAULT_INSTANCE_NAME;
  const single = readEnvFields(env, "JIRA_");
  if (single.url || (forceSingle.has(singleName) && hasAnyField(single))) {
    out.push({ ...single, name: singleName });
  }
  return out;
}

export function readConfigFile(file: string): ConfigFile {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    throw new UserError(`Cannot read config file ${file}: ${(e as Error).message}`);
  }
  try {
    const data = JSON.parse(text) as unknown;
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("top-level value must be an object");
    }
    return data as ConfigFile;
  } catch (e) {
    throw new UserError(`Invalid JSON in config file ${file}: ${(e as Error).message}`);
  }
}

function mergeByName(sources: InstanceInput[][]): InstanceInput[] {
  const merged = new Map<string, InstanceInput>();
  for (const list of sources) {
    for (const item of list) {
      const key = normalizeInstanceName(item.name ?? "");
      merged.set(key, mergeInstanceInput(merged.get(key) ?? {}, { ...item, name: key }));
    }
  }
  return [...merged.values()];
}

function firstDefined<T>(...values: (T | undefined)[]): T | undefined {
  return values.find((v) => v !== undefined);
}

/**
 * Builds the effective configuration. Precedence (highest first):
 * CLI flags > environment variables > config file > defaults.
 * Instances with the same name are merged field by field across sources.
 */
export function loadConfig(cli: CliOptions, env: NodeJS.ProcessEnv = process.env): AppConfig {
  const homeDir = path.resolve(
    expandHome(cli.homeDir ?? env.JIRA_MCP_HOME ?? path.join(os.homedir(), ".multiinstance-jira-mcp")),
  );

  const explicitFile = cli.configFile ?? env.JIRA_MCP_CONFIG;
  let configFile: string | undefined;
  if (explicitFile) {
    configFile = path.resolve(expandHome(explicitFile));
  } else if (fs.existsSync(path.join(homeDir, "config.json"))) {
    configFile = path.join(homeDir, "config.json");
  }
  const file: ConfigFile = configFile ? readConfigFile(configFile) : {};
  if (configFile) log.debug(`Using config file ${configFile}`);

  const cliNames = new Set(cli.instances.map((i) => normalizeInstanceName(i.name ?? "")));
  const inputs = mergeByName([
    instancesFromObject(file.instances, configFile ?? "config file"),
    instancesFromEnv(env, cliNames),
    cli.instances,
  ]);
  const instances = inputs.map((input) => toInstanceConfig(input, env));

  const globalReadOnly = firstDefined(cli.readOnly, parseBoolean(env.JIRA_READ_ONLY), file.readOnly) ?? false;
  if (globalReadOnly) for (const inst of instances) inst.readOnly = true;

  const defaultRaw = firstDefined(cli.defaultInstance, env.JIRA_DEFAULT_INSTANCE || undefined, file.defaultInstance);
  const defaultInstance = defaultRaw ? normalizeInstanceName(defaultRaw) : undefined;
  if (defaultInstance && !instances.some((i) => i.name === defaultInstance)) {
    throw new UserError(
      `Default instance "${defaultInstance}" is not configured. Known instances: ${
        instances.map((i) => i.name).join(", ") || "(none)"
      }.`,
    );
  }

  return {
    instances,
    defaultInstance,
    homeDir,
    readOnly: globalReadOnly,
    loginTimeoutSeconds: Math.max(
      30,
      firstDefined(cli.loginTimeoutSeconds, parseInteger(env.JIRA_LOGIN_TIMEOUT_SECONDS), file.loginTimeoutSeconds) ??
        DEFAULTS.loginTimeoutSeconds,
    ),
    browserChannel: firstDefined(cli.browserChannel, env.JIRA_BROWSER_CHANNEL || undefined, file.browserChannel),
    keepAliveSeconds: Math.max(
      0,
      firstDefined(cli.keepAliveSeconds, parseInteger(env.JIRA_KEEPALIVE_SECONDS), file.keepAliveSeconds) ??
        DEFAULTS.keepAliveSeconds,
    ),
    maxAttachmentBytes:
      firstDefined(parseInteger(env.JIRA_MAX_ATTACHMENT_BYTES), file.maxAttachmentBytes) ??
      DEFAULTS.maxAttachmentBytes,
    configFile,
  };
}

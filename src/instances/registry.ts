import { CookieStore } from "../auth/cookie-store.js";
import { createAuthProvider, type AuthProvider } from "../auth/providers.js";
import { normalizeInstanceName } from "../config/normalize.js";
import type { AppConfig, InstanceConfig } from "../config/types.js";
import { UserError } from "../errors.js";
import { JiraClient, type FetchLike } from "../jira/client.js";
import { cookieFile } from "../paths.js";

export class JiraInstance {
  readonly auth: AuthProvider;
  readonly client: JiraClient;
  readonly cookies: CookieStore;

  constructor(
    readonly config: InstanceConfig,
    homeDir: string,
    fetchImpl?: FetchLike,
  ) {
    this.cookies = new CookieStore(cookieFile(homeDir, config.name));
    this.auth = createAuthProvider(config, this.cookies);
    this.client = new JiraClient(config, this.auth, fetchImpl);
  }

  get name(): string {
    return this.config.name;
  }

  /** Static description (no network). Never includes secrets. */
  describe() {
    const session = this.config.auth === "browser" ? this.cookies.info() : undefined;
    return {
      name: this.name,
      url: this.config.baseUrl,
      deployment: this.config.deployment,
      apiVersion: this.config.apiVersion,
      auth: this.auth.describe(),
      credentials: this.auth.hasCredentials() ? "present" : "missing — run jira_login",
      ...(session ? { session: { user: session.user, savedAt: session.savedAt } } : {}),
      ...(this.config.projectKeys.length ? { projects: this.config.projectKeys } : {}),
      ...(this.config.defaultProject ? { defaultProject: this.config.defaultProject } : {}),
      ...(this.config.description ? { description: this.config.description } : {}),
      readOnly: this.config.readOnly,
    };
  }
}

export interface IssueRef {
  key: string;
  instance?: string;
  host?: string;
  path?: string;
}

const ISSUE_KEY = /^[A-Z][A-Z0-9_]*-\d+$/;

/**
 * Accepts "ABC-123", "work:ABC-123" (instance prefix) or a browse URL such as
 * "https://acme.atlassian.net/browse/ABC-123".
 */
export function parseIssueRef(input: string): IssueRef {
  const raw = input.trim();
  if (/^https?:\/\//i.test(raw)) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new UserError(`Invalid issue URL "${raw}".`);
    }
    const fromQuery = url.searchParams.get("selectedIssue");
    const match = /\/browse\/([A-Za-z][A-Za-z0-9_]*-\d+)/.exec(url.pathname);
    const key = (match?.[1] ?? fromQuery ?? "").toUpperCase();
    if (!ISSUE_KEY.test(key)) throw new UserError(`Could not find an issue key in "${raw}".`);
    const contextPath = url.pathname.slice(0, match ? url.pathname.indexOf("/browse/") : 0);
    return { key, host: url.host.toLowerCase(), path: contextPath };
  }
  const colon = raw.indexOf(":");
  if (colon > 0) {
    return { instance: normalizeInstanceName(raw.slice(0, colon)), key: raw.slice(colon + 1).trim().toUpperCase() };
  }
  return { key: raw.toUpperCase() };
}

export function projectKeyOf(issueKey: string): string | undefined {
  const match = /^([A-Z][A-Z0-9_]*)-\d+$/.exec(issueKey.toUpperCase());
  return match?.[1];
}

export interface ResolveHint {
  instance?: string;
  issue?: string;
  projectKey?: string;
}

export interface Resolved {
  instance: JiraInstance;
  issueKey?: string;
  reason: string;
}

export class InstanceRegistry {
  private readonly instances = new Map<string, JiraInstance>();
  private defaultName?: string;

  constructor(
    private readonly app: AppConfig,
    private readonly fetchImpl?: FetchLike,
  ) {
    for (const config of app.instances) this.add(config);
    this.defaultName = app.defaultInstance;
  }

  get homeDir(): string {
    return this.app.homeDir;
  }

  get defaultInstance(): string | undefined {
    return this.defaultName;
  }

  setDefault(name: string | undefined): void {
    if (name !== undefined) this.get(name);
    this.defaultName = name === undefined ? undefined : normalizeInstanceName(name);
  }

  add(config: InstanceConfig, options: { replace?: boolean } = {}): JiraInstance {
    if (this.instances.has(config.name) && !options.replace) {
      throw new UserError(`Instance "${config.name}" already exists. Pass replace=true to overwrite it.`);
    }
    if (this.app.readOnly) config.readOnly = true;
    const instance = new JiraInstance(config, this.app.homeDir, this.fetchImpl);
    this.instances.set(config.name, instance);
    return instance;
  }

  remove(name: string): JiraInstance {
    const instance = this.get(name);
    this.instances.delete(instance.name);
    if (this.defaultName === instance.name) this.defaultName = undefined;
    return instance;
  }

  list(): JiraInstance[] {
    return [...this.instances.values()];
  }

  names(): string[] {
    return [...this.instances.keys()];
  }

  get(name: string): JiraInstance {
    const instance = this.instances.get(normalizeInstanceName(name));
    if (!instance) {
      throw new UserError(
        `Unknown Jira instance "${name}". Configured instances: ${this.names().join(", ") || "(none)"}.`,
      );
    }
    return instance;
  }

  /**
   * Picks the instance for a call. Order: explicit `instance` → "name:KEY" prefix →
   * issue URL host → project-key mapping → default instance → the only instance.
   */
  resolve(hint: ResolveHint = {}): Resolved {
    if (this.instances.size === 0) {
      throw new UserError(
        "No Jira instances are configured. Add one with the jira_add_instance tool, CLI flags (--instance/--url/--token), environment variables or a config file.",
      );
    }

    const ref = hint.issue ? parseIssueRef(hint.issue) : undefined;
    const issueKey = ref?.key;

    if (hint.instance) {
      const instance = this.get(hint.instance);
      if (ref?.instance && ref.instance !== instance.name) {
        throw new UserError(
          `Conflicting instances: argument says "${instance.name}" but issue reference says "${ref.instance}".`,
        );
      }
      return { instance, issueKey, reason: "explicit instance argument" };
    }

    if (ref?.instance) return { instance: this.get(ref.instance), issueKey, reason: "instance prefix in issue key" };

    if (ref?.host) {
      const match = this.list().find((i) => {
        const base = new URL(i.config.baseUrl);
        return base.host.toLowerCase() === ref.host && (ref.path ?? "").startsWith(base.pathname.replace(/\/$/, ""));
      });
      if (!match) {
        throw new UserError(
          `No configured instance matches host ${ref.host}. Configured: ${this.list()
            .map((i) => `${i.name} (${i.config.baseUrl})`)
            .join(", ")}.`,
        );
      }
      return { instance: match, issueKey, reason: "issue URL host" };
    }

    const projectKey = (hint.projectKey ?? (issueKey ? projectKeyOf(issueKey) : undefined))?.toUpperCase();
    if (projectKey) {
      const owners = this.list().filter((i) => i.config.projectKeys.includes(projectKey));
      if (owners.length === 1) return { instance: owners[0]!, issueKey, reason: `project ${projectKey} mapping` };
      if (owners.length > 1) {
        const preferred = owners.find((o) => o.name === this.defaultName);
        if (preferred) return { instance: preferred, issueKey, reason: `project ${projectKey} mapping (default)` };
        throw new UserError(
          `Project ${projectKey} is mapped to several instances (${owners
            .map((o) => o.name)
            .join(", ")}). Pass "instance" explicitly.`,
        );
      }
    }

    if (this.defaultName) return { instance: this.get(this.defaultName), issueKey, reason: "default instance" };
    if (this.instances.size === 1) return { instance: this.list()[0]!, issueKey, reason: "only instance" };

    throw new UserError(
      `Several Jira instances are configured (${this.names().join(", ")}) and this call could not be routed automatically. ` +
        `Pass "instance", prefix the issue key ("${this.names()[0]}:ABC-123"), use a full issue URL, ` +
        `or configure project keys / a default instance.`,
    );
  }

  /** Resolves a list of instances for fan-out operations. */
  select(options: { instance?: string; instances?: string[]; all?: boolean }): JiraInstance[] {
    if (options.all) {
      if (this.instances.size === 0) this.resolve();
      return this.list();
    }
    if (options.instances?.length) return [...new Set(options.instances)].map((n) => this.get(n));
    return [this.resolve({ instance: options.instance }).instance];
  }
}

import type { AuthProvider } from "../auth/providers.js";
import type { InstanceConfig } from "../config/types.js";
import { describeJiraErrorBody, JiraHttpError, UserError } from "../errors.js";
import { log } from "../logger.js";
import { adfToText, markdownToAdf } from "./adf.js";

export type Query = Record<string, string | number | boolean | undefined | null>;

export interface RequestOptions {
  query?: Query;
  body?: unknown;
  form?: FormData;
  headers?: Record<string, string>;
}

export interface JiraUser {
  accountId?: string;
  name?: string;
  key?: string;
  displayName?: string;
  emailAddress?: string;
  active?: boolean;
  timeZone?: string;
}

export interface JiraIssue {
  id: string;
  key: string;
  self?: string;
  fields?: Record<string, any>;
  renderedFields?: Record<string, any>;
  names?: Record<string, string>;
}

export interface SearchParams {
  jql: string;
  maxResults: number;
  fields?: string[];
  nextPageToken?: string;
  startAt?: number;
}

export interface SearchPage {
  issues: JiraIssue[];
  total?: number;
  startAt?: number;
  nextPageToken?: string;
  isLast: boolean;
}

export type FetchLike = (input: URL, init: RequestInit) => Promise<Response>;

/** REST client bound to a single Jira instance. */
export class JiraClient {
  constructor(
    readonly config: InstanceConfig,
    private readonly auth: AuthProvider,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
  ) {}

  get name(): string {
    return this.config.name;
  }

  get isCloud(): boolean {
    return this.config.deployment === "cloud";
  }

  api(path: string): string {
    return `/rest/api/${this.config.apiVersion}${path}`;
  }

  agile(path: string): string {
    return `/rest/agile/1.0${path}`;
  }

  browseUrl(issueKey: string): string {
    return `${this.config.baseUrl}/browse/${issueKey}`;
  }

  async request<T = unknown>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const url = new URL(this.config.baseUrl + path);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    }

    const headers = new Headers({ Accept: "application/json", "X-Atlassian-Token": "no-check" });
    for (const [k, v] of Object.entries(options.headers ?? {})) headers.set(k, v);

    let body: RequestInit["body"];
    if (options.form) {
      body = options.form;
    } else if (options.body !== undefined) {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(options.body);
    }

    this.auth.apply(url, headers);

    log.debug(`[${this.name}] ${method} ${url.pathname}${url.search}`);
    let response: Response;
    try {
      response = await this.fetchImpl(url, { method, headers, body, redirect: "manual" });
    } catch (e) {
      const cause = (e as { cause?: { message?: string } }).cause?.message;
      throw new UserError(
        `[${this.name}] Could not reach ${url.origin}: ${(e as Error).message}${cause ? ` (${cause})` : ""}`,
      );
    }
    this.auth.afterResponse?.(url, response);

    const text = await response.text();
    const shortUrl = `${url.pathname}${url.search}`;

    if (response.status >= 300 && response.status < 400) {
      throw new JiraHttpError(
        this.name,
        401,
        method,
        shortUrl,
        `redirected to ${response.headers.get("location") ?? "a login page"}`,
        this.auth.unauthorizedHint(this.name),
      );
    }
    if (!response.ok) {
      throw new JiraHttpError(
        this.name,
        response.status,
        method,
        shortUrl,
        describeJiraErrorBody(text),
        this.hintFor(response.status),
      );
    }
    if (!text.trim()) return undefined as T;

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("json") && text.trimStart().startsWith("<")) {
      throw new JiraHttpError(
        this.name,
        401,
        method,
        shortUrl,
        "received an HTML page instead of JSON (usually a login page)",
        this.auth.unauthorizedHint(this.name),
      );
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as T;
    }
  }

  private hintFor(status: number): string | undefined {
    switch (status) {
      case 401:
        return this.auth.unauthorizedHint(this.name);
      case 403:
        return "Authenticated, but this account lacks permission for the operation (or the API token is not allowed on this site).";
      case 404:
        return "Not found — the issue/project may not exist on this instance, or you lack permission to see it. Check that you targeted the right instance.";
      case 410:
        return "This endpoint has been removed on this Jira site.";
      case 429:
        return "Rate limited by Jira; retry later.";
      default:
        return undefined;
    }
  }

  // ---------------------------------------------------------------- text fields

  /** Converts user text into the representation the configured REST version expects. */
  toRichText(text: string): unknown {
    return this.config.apiVersion === 3 ? markdownToAdf(text) : text;
  }

  fromRichText(value: unknown): string {
    return adfToText(value);
  }

  // ---------------------------------------------------------------- users

  myself(): Promise<JiraUser> {
    return this.request<JiraUser>("GET", this.api("/myself"));
  }

  async findUsers(query: string, maxResults = 20): Promise<JiraUser[]> {
    const q = this.isCloud ? { query, maxResults } : { username: query, maxResults };
    const users = await this.request<JiraUser[]>("GET", this.api("/user/search"), { query: q });
    return Array.isArray(users) ? users : [];
  }

  async assignableUsers(projectKey: string, query?: string, maxResults = 50): Promise<JiraUser[]> {
    const q: Query = { project: projectKey, maxResults };
    if (query) q[this.isCloud ? "query" : "username"] = query;
    const users = await this.request<JiraUser[]>("GET", this.api("/user/assignable/search"), { query: q });
    return Array.isArray(users) ? users : [];
  }

  /** Builds the user reference Jira expects in assignee/reporter fields. */
  userRef(user: JiraUser | null): Record<string, string | null> {
    if (this.isCloud) return { accountId: user?.accountId ?? null };
    return { name: user?.name ?? user?.key ?? null };
  }

  /**
   * Resolves "me", an email, a Cloud accountId or a Data Center username to a user.
   */
  async resolveUser(identifier: string): Promise<JiraUser> {
    const id = identifier.trim();
    if (id.toLowerCase() === "me" || id.toLowerCase() === "currentuser()") return this.myself();
    if (id.includes("@") || id.includes(" ")) {
      const matches = await this.findUsers(id, 10);
      const lower = id.toLowerCase();
      const exact = matches.find(
        (u) => u.emailAddress?.toLowerCase() === lower || u.displayName?.toLowerCase() === lower,
      );
      const user = exact ?? (matches.length === 1 ? matches[0] : undefined);
      if (!user) {
        const options = matches.map((u) => `${u.displayName} <${u.emailAddress ?? u.accountId ?? u.name}>`);
        throw new UserError(
          `[${this.name}] Could not uniquely resolve user "${id}". ${
            options.length ? `Candidates: ${options.join(", ")}` : "No users matched."
          }`,
        );
      }
      return user;
    }
    return this.isCloud ? { accountId: id } : { name: id };
  }

  // ---------------------------------------------------------------- search

  async search(params: SearchParams): Promise<SearchPage> {
    const maxResults = Math.min(Math.max(1, params.maxResults), 100);
    const enhanced = async (): Promise<SearchPage> => {
      const data = await this.request<{ issues?: JiraIssue[]; nextPageToken?: string; isLast?: boolean }>(
        "POST",
        this.api("/search/jql"),
        { body: { jql: params.jql, maxResults, fields: params.fields, nextPageToken: params.nextPageToken } },
      );
      return {
        issues: data?.issues ?? [],
        nextPageToken: data?.nextPageToken,
        isLast: data?.isLast ?? !data?.nextPageToken,
      };
    };
    const classic = async (): Promise<SearchPage> => {
      const startAt = Math.max(0, params.startAt ?? 0);
      const data = await this.request<{ issues?: JiraIssue[]; total?: number; startAt?: number }>(
        "POST",
        this.api("/search"),
        { body: { jql: params.jql, startAt, maxResults, fields: params.fields } },
      );
      const issues = data?.issues ?? [];
      const total = data?.total ?? issues.length;
      return { issues, total, startAt, isLast: startAt + issues.length >= total };
    };

    // Cloud removed the classic /search endpoint in favour of /search/jql; Data Center only has /search.
    const [first, second] = this.isCloud ? [enhanced, classic] : [classic, enhanced];
    try {
      return await first();
    } catch (e) {
      if (e instanceof JiraHttpError && (e.status === 404 || e.status === 410)) return second();
      throw e;
    }
  }

  // ---------------------------------------------------------------- issues

  getIssue(issueKey: string, options: { fields?: string[]; expand?: string[] } = {}): Promise<JiraIssue> {
    return this.request<JiraIssue>("GET", this.api(`/issue/${encodeURIComponent(issueKey)}`), {
      query: { fields: options.fields?.join(","), expand: options.expand?.join(",") },
    });
  }

  createIssue(fields: Record<string, unknown>): Promise<{ id: string; key: string; self: string }> {
    return this.request("POST", this.api("/issue"), { body: { fields } });
  }

  async updateIssue(issueKey: string, fields: Record<string, unknown>): Promise<void> {
    await this.request("PUT", this.api(`/issue/${encodeURIComponent(issueKey)}`), { body: { fields } });
  }

  async deleteIssue(issueKey: string, deleteSubtasks = false): Promise<void> {
    await this.request("DELETE", this.api(`/issue/${encodeURIComponent(issueKey)}`), {
      query: { deleteSubtasks: deleteSubtasks ? "true" : undefined },
    });
  }

  async assignIssue(issueKey: string, user: JiraUser | null): Promise<void> {
    await this.request("PUT", this.api(`/issue/${encodeURIComponent(issueKey)}/assignee`), {
      body: this.userRef(user),
    });
  }

  async getComments(issueKey: string, maxResults = 20): Promise<{ total?: number; comments: any[] }> {
    const data = await this.request<{ total?: number; comments?: any[] }>(
      "GET",
      this.api(`/issue/${encodeURIComponent(issueKey)}/comment`),
      { query: { maxResults, orderBy: "-created" } },
    );
    return { total: data?.total, comments: data?.comments ?? [] };
  }

  addComment(issueKey: string, text: string): Promise<{ id: string; self?: string }> {
    return this.request("POST", this.api(`/issue/${encodeURIComponent(issueKey)}/comment`), {
      body: { body: this.toRichText(text) },
    });
  }

  async getTransitions(issueKey: string): Promise<any[]> {
    const data = await this.request<{ transitions?: any[] }>(
      "GET",
      this.api(`/issue/${encodeURIComponent(issueKey)}/transitions`),
    );
    return data?.transitions ?? [];
  }

  async transitionIssue(issueKey: string, transitionId: string, comment?: string): Promise<void> {
    const body: Record<string, unknown> = { transition: { id: transitionId } };
    if (comment) body.update = { comment: [{ add: { body: this.toRichText(comment) } }] };
    await this.request("POST", this.api(`/issue/${encodeURIComponent(issueKey)}/transitions`), { body });
  }

  async addAttachment(issueKey: string, filename: string, data: Uint8Array, contentType: string): Promise<any[]> {
    const form = new FormData();
    form.append("file", new Blob([data], { type: contentType || "application/octet-stream" }), filename);
    const result = await this.request<any[]>(
      "POST",
      this.api(`/issue/${encodeURIComponent(issueKey)}/attachments`),
      { form },
    );
    return Array.isArray(result) ? result : [];
  }

  // ---------------------------------------------------------------- metadata

  async listProjects(query?: string, maxResults = 50): Promise<any[]> {
    const limit = Math.min(Math.max(1, maxResults), 100);
    if (this.isCloud) {
      const data = await this.request<{ values?: any[] }>("GET", this.api("/project/search"), {
        query: { query, maxResults: limit, orderBy: "name" },
      });
      return data?.values ?? [];
    }
    const all = await this.request<any[]>("GET", this.api("/project"));
    const needle = query?.toLowerCase();
    const filtered = (Array.isArray(all) ? all : []).filter(
      (p) => !needle || `${p.key} ${p.name}`.toLowerCase().includes(needle),
    );
    return filtered.slice(0, limit);
  }

  getProject(projectKey: string): Promise<any> {
    return this.request("GET", this.api(`/project/${encodeURIComponent(projectKey)}`));
  }

  async listIssueTypes(projectKey?: string): Promise<any[]> {
    if (projectKey) {
      const project = await this.getProject(projectKey);
      return project?.issueTypes ?? [];
    }
    const types = await this.request<any[]>("GET", this.api("/issuetype"));
    return Array.isArray(types) ? types : [];
  }

  async listStatuses(projectKey?: string): Promise<any[]> {
    if (projectKey) {
      const byType = await this.request<any[]>(
        "GET",
        this.api(`/project/${encodeURIComponent(projectKey)}/statuses`),
      );
      return Array.isArray(byType) ? byType : [];
    }
    const statuses = await this.request<any[]>("GET", this.api("/status"));
    return Array.isArray(statuses) ? statuses : [];
  }

  async listBoards(options: { projectKey?: string; name?: string; maxResults?: number } = {}): Promise<any[]> {
    const data = await this.request<{ values?: any[] }>("GET", this.agile("/board"), {
      query: {
        projectKeyOrId: options.projectKey,
        name: options.name,
        maxResults: Math.min(Math.max(1, options.maxResults ?? 50), 100),
      },
    });
    return data?.values ?? [];
  }

  getBoard(boardId: string | number): Promise<any> {
    return this.request("GET", this.agile(`/board/${encodeURIComponent(String(boardId))}`));
  }

  async listSprints(boardId: string | number, state?: string, maxResults = 50): Promise<any[]> {
    const data = await this.request<{ values?: any[] }>(
      "GET",
      this.agile(`/board/${encodeURIComponent(String(boardId))}/sprint`),
      { query: { state, maxResults: Math.min(Math.max(1, maxResults), 100) } },
    );
    return data?.values ?? [];
  }
}

import type { JiraClient, JiraIssue, JiraUser } from "./client.js";

/** Drops undefined / null / empty-array / empty-string values to keep tool output compact. */
export function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  return out as Partial<T>;
}

export function userLabel(user: JiraUser | null | undefined): string | undefined {
  if (!user) return undefined;
  const id = user.emailAddress ?? user.accountId ?? user.name;
  return user.displayName ? (id ? `${user.displayName} <${id}>` : user.displayName) : id;
}

export function compactUser(user: JiraUser) {
  return compact({
    displayName: user.displayName,
    accountId: user.accountId,
    username: user.name,
    email: user.emailAddress,
    active: user.active,
  });
}

export const SUMMARY_FIELDS = [
  "summary",
  "status",
  "issuetype",
  "priority",
  "assignee",
  "reporter",
  "labels",
  "parent",
  "created",
  "updated",
  "duedate",
  "project",
];

export const DETAIL_FIELDS = [
  ...SUMMARY_FIELDS,
  "description",
  "components",
  "fixVersions",
  "resolution",
  "subtasks",
  "issuelinks",
  "comment",
];

const names = (items: unknown): string[] | undefined =>
  Array.isArray(items) ? items.map((i) => (i as { name?: string }).name ?? "").filter(Boolean) : undefined;

/** A compact, model-friendly view of an issue. */
export function compactIssue(issue: JiraIssue, client: JiraClient, options: { detail?: boolean } = {}) {
  const f = issue.fields ?? {};
  const base = {
    instance: client.name,
    key: issue.key,
    url: client.browseUrl(issue.key),
    summary: f.summary,
    status: f.status?.name,
    issueType: f.issuetype?.name,
    priority: f.priority?.name,
    assignee: userLabel(f.assignee) ?? (f.assignee === null ? "Unassigned" : undefined),
    reporter: userLabel(f.reporter),
    project: f.project?.key,
    labels: f.labels,
    parent: f.parent ? `${f.parent.key} ${f.parent.fields?.summary ?? ""}`.trim() : undefined,
    created: f.created,
    updated: f.updated,
    dueDate: f.duedate,
  };
  if (!options.detail) return compact(base);

  const links = Array.isArray(f.issuelinks)
    ? f.issuelinks.map((l: any) => {
        const other = l.outwardIssue ?? l.inwardIssue;
        const relation = l.outwardIssue ? l.type?.outward : l.type?.inward;
        return `${relation ?? l.type?.name ?? "relates to"} ${other?.key ?? "?"}${
          other?.fields?.summary ? ` (${other.fields.summary})` : ""
        }`;
      })
    : undefined;
  const comments = f.comment?.comments as any[] | undefined;

  return compact({
    ...base,
    resolution: f.resolution?.name,
    components: names(f.components),
    fixVersions: names(f.fixVersions),
    subtasks: Array.isArray(f.subtasks)
      ? f.subtasks.map((s: any) => `${s.key} [${s.fields?.status?.name ?? "?"}] ${s.fields?.summary ?? ""}`.trim())
      : undefined,
    links,
    description: client.fromRichText(f.description),
    commentCount: f.comment?.total ?? comments?.length,
    latestComments: comments?.slice(-3).map((c) => compactComment(c, client)),
  });
}

export function compactComment(comment: any, client: JiraClient) {
  return compact({
    id: comment.id,
    author: userLabel(comment.author),
    created: comment.created,
    updated: comment.updated !== comment.created ? comment.updated : undefined,
    body: client.fromRichText(comment.body),
  });
}

export function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

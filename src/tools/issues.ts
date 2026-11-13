import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { UserError } from "../errors.js";
import { projectKeyOf, type JiraInstance } from "../instances/registry.js";
import { compact, compactIssue, DETAIL_FIELDS, SUMMARY_FIELDS } from "../jira/format.js";
import {
  defineTool,
  DESTRUCTIVE,
  ensureWritable,
  fanOut,
  fanOutArgs,
  instanceArg,
  issueArg,
  READ_ONLY,
  WRITE,
  type ToolContext,
} from "./shared.js";

const customFieldsArg = z
  .record(z.string(), z.unknown())
  .optional()
  .describe("Extra raw Jira fields, e.g. {\"customfield_10016\": 5}. Values are sent as-is.");

async function searchOne(
  instance: JiraInstance,
  args: { jql: string; maxResults?: number; fields?: string[]; nextPageToken?: string; startAt?: number },
) {
  const requested = args.fields?.length ? [...new Set([...SUMMARY_FIELDS, ...args.fields])] : SUMMARY_FIELDS;
  const page = await instance.client.search({
    jql: args.jql,
    maxResults: args.maxResults ?? 20,
    fields: requested,
    nextPageToken: args.nextPageToken,
    startAt: args.startAt,
  });
  const extra = (args.fields ?? []).filter((f) => !SUMMARY_FIELDS.includes(f));
  return compact({
    total: page.total,
    isLast: page.isLast,
    nextPageToken: page.nextPageToken,
    startAt: page.startAt,
    issues: page.issues.map((issue) => {
      const base = compactIssue(issue, instance.client);
      if (extra.length === 0) return base;
      const values = Object.fromEntries(extra.map((f) => [f, issue.fields?.[f] ?? null]));
      return { ...base, fields: values };
    }),
  });
}

async function resolveProjectForCreate(
  instance: JiraInstance,
  args: { project?: string; boardId?: number; parentKey?: string },
): Promise<string> {
  if (args.project) return args.project.toUpperCase();
  if (args.parentKey) {
    const fromParent = projectKeyOf(args.parentKey);
    if (fromParent) return fromParent;
  }
  if (args.boardId !== undefined) {
    const board = await instance.client.getBoard(args.boardId);
    const key = board?.location?.projectKey;
    if (key) return key;
    throw new UserError(`[${instance.name}] Board ${args.boardId} is not tied to a single project; pass "project".`);
  }
  if (instance.config.defaultProject) return instance.config.defaultProject;
  if (instance.config.projectKeys.length === 1) return instance.config.projectKeys[0]!;
  throw new UserError(
    `[${instance.name}] No project given. Pass "project" (see jira_list_projects), "boardId", or configure defaultProject for this instance.`,
  );
}

export function registerIssueTools(server: McpServer, ctx: ToolContext): void {
  const { registry } = ctx;

  defineTool(server, "jira_search", {
    title: "Search issues with JQL",
    description:
      "Run a JQL query. Target one instance, a list of instances or all of them at once (allInstances=true) — results are grouped per instance and a failure on one instance does not hide the others.",
    input: {
      jql: z.string().min(1).describe("JQL, e.g. 'assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC'"),
      maxResults: z.number().int().min(1).max(100).optional().describe("Per instance (default 20)."),
      fields: z.array(z.string()).optional().describe("Additional fields to return (e.g. customfield_10016)."),
      nextPageToken: z.string().optional().describe("Cloud pagination token from a previous page."),
      startAt: z.number().int().min(0).optional().describe("Data Center pagination offset."),
      instance: instanceArg,
      ...fanOutArgs,
    },
    annotations: READ_ONLY,
    run: async (args) => {
      const targets = registry.select({ instance: args.instance, instances: args.instances, all: args.allInstances });
      if (targets.length === 1 && !args.allInstances && !args.instances) {
        return { instance: targets[0]!.name, ...(await searchOne(targets[0]!, args)) };
      }
      const results = await fanOut(targets, (i) => searchOne(i, { ...args, nextPageToken: undefined, startAt: undefined }));
      return results.map((r) => (r.ok ? { instance: r.instance, ...r.result } : r));
    },
  });

  defineTool(server, "jira_get_issue", {
    title: "Get issue",
    description:
      "Read an issue: summary, status, people, description as text, subtasks, links and latest comments. Set raw=true for the full Jira JSON.",
    input: {
      issue: issueArg,
      instance: instanceArg,
      raw: z.boolean().optional().describe("Return the unprocessed Jira JSON (large)."),
      fields: z.array(z.string()).optional().describe("With raw=true, limit to these fields."),
    },
    annotations: READ_ONLY,
    run: async ({ issue, instance, raw, fields }) => {
      const { instance: target, issueKey } = registry.resolve({ instance, issue });
      if (raw) {
        return target.client.getIssue(issueKey!, { fields: fields ?? ["*all"], expand: ["names"] });
      }
      const data = await target.client.getIssue(issueKey!, { fields: DETAIL_FIELDS });
      return compactIssue(data, target.client, { detail: true });
    },
  });

  defineTool(server, "jira_create_issue", {
    title: "Create issue",
    description:
      "Create an issue. The description accepts light Markdown (headings, lists, **bold**, `code`, links, code fences) and is converted to the format the instance expects. The instance is routed by project key mapping or the 'instance' argument.",
    input: {
      summary: z.string().min(1),
      description: z.string().optional(),
      project: z.string().optional().describe("Project key. Defaults to the parent's project, the board's project or the instance defaultProject."),
      issueType: z.string().optional().describe("Issue type name (default 'Task'). Use 'Sub-task' with parent."),
      parent: z.string().optional().describe("Parent issue key (sub-tasks, or epics on team-managed projects)."),
      boardId: z.number().int().optional().describe("Use the project of this agile board."),
      labels: z.array(z.string()).optional(),
      priority: z.string().optional().describe("Priority name, e.g. 'High'."),
      assignee: z.string().optional().describe("'me', email, accountId (Cloud) or username (Data Center)."),
      components: z.array(z.string()).optional().describe("Component names."),
      dueDate: z.string().optional().describe("YYYY-MM-DD"),
      customFields: customFieldsArg,
      instance: instanceArg,
    },
    annotations: WRITE,
    run: async (args) => {
      const resolved = registry.resolve({
        instance: args.instance,
        issue: args.parent,
        projectKey: args.project,
      });
      const target = resolved.instance;
      ensureWritable(target);
      const parentKey = args.parent ? resolved.issueKey : undefined;
      const project = await resolveProjectForCreate(target, { project: args.project, boardId: args.boardId, parentKey });

      const fields: Record<string, unknown> = {
        project: { key: project },
        summary: args.summary,
        issuetype: { name: args.issueType ?? "Task" },
      };
      if (args.description) fields.description = target.client.toRichText(args.description);
      if (parentKey) fields.parent = { key: parentKey };
      if (args.labels) fields.labels = args.labels;
      if (args.priority) fields.priority = { name: args.priority };
      if (args.components) fields.components = args.components.map((name) => ({ name }));
      if (args.dueDate) fields.duedate = args.dueDate;
      if (args.assignee) fields.assignee = target.client.userRef(await target.client.resolveUser(args.assignee));
      Object.assign(fields, args.customFields ?? {});

      const created = await target.client.createIssue(fields);
      return { instance: target.name, key: created.key, id: created.id, url: target.client.browseUrl(created.key) };
    },
  });

  defineTool(server, "jira_update_issue", {
    title: "Update issue",
    description: "Update fields of an issue. Only the provided fields change. Use jira_transition_issue to change status and jira_assign_issue to change assignee.",
    input: {
      issue: issueArg,
      instance: instanceArg,
      summary: z.string().optional(),
      description: z.string().optional().describe("Replaces the description (light Markdown supported)."),
      labels: z.array(z.string()).optional().describe("Replaces all labels."),
      priority: z.string().optional(),
      parent: z.string().optional(),
      components: z.array(z.string()).optional(),
      dueDate: z.string().optional().describe("YYYY-MM-DD, or empty string to clear."),
      customFields: customFieldsArg,
    },
    annotations: { ...WRITE, idempotentHint: true },
    run: async (args) => {
      const { instance: target, issueKey } = registry.resolve({ instance: args.instance, issue: args.issue });
      ensureWritable(target);
      const fields: Record<string, unknown> = {};
      if (args.summary !== undefined) fields.summary = args.summary;
      if (args.description !== undefined) fields.description = target.client.toRichText(args.description);
      if (args.labels !== undefined) fields.labels = args.labels;
      if (args.priority !== undefined) fields.priority = { name: args.priority };
      if (args.parent !== undefined) fields.parent = { key: args.parent.toUpperCase() };
      if (args.components !== undefined) fields.components = args.components.map((name) => ({ name }));
      if (args.dueDate !== undefined) fields.duedate = args.dueDate || null;
      Object.assign(fields, args.customFields ?? {});
      if (Object.keys(fields).length === 0) throw new UserError("Nothing to update: provide at least one field.");
      await target.client.updateIssue(issueKey!, fields);
      return { instance: target.name, key: issueKey, updated: Object.keys(fields), url: target.client.browseUrl(issueKey!) };
    },
  });

  defineTool(server, "jira_delete_issue", {
    title: "Delete issue",
    description: "Permanently delete an issue. Requires delete permission. Ask the user for confirmation first.",
    input: {
      issue: issueArg,
      instance: instanceArg,
      deleteSubtasks: z.boolean().optional(),
    },
    annotations: DESTRUCTIVE,
    run: async ({ issue, instance, deleteSubtasks }) => {
      const { instance: target, issueKey } = registry.resolve({ instance, issue });
      ensureWritable(target);
      await target.client.deleteIssue(issueKey!, deleteSubtasks);
      return `Deleted ${issueKey} on "${target.name}".`;
    },
  });

  defineTool(server, "jira_assign_issue", {
    title: "Assign issue",
    description: "Assign an issue. user accepts 'me', an email/display name, a Cloud accountId or a Data Center username. Use 'none' to unassign.",
    input: {
      issue: issueArg,
      user: z.string().min(1),
      instance: instanceArg,
    },
    annotations: { ...WRITE, idempotentHint: true },
    run: async ({ issue, user, instance }) => {
      const { instance: target, issueKey } = registry.resolve({ instance, issue });
      ensureWritable(target);
      const unassign = ["none", "unassigned", "null", "-"].includes(user.trim().toLowerCase());
      const resolved = unassign ? null : await target.client.resolveUser(user);
      await target.client.assignIssue(issueKey!, resolved);
      return `${issueKey} on "${target.name}" is now ${
        resolved ? `assigned to ${resolved.displayName ?? resolved.accountId ?? resolved.name}` : "unassigned"
      }.`;
    },
  });

  defineTool(server, "jira_get_transitions", {
    title: "List available transitions",
    description: "List the workflow transitions currently available for an issue.",
    input: { issue: issueArg, instance: instanceArg },
    annotations: READ_ONLY,
    run: async ({ issue, instance }) => {
      const { instance: target, issueKey } = registry.resolve({ instance, issue });
      const transitions = await target.client.getTransitions(issueKey!);
      return transitions.map((t) => ({ id: t.id, name: t.name, to: t.to?.name, category: t.to?.statusCategory?.name }));
    },
  });

  defineTool(server, "jira_transition_issue", {
    title: "Transition issue",
    description: "Move an issue through its workflow. 'transition' may be a transition id, a transition name or the target status name.",
    input: {
      issue: issueArg,
      transition: z.string().min(1),
      comment: z.string().optional().describe("Optional comment added with the transition."),
      instance: instanceArg,
    },
    annotations: WRITE,
    run: async ({ issue, transition, comment, instance }) => {
      const { instance: target, issueKey } = registry.resolve({ instance, issue });
      ensureWritable(target);
      const available = await target.client.getTransitions(issueKey!);
      const wanted = transition.trim().toLowerCase();
      const match =
        available.find((t) => String(t.id) === transition.trim()) ??
        available.find((t) => String(t.name).toLowerCase() === wanted) ??
        available.find((t) => String(t.to?.name).toLowerCase() === wanted);
      if (!match) {
        throw new UserError(
          `No transition "${transition}" for ${issueKey}. Available: ${
            available.map((t) => `${t.name} → ${t.to?.name} (id ${t.id})`).join("; ") || "(none)"
          }.`,
        );
      }
      await target.client.transitionIssue(issueKey!, String(match.id), comment);
      return `${issueKey} on "${target.name}" moved via "${match.name}" to ${match.to?.name ?? "the next status"}.`;
    },
  });

  defineTool(server, "jira_get_comments", {
    title: "Get comments",
    description: "Read the most recent comments of an issue as plain text.",
    input: {
      issue: issueArg,
      instance: instanceArg,
      maxResults: z.number().int().min(1).max(100).optional(),
    },
    annotations: READ_ONLY,
    run: async ({ issue, instance, maxResults }) => {
      const { instance: target, issueKey } = registry.resolve({ instance, issue });
      const { total, comments } = await target.client.getComments(issueKey!, maxResults ?? 20);
      return {
        instance: target.name,
        key: issueKey,
        total,
        comments: comments.map((c) =>
          compact({
            id: c.id,
            author: c.author?.displayName,
            created: c.created,
            body: target.client.fromRichText(c.body),
          }),
        ),
      };
    },
  });

  defineTool(server, "jira_add_comment", {
    title: "Add comment",
    description: "Add a comment to an issue (light Markdown supported).",
    input: { issue: issueArg, body: z.string().min(1), instance: instanceArg },
    annotations: WRITE,
    run: async ({ issue, body, instance }) => {
      const { instance: target, issueKey } = registry.resolve({ instance, issue });
      ensureWritable(target);
      const created = await target.client.addComment(issueKey!, body);
      return { instance: target.name, key: issueKey, commentId: created.id };
    },
  });
}

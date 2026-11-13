import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { compact, compactUser } from "../jira/format.js";
import { defineTool, fanOut, fanOutArgs, instanceArg, READ_ONLY, type ToolContext } from "./shared.js";

export function registerMetadataTools(server: McpServer, ctx: ToolContext): void {
  const { registry } = ctx;

  defineTool(server, "jira_list_projects", {
    title: "List projects",
    description: "List projects visible to the account. Supports several instances at once (instances / allInstances).",
    input: {
      query: z.string().optional().describe("Filter by key or name."),
      maxResults: z.number().int().min(1).max(100).optional(),
      instance: instanceArg,
      ...fanOutArgs,
    },
    annotations: READ_ONLY,
    run: async ({ query, maxResults, instance, instances, allInstances }) => {
      const targets = registry.select({ instance, instances, all: allInstances });
      const results = await fanOut(targets, async (i) =>
        (await i.client.listProjects(query, maxResults ?? 50)).map((p) =>
          compact({ key: p.key, name: p.name, type: p.projectTypeKey, lead: p.lead?.displayName }),
        ),
      );
      return results.map((r) => (r.ok ? { instance: r.instance, projects: r.result } : r));
    },
  });

  defineTool(server, "jira_list_link_types", {
    title: "List issue link types",
    description:
      "List issue link types and their inward/outward descriptions. Supports several instances at once (instances / allInstances).",
    input: {
      instance: instanceArg,
      ...fanOutArgs,
    },
    annotations: READ_ONLY,
    run: async ({ instance, instances, allInstances }) => {
      const targets = registry.select({ instance, instances, all: allInstances });
      const results = await fanOut(targets, async (i) =>
        (await i.client.listIssueLinkTypes()).map((linkType) => ({
          id: linkType.id,
          name: linkType.name,
          inward: linkType.inward,
          outward: linkType.outward,
        })),
      );
      return results.map((r) => (r.ok ? { instance: r.instance, linkTypes: r.result } : r));
    },
  });

  defineTool(server, "jira_list_boards", {
    title: "List agile boards",
    description: "List Jira Software boards (Scrum/Kanban), optionally filtered by project or name.",
    input: {
      projectKey: z.string().optional(),
      name: z.string().optional(),
      maxResults: z.number().int().min(1).max(100).optional(),
      instance: instanceArg,
    },
    annotations: READ_ONLY,
    run: async ({ projectKey, name, maxResults, instance }) => {
      const target = registry.resolve({ instance, projectKey }).instance;
      const boards = await target.client.listBoards({ projectKey, name, maxResults });
      return {
        instance: target.name,
        boards: boards.map((b) =>
          compact({ id: b.id, name: b.name, type: b.type, projectKey: b.location?.projectKey }),
        ),
      };
    },
  });

  defineTool(server, "jira_list_sprints", {
    title: "List sprints",
    description: "List sprints of a Scrum board.",
    input: {
      boardId: z.number().int(),
      state: z.enum(["active", "future", "closed"]).optional(),
      instance: instanceArg,
    },
    annotations: READ_ONLY,
    run: async ({ boardId, state, instance }) => {
      const target = registry.resolve({ instance }).instance;
      const sprints = await target.client.listSprints(boardId, state);
      return {
        instance: target.name,
        sprints: sprints.map((s) =>
          compact({ id: s.id, name: s.name, state: s.state, startDate: s.startDate, endDate: s.endDate, goal: s.goal }),
        ),
      };
    },
  });

  defineTool(server, "jira_list_issue_types", {
    title: "List issue types",
    description: "List issue types, globally or those available in a project.",
    input: { projectKey: z.string().optional(), instance: instanceArg },
    annotations: READ_ONLY,
    run: async ({ projectKey, instance }) => {
      const target = registry.resolve({ instance, projectKey }).instance;
      const types = await target.client.listIssueTypes(projectKey);
      return {
        instance: target.name,
        issueTypes: types.map((t) => compact({ id: t.id, name: t.name, subtask: t.subtask, description: t.description })),
      };
    },
  });

  defineTool(server, "jira_list_statuses", {
    title: "List statuses",
    description: "List workflow statuses, globally or per issue type for a project.",
    input: { projectKey: z.string().optional(), instance: instanceArg },
    annotations: READ_ONLY,
    run: async ({ projectKey, instance }) => {
      const target = registry.resolve({ instance, projectKey }).instance;
      const statuses = await target.client.listStatuses(projectKey);
      if (projectKey) {
        return {
          instance: target.name,
          byIssueType: statuses.map((t) => ({
            issueType: t.name,
            statuses: (t.statuses ?? []).map((s: any) => s.name),
          })),
        };
      }
      return {
        instance: target.name,
        statuses: statuses.map((s) => compact({ id: s.id, name: s.name, category: s.statusCategory?.name })),
      };
    },
  });

  defineTool(server, "jira_search_users", {
    title: "Search users",
    description: "Find users by name/email. With projectKey, only users assignable in that project are returned.",
    input: {
      query: z.string().optional(),
      projectKey: z.string().optional(),
      maxResults: z.number().int().min(1).max(100).optional(),
      instance: instanceArg,
    },
    annotations: READ_ONLY,
    run: async ({ query, projectKey, maxResults, instance }) => {
      const target = registry.resolve({ instance, projectKey }).instance;
      const users = projectKey
        ? await target.client.assignableUsers(projectKey, query, maxResults ?? 50)
        : await target.client.findUsers(query ?? "", maxResults ?? 20);
      return { instance: target.name, users: users.map(compactUser) };
    },
  });
}

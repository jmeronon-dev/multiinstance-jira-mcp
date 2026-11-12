import os from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { toInstanceConfig } from "../src/config/normalize.js";
import type { AppConfig } from "../src/config/types.js";
import { InstanceRegistry } from "../src/instances/registry.js";
import { createServer } from "../src/server.js";
import { fakeJira } from "./helpers/fake-jira.js";

const issue = (key: string, summary: string) => ({
  id: key,
  key,
  fields: { summary, status: { name: "To Do" }, issuetype: { name: "Task" }, assignee: null },
});

async function setup(readOnly = false) {
  const app: AppConfig = {
    instances: [
      toInstanceConfig({ name: "cloud", url: "https://acme.atlassian.net", email: "e@acme.com", token: "tok-123", projects: "WEB" }),
      toInstanceConfig({ name: "dc", url: "https://jira.corp.local", token: "pat-123", projects: "OPS", readOnly }),
    ],
    homeDir: os.tmpdir(),
    readOnly: false,
    loginTimeoutSeconds: 60,
    keepAliveSeconds: 0,
    maxAttachmentBytes: 1024,
  };
  const fake = fakeJira({
    "POST acme.atlassian.net /rest/api/3/search/jql": () => ({ json: { issues: [issue("WEB-1", "Cloud bug")], isLast: true } }),
    "POST jira.corp.local /rest/api/2/search": () => ({ json: { issues: [issue("OPS-9", "DC task")], total: 1 } }),
    "GET jira.corp.local /rest/api/2/issue/OPS-9": () => ({
      json: { ...issue("OPS-9", "DC task"), fields: { ...issue("OPS-9", "").fields, summary: "DC task", description: "Plain *wiki*" } },
    }),
    "POST acme.atlassian.net /rest/api/3/issue": (req) => ({ status: 201, json: { id: "10", key: "WEB-2", self: "x", echo: req.body } }),
    "POST jira.corp.local /rest/api/2/issue/OPS-9/comment": () => ({ status: 201, json: { id: "c1" } }),
    "GET acme.atlassian.net /rest/api/3/myself": () => ({ json: { accountId: "1", displayName: "Cloud Me" } }),
    "GET jira.corp.local /rest/api/2/myself": () => ({ status: 401, json: { errorMessages: ["nope"] } }),
  });
  const registry = new InstanceRegistry(app, fake.fetchImpl);
  const server = createServer(registry, app);
  const client = new Client({ name: "test", version: "1.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, server, fake };
}

const parse = (result: any) => JSON.parse(result.content[0].text);

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

describe("MCP server", () => {
  it("exposes the tool set and multi-instance instructions", async () => {
    const { client, server } = await setup();
    cleanup = () => server.close();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const expected of [
      "jira_list_instances",
      "jira_login",
      "jira_add_instance",
      "jira_search",
      "jira_get_issue",
      "jira_create_issue",
      "jira_transition_issue",
      "jira_copy_issue",
    ]) {
      expect(names).toContain(expected);
    }
    expect(client.getInstructions()).toContain("cloud: https://acme.atlassian.net");
  });

  it("searches across every instance at once", async () => {
    const { client, server } = await setup();
    cleanup = () => server.close();
    const result = parse(await client.callTool({ name: "jira_search", arguments: { jql: "order by created", allInstances: true } }));
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ instance: "cloud", issues: [{ key: "WEB-1", url: "https://acme.atlassian.net/browse/WEB-1" }] });
    expect(result[1]).toMatchObject({ instance: "dc", total: 1, issues: [{ key: "OPS-9", assignee: "Unassigned" }] });
  });

  it("routes by project key and reports per-instance failures", async () => {
    const { client, server } = await setup();
    cleanup = () => server.close();
    const issueResult = parse(await client.callTool({ name: "jira_get_issue", arguments: { issue: "OPS-9" } }));
    expect(issueResult).toMatchObject({ instance: "dc", key: "OPS-9", description: "Plain *wiki*" });

    const who = parse(await client.callTool({ name: "jira_whoami", arguments: {} }));
    expect(who[0]).toMatchObject({ instance: "cloud", ok: true, user: { displayName: "Cloud Me" } });
    expect(who[1]).toMatchObject({ instance: "dc", ok: false });
    expect(who[1].error).toContain("personal access token");
  });

  it("creates issues with ADF descriptions on Cloud", async () => {
    const { client, server, fake } = await setup();
    cleanup = () => server.close();
    const created = parse(
      await client.callTool({
        name: "jira_create_issue",
        arguments: { project: "WEB", summary: "New", description: "- one\n- two", labels: ["x"] },
      }),
    );
    expect(created).toEqual({ instance: "cloud", key: "WEB-2", id: "10", url: "https://acme.atlassian.net/browse/WEB-2" });
    const body = fake.requests.find((r) => r.method === "POST" && r.url.pathname === "/rest/api/3/issue")!.body as any;
    expect(body.fields.project).toEqual({ key: "WEB" });
    expect(body.fields.issuetype).toEqual({ name: "Task" });
    expect(body.fields.description.content[0].type).toBe("bulletList");
  });

  it("blocks writes on read-only instances and asks for an instance when ambiguous", async () => {
    const { client, server } = await setup(true);
    cleanup = () => server.close();
    const blocked = await client.callTool({ name: "jira_add_comment", arguments: { issue: "OPS-9", body: "hi" } });
    expect(blocked.isError).toBe(true);
    expect((blocked.content as any)[0].text).toContain("read-only");

    const ambiguous = await client.callTool({ name: "jira_get_issue", arguments: { issue: "ZZZ-1" } });
    expect(ambiguous.isError).toBe(true);
    expect((ambiguous.content as any)[0].text).toContain("Several Jira instances");
  });

  it("adds instances at runtime", async () => {
    const { client, server } = await setup();
    cleanup = () => server.close();
    const added = parse(
      await client.callTool({
        name: "jira_add_instance",
        arguments: { name: "partner", url: "https://jira.partner.com", projects: ["PRT"], makeDefault: true },
      }),
    );
    expect(added.added).toMatchObject({ name: "partner", auth: "browser (SSO session cookies)", projects: ["PRT"] });
    expect(added.default).toBe("partner");
    const list = parse(await client.callTool({ name: "jira_list_instances", arguments: {} }));
    expect(list.instances.map((i: any) => i.name)).toEqual(["cloud", "dc", "partner"]);
  });
});

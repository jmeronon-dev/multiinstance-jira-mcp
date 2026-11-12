import fs from "node:fs";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toInstanceConfig } from "../config/normalize.js";
import { UserError } from "../errors.js";
import { compactUser } from "../jira/format.js";
import { browserProfileDir } from "../paths.js";
import { defineTool, DESTRUCTIVE, fanOut, instanceArg, READ_ONLY, WRITE, type ToolContext } from "./shared.js";

export function registerInstanceTools(server: McpServer, ctx: ToolContext): void {
  const { registry, logins } = ctx;

  defineTool(server, "jira_list_instances", {
    title: "List Jira instances",
    description:
      "List every configured Jira instance (name, URL, deployment, auth method, mapped projects, session state) and the default instance. Call this first when unsure which instance to target.",
    input: {},
    annotations: READ_ONLY,
    run: async () => ({
      defaultInstance: registry.defaultInstance ?? null,
      routing:
        "Calls are routed by: explicit 'instance' argument → 'name:KEY' prefix → issue URL host → project-key mapping → default instance → the only instance.",
      instances: registry.list().map((i) => ({
        ...i.describe(),
        ...(logins.isRunning(i.name) ? { loginInProgress: true } : {}),
      })),
    }),
  });

  defineTool(server, "jira_whoami", {
    title: "Check Jira connections",
    description:
      "Verify connectivity and credentials by calling /myself. Without arguments it checks every configured instance in parallel.",
    input: {
      instance: instanceArg,
    },
    annotations: READ_ONLY,
    run: async ({ instance }) => {
      const targets = instance ? [registry.get(instance)] : registry.list();
      if (targets.length === 0) registry.resolve();
      const results = await fanOut(targets, async (i) => compactUser(await i.client.myself()));
      return results.map((r) => (r.ok ? { instance: r.instance, ok: true, user: r.result } : r));
    },
  });

  defineTool(server, "jira_login", {
    title: "Browser SSO login",
    description:
      "Open a browser window so the user can sign in to a Jira instance that uses auth 'browser' (SSO/SAML/OIDC). Session cookies are stored per instance. If sign-in takes longer than waitSeconds, the window stays open and the login completes in the background — call jira_login again (or jira_whoami) to check.",
    input: {
      instance: instanceArg,
      waitSeconds: z
        .number()
        .int()
        .min(0)
        .max(900)
        .optional()
        .describe("How long this call waits for the login to finish (default 120)."),
      force: z.boolean().optional().describe("Open the browser even if the current session still works."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    run: async ({ instance: name, waitSeconds, force }) => {
      const candidates = registry.list().filter((i) => i.config.auth === "browser");
      const instance = name
        ? registry.get(name)
        : candidates.length === 1
          ? candidates[0]!
          : registry.resolve().instance;

      if (!force && !logins.isRunning(instance.name) && instance.auth.hasCredentials()) {
        try {
          const me = await instance.client.myself();
          return `Instance "${instance.name}" already has a valid session as ${me.displayName ?? me.name ?? me.accountId}. Pass force=true to sign in again.`;
        } catch {
          // fall through to an interactive login
        }
      }

      const alreadyRunning = logins.isRunning(instance.name);
      const login = logins.start(instance);
      const waitMs = (waitSeconds ?? 120) * 1000;
      const result = await Promise.race([
        login,
        new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), waitMs).unref()),
      ]);
      if (!result) {
        return (
          `${alreadyRunning ? "A login" : "A browser window"} for "${instance.name}" is open (${instance.config.baseUrl}). ` +
          `Ask the user to finish signing in there, then call jira_login again or jira_whoami to confirm.`
        );
      }
      if (!result.ok) throw new UserError(result.message);
      return result.message;
    },
  });

  defineTool(server, "jira_logout", {
    title: "Forget a browser session",
    description:
      "Delete the stored browser-session cookies of an instance. With forgetBrowserProfile=true also wipes the dedicated browser profile, so the identity provider asks for credentials again.",
    input: {
      instance: instanceArg,
      forgetBrowserProfile: z.boolean().optional(),
    },
    annotations: DESTRUCTIVE,
    run: async ({ instance: name, forgetBrowserProfile }) => {
      const instance = registry.resolve({ instance: name }).instance;
      if (logins.isRunning(instance.name)) {
        throw new UserError(`A login is in progress for "${instance.name}"; close that browser window first.`);
      }
      const removed = instance.cookies.clear();
      if (forgetBrowserProfile) {
        fs.rmSync(browserProfileDir(registry.homeDir, instance.name), { recursive: true, force: true });
      }
      return `${removed ? "Removed" : "No"} stored session for "${instance.name}"${
        forgetBrowserProfile ? " and wiped its browser profile" : ""
      }.`;
    },
  });

  defineTool(server, "jira_add_instance", {
    title: "Add a Jira instance at runtime",
    description:
      "Register an additional Jira instance for this session (kept in memory; add it to your MCP config to make it permanent). " +
      "Auth is inferred: email+token → basic (Jira Cloud API token), token only → bearer (Data Center PAT), nothing → browser SSO. " +
      "Note: a token passed here is visible to the assistant; prefer configuring secrets in the MCP config.",
    input: {
      name: z.string().min(1).describe("Short unique name, e.g. 'work' or 'client-a'."),
      url: z.string().url().describe("Base URL, e.g. https://acme.atlassian.net or https://jira.corp.local/jira"),
      auth: z.enum(["basic", "bearer", "browser"]).optional(),
      email: z.string().optional().describe("Account email (Cloud) or username (Data Center basic auth)."),
      token: z.string().optional().describe("API token (Cloud) or personal access token (Data Center)."),
      deployment: z.enum(["cloud", "server"]).optional(),
      apiVersion: z.union([z.literal(2), z.literal(3)]).optional(),
      projects: z.array(z.string()).optional().describe("Project keys hosted on this instance (enables routing)."),
      defaultProject: z.string().optional(),
      description: z.string().optional(),
      readOnly: z.boolean().optional(),
      makeDefault: z.boolean().optional(),
      replace: z.boolean().optional().describe("Overwrite an existing instance with the same name."),
    },
    annotations: WRITE,
    run: async (args) => {
      const config = toInstanceConfig({
        name: args.name,
        url: args.url,
        auth: args.auth,
        email: args.email,
        token: args.token,
        deployment: args.deployment,
        apiVersion: args.apiVersion,
        projects: args.projects,
        defaultProject: args.defaultProject,
        description: args.description,
        readOnly: args.readOnly,
      });
      const instance = registry.add(config, { replace: args.replace });
      if (args.makeDefault) registry.setDefault(instance.name);

      let connection: unknown = "not checked (browser auth: call jira_login)";
      if (config.auth !== "browser" || instance.auth.hasCredentials()) {
        try {
          connection = { ok: true, user: compactUser(await instance.client.myself()) };
        } catch (e) {
          connection = { ok: false, error: (e as Error).message };
        }
      }
      return { added: instance.describe(), default: registry.defaultInstance ?? null, connection };
    },
  });

  defineTool(server, "jira_remove_instance", {
    title: "Remove a Jira instance",
    description: "Remove an instance from this session. Optionally also delete its stored browser session.",
    input: {
      name: z.string().min(1),
      deleteSession: z.boolean().optional(),
    },
    annotations: DESTRUCTIVE,
    run: async ({ name, deleteSession }) => {
      const instance = registry.remove(name);
      if (deleteSession) instance.cookies.clear();
      return `Removed instance "${instance.name}". Remaining: ${registry.names().join(", ") || "(none)"}.`;
    },
  });

  defineTool(server, "jira_set_default_instance", {
    title: "Set default Jira instance",
    description: "Choose the instance used when a call cannot be routed automatically. Omit name to clear it.",
    input: { name: z.string().optional() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    run: async ({ name }) => {
      registry.setDefault(name || undefined);
      return `Default instance: ${registry.defaultInstance ?? "(none)"}.`;
    },
  });
}

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppConfig } from "./config/types.js";
import { LoginManager } from "./instances/login-manager.js";
import type { InstanceRegistry } from "./instances/registry.js";
import { registerInstanceTools } from "./tools/instances.js";
import { registerIssueTools } from "./tools/issues.js";
import { registerMetadataTools } from "./tools/metadata.js";
import type { ToolContext } from "./tools/shared.js";
import { registerTransferTools } from "./tools/transfer.js";
import { PACKAGE_NAME, VERSION } from "./version.js";

export function buildInstructions(registry: InstanceRegistry): string {
  const lines = registry.list().map((i) => {
    const extras = [
      i.config.deployment,
      `auth=${i.config.auth}`,
      i.config.projectKeys.length ? `projects=${i.config.projectKeys.join(",")}` : "",
      i.config.readOnly ? "read-only" : "",
      i.config.description ?? "",
    ].filter(Boolean);
    return `- ${i.name}: ${i.config.baseUrl} (${extras.join("; ")})`;
  });
  return [
    "This server connects to one or more Jira instances at the same time.",
    lines.length ? `Configured instances:\n${lines.join("\n")}` : "No instances are configured yet: use jira_add_instance.",
    registry.defaultInstance ? `Default instance: ${registry.defaultInstance}.` : "",
    "Every tool accepts an optional 'instance'. Issue arguments also accept 'instance:KEY-1' or a full browse URL, which selects the instance automatically.",
    "When the user's intent spans several Jira sites, use jira_search / jira_list_projects with allInstances=true.",
    "If a tool reports a missing or expired browser session, call jira_login for that instance and ask the user to finish signing in.",
    "Always confirm with the user before deleting issues.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function createServer(registry: InstanceRegistry, app: AppConfig, logins = new LoginManager(app)): McpServer {
  const server = new McpServer(
    { name: PACKAGE_NAME, version: VERSION },
    { instructions: buildInstructions(registry), capabilities: { tools: {} } },
  );
  const ctx: ToolContext = { registry, logins, app };
  registerInstanceTools(server, ctx);
  registerIssueTools(server, ctx);
  registerMetadataTools(server, ctx);
  registerTransferTools(server, ctx);
  return server;
}

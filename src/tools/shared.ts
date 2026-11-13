import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z, type ZodRawShape } from "zod";
import type { AppConfig } from "../config/types.js";
import { errorMessage, UserError } from "../errors.js";
import type { LoginManager } from "../instances/login-manager.js";
import type { InstanceRegistry, JiraInstance } from "../instances/registry.js";
import { json } from "../jira/format.js";
import { log } from "../logger.js";

export interface ToolContext {
  registry: InstanceRegistry;
  logins: LoginManager;
  app: AppConfig;
}

export const instanceArg = z
  .string()
  .optional()
  .describe(
    "Jira instance name (see jira_list_instances). Optional: calls are routed automatically by 'name:KEY' prefixes, issue URLs, project-key mapping, the default instance, or when only one instance exists.",
  );

export const issueArg = z
  .string()
  .min(1)
  .describe(
    "Issue key ('ABC-123'), instance-prefixed key ('work:ABC-123') or full browse URL ('https://acme.atlassian.net/browse/ABC-123').",
  );

export const fanOutArgs = {
  instances: z.array(z.string()).optional().describe("Run against these instances and merge the results."),
  allInstances: z.boolean().optional().describe("Run against every configured instance and merge the results."),
};

interface ToolDefinition<S extends ZodRawShape> {
  title: string;
  description: string;
  input: S;
  annotations?: ToolAnnotations;
  run: (args: z.output<z.ZodObject<S>>) => Promise<unknown>;
}

export function textResult(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: typeof value === "string" ? value : json(value) }] };
}

export function defineTool<S extends ZodRawShape>(server: McpServer, name: string, def: ToolDefinition<S>): void {
  const handler = async (args: unknown): Promise<CallToolResult> => {
    try {
      return textResult(await def.run(args as z.output<z.ZodObject<S>>));
    } catch (e) {
      if (!(e instanceof UserError)) log.debug(`Tool ${name} failed:`, e);
      return { isError: true, content: [{ type: "text", text: errorMessage(e) }] };
    }
  };
  server.registerTool(
    name,
    {
      title: def.title,
      description: def.description,
      inputSchema: def.input,
      annotations: { openWorldHint: true, ...def.annotations },
    },
    handler as never,
  );
}

export function ensureWritable(instance: JiraInstance): void {
  if (instance.config.readOnly) {
    throw new UserError(`Instance "${instance.name}" is read-only; write operations are disabled.`);
  }
}

/** Runs `fn` on each instance in parallel; one failing instance never hides the others' results. */
export async function fanOut<T>(
  instances: JiraInstance[],
  fn: (instance: JiraInstance) => Promise<T>,
): Promise<Array<{ instance: string } & ({ ok: true; result: T } | { ok: false; error: string })>> {
  const settled = await Promise.allSettled(instances.map(fn));
  return settled.map((s, i) => {
    const instance = instances[i]!.name;
    return s.status === "fulfilled"
      ? { instance, ok: true as const, result: s.value }
      : { instance, ok: false as const, error: errorMessage(s.reason) };
  });
}

export const READ_ONLY: ToolAnnotations = { readOnlyHint: true };
export const WRITE: ToolAnnotations = { readOnlyHint: false, destructiveHint: false };
export const DESTRUCTIVE: ToolAnnotations = { readOnlyHint: false, destructiveHint: true };

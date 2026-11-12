import fs from "node:fs/promises";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { UserError } from "../errors.js";
import { compactIssue, DETAIL_FIELDS } from "../jira/format.js";
import { defineTool, ensureWritable, instanceArg, issueArg, WRITE, type ToolContext } from "./shared.js";

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".log": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".csv": "text/csv",
  ".zip": "application/zip",
};

export function registerTransferTools(server: McpServer, ctx: ToolContext): void {
  const { registry, app } = ctx;

  defineTool(server, "jira_add_attachment", {
    title: "Attach a file",
    description:
      "Attach a file to an issue, either downloaded from a public URL or read from a local path on the machine running this server.",
    input: {
      issue: issueArg,
      url: z.string().url().optional().describe("Public http(s) URL to download."),
      filePath: z.string().optional().describe("Absolute path of a local file."),
      filename: z.string().optional().describe("Override the attachment file name."),
      instance: instanceArg,
    },
    annotations: WRITE,
    run: async ({ issue, url, filePath, filename, instance }) => {
      if (!url === !filePath) throw new UserError('Provide exactly one of "url" or "filePath".');
      const { instance: target, issueKey } = registry.resolve({ instance, issue });
      ensureWritable(target);

      let data: Uint8Array;
      let name: string;
      let contentType: string;
      if (filePath) {
        const stat = await fs.stat(filePath).catch(() => undefined);
        if (!stat?.isFile()) throw new UserError(`File not found: ${filePath}`);
        if (stat.size > app.maxAttachmentBytes) {
          throw new UserError(`File is ${stat.size} bytes; the limit is ${app.maxAttachmentBytes}.`);
        }
        data = await fs.readFile(filePath);
        name = filename ?? path.basename(filePath);
        contentType = MIME_BY_EXT[path.extname(name).toLowerCase()] ?? "application/octet-stream";
      } else {
        const response = await fetch(url!, { redirect: "follow" });
        if (!response.ok) throw new UserError(`Download failed: HTTP ${response.status} for ${url}`);
        const declared = Number(response.headers.get("content-length") ?? 0);
        if (declared > app.maxAttachmentBytes) {
          throw new UserError(`Remote file is ${declared} bytes; the limit is ${app.maxAttachmentBytes}.`);
        }
        data = new Uint8Array(await response.arrayBuffer());
        if (data.byteLength > app.maxAttachmentBytes) {
          throw new UserError(`Remote file is ${data.byteLength} bytes; the limit is ${app.maxAttachmentBytes}.`);
        }
        const fromUrl = decodeURIComponent(new URL(url!).pathname.split("/").filter(Boolean).pop() ?? "");
        name = filename ?? (fromUrl || "attachment");
        contentType = response.headers.get("content-type")?.split(";")[0] ?? "application/octet-stream";
      }

      const attached = await target.client.addAttachment(issueKey!, name, data, contentType);
      return {
        instance: target.name,
        key: issueKey,
        attachments: attached.map((a) => ({ id: a.id, filename: a.filename, size: a.size })),
      };
    },
  });

  defineTool(server, "jira_copy_issue", {
    title: "Copy issue between instances",
    description:
      "Copy an issue (summary, description, labels, optionally priority and comments) from one Jira instance to a project on another instance — or the same one. Adds cross-reference comments when linkBack is true.",
    input: {
      issue: issueArg,
      sourceInstance: instanceArg,
      targetInstance: z.string().min(1).describe("Instance that receives the copy."),
      targetProject: z.string().min(1).describe("Project key on the target instance."),
      issueType: z.string().optional().describe("Issue type on the target (default: same name as the source)."),
      copyPriority: z.boolean().optional().describe("Copy priority by name (default false; names often differ)."),
      copyComments: z.boolean().optional().describe("Also copy comments as text (default false)."),
      linkBack: z.boolean().optional().describe("Add a note with the counterpart URL on both issues (default true)."),
    },
    annotations: WRITE,
    run: async (args) => {
      const { instance: source, issueKey } = registry.resolve({ instance: args.sourceInstance, issue: args.issue });
      const target = registry.get(args.targetInstance);
      ensureWritable(target);

      const original = await source.client.getIssue(issueKey!, { fields: DETAIL_FIELDS });
      const f = original.fields ?? {};
      const sourceUrl = source.client.browseUrl(original.key);
      const linkBack = args.linkBack ?? true;

      let description = source.client.fromRichText(f.description);
      if (linkBack) {
        description = `${description}\n\n---\nCopied from [${original.key}](${sourceUrl}) on instance "${source.name}".`.trim();
      }

      const fields: Record<string, unknown> = {
        project: { key: args.targetProject.toUpperCase() },
        summary: f.summary,
        issuetype: { name: args.issueType ?? f.issuetype?.name ?? "Task" },
        description: target.client.toRichText(description),
      };
      if (Array.isArray(f.labels) && f.labels.length) fields.labels = f.labels;
      if (args.copyPriority && f.priority?.name) fields.priority = { name: f.priority.name };

      const created = await target.client.createIssue(fields);
      const targetUrl = target.client.browseUrl(created.key);
      const warnings: string[] = [];

      if (args.copyComments) {
        const { comments } = await source.client.getComments(original.key, 100);
        for (const c of [...comments].reverse()) {
          const text = `${c.author?.displayName ?? "Someone"} wrote on ${c.created}:\n\n${source.client.fromRichText(c.body)}`;
          await target.client.addComment(created.key, text).catch((e: Error) => warnings.push(e.message));
        }
      }
      if (linkBack && !source.config.readOnly) {
        await source.client
          .addComment(original.key, `Copied to [${created.key}](${targetUrl}) on instance "${target.name}".`)
          .catch((e: Error) => warnings.push(`Could not comment on the source issue: ${e.message}`));
      }

      return {
        source: compactIssue(original, source.client),
        target: { instance: target.name, key: created.key, url: targetUrl },
        ...(warnings.length ? { warnings } : {}),
      };
    },
  });
}

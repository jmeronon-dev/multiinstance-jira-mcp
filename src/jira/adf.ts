/**
 * Conversion between lightweight Markdown / plain text and Atlassian Document
 * Format (ADF), which Jira Cloud REST v3 uses for rich-text fields.
 */

export interface AdfNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: AdfNode[];
}

export interface AdfDoc extends AdfNode {
  type: "doc";
  version: 1;
  content: AdfNode[];
}

const INLINE_PATTERN = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

export function inlineToAdf(text: string): AdfNode[] {
  const nodes: AdfNode[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE_PATTERN)) {
    const index = match.index ?? 0;
    if (index > last) nodes.push({ type: "text", text: text.slice(last, index) });
    const [, bold, code, linkText, href] = match;
    if (bold !== undefined) nodes.push({ type: "text", text: bold, marks: [{ type: "strong" }] });
    else if (code !== undefined) nodes.push({ type: "text", text: code, marks: [{ type: "code" }] });
    else if (linkText !== undefined)
      nodes.push({ type: "text", text: linkText, marks: [{ type: "link", attrs: { href } }] });
    last = index + match[0].length;
  }
  if (last < text.length) nodes.push({ type: "text", text: text.slice(last) });
  return nodes;
}

function paragraph(lines: string[]): AdfNode {
  const content: AdfNode[] = [];
  lines.forEach((line, i) => {
    if (i > 0) content.push({ type: "hardBreak" });
    content.push(...inlineToAdf(line));
  });
  return { type: "paragraph", content };
}

const BULLET = /^\s*[-*+]\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const FENCE = /^```\s*([\w+-]*)\s*$/;
const QUOTE = /^>\s?(.*)$/;
const RULE = /^(-{3,}|\*{3,}|_{3,})$/;

export function markdownToAdf(input: string): AdfDoc {
  const lines = String(input ?? "").replace(/\r\n?/g, "\n").split("\n");
  const content: AdfNode[] = [];
  let buffer: string[] = [];

  const flush = () => {
    if (buffer.length > 0) content.push(paragraph(buffer));
    buffer = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      const code: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i]!)) code.push(lines[i++]!);
      const node: AdfNode = { type: "codeBlock", content: code.length ? [{ type: "text", text: code.join("\n") }] : [] };
      if (fence[1]) node.attrs = { language: fence[1] };
      content.push(node);
      continue;
    }

    if (!line.trim()) {
      flush();
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      content.push({ type: "heading", attrs: { level: heading[1]!.length }, content: inlineToAdf(heading[2]!) });
      continue;
    }

    if (RULE.test(line.trim())) {
      flush();
      content.push({ type: "rule" });
      continue;
    }

    const listMatcher = BULLET.test(line) ? BULLET : ORDERED.test(line) ? ORDERED : undefined;
    if (listMatcher) {
      flush();
      const items: AdfNode[] = [];
      while (i < lines.length && listMatcher.test(lines[i]!)) {
        const text = listMatcher.exec(lines[i]!)![1]!;
        items.push({ type: "listItem", content: [paragraph([text])] });
        i++;
      }
      i--;
      content.push({ type: listMatcher === BULLET ? "bulletList" : "orderedList", content: items });
      continue;
    }

    const quote = QUOTE.exec(line);
    if (quote) {
      flush();
      const quoted: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i]!)) quoted.push(QUOTE.exec(lines[i++]!)![1]!);
      i--;
      content.push({ type: "blockquote", content: [paragraph(quoted)] });
      continue;
    }

    buffer.push(line);
  }
  flush();

  return { type: "doc", version: 1, content };
}

function inlineText(nodes: AdfNode[] | undefined): string {
  if (!nodes) return "";
  return nodes
    .map((node) => {
      switch (node.type) {
        case "text": {
          const link = node.marks?.find((m) => m.type === "link");
          const href = link?.attrs?.href;
          return typeof href === "string" && href !== node.text ? `[${node.text ?? ""}](${href})` : (node.text ?? "");
        }
        case "hardBreak":
          return "\n";
        case "mention":
          return String(node.attrs?.text ?? `@${String(node.attrs?.id ?? "user")}`);
        case "emoji":
          return String(node.attrs?.text ?? node.attrs?.shortName ?? "");
        case "inlineCard":
        case "blockCard":
          return String(node.attrs?.url ?? "");
        case "date": {
          const ts = Number(node.attrs?.timestamp);
          return Number.isFinite(ts) ? new Date(ts).toISOString().slice(0, 10) : "";
        }
        case "status":
          return `[${String(node.attrs?.text ?? "")}]`;
        default:
          return inlineText(node.content);
      }
    })
    .join("");
}

function blocksToLines(nodes: AdfNode[] | undefined, indent = ""): string[] {
  const out: string[] = [];
  for (const node of nodes ?? []) {
    switch (node.type) {
      case "paragraph":
        out.push(...inlineText(node.content).split("\n").map((l) => indent + l), "");
        break;
      case "heading":
        out.push(`${indent}${"#".repeat(Number(node.attrs?.level ?? 1))} ${inlineText(node.content)}`, "");
        break;
      case "bulletList":
      case "orderedList": {
        (node.content ?? []).forEach((item, n) => {
          const marker = node.type === "bulletList" ? "- " : `${n + 1}. `;
          const inner = blocksToLines(item.content, `${indent}  `).filter((l) => l.trim() !== "");
          if (inner.length === 0) return;
          out.push(`${indent}${marker}${inner[0]!.trimStart()}`, ...inner.slice(1));
        });
        out.push("");
        break;
      }
      case "codeBlock":
        out.push(`${indent}\`\`\`${String(node.attrs?.language ?? "")}`, inlineText(node.content), `${indent}\`\`\``, "");
        break;
      case "blockquote":
        out.push(...blocksToLines(node.content).filter((l) => l !== "").map((l) => `${indent}> ${l}`), "");
        break;
      case "rule":
        out.push(`${indent}---`, "");
        break;
      case "panel":
      case "expand":
      case "nestedExpand":
      case "layoutSection":
      case "layoutColumn":
        out.push(...blocksToLines(node.content, indent));
        break;
      case "table":
        for (const row of node.content ?? []) {
          const cells = (row.content ?? []).map((cell) =>
            blocksToLines(cell.content).filter(Boolean).join(" ").trim(),
          );
          out.push(`${indent}| ${cells.join(" | ")} |`);
        }
        out.push("");
        break;
      case "mediaSingle":
      case "mediaGroup":
        out.push(`${indent}[attachment]`, "");
        break;
      default: {
        const text = inlineText(node.content ?? (node.text ? [node] : []));
        if (text) out.push(indent + text, "");
      }
    }
  }
  return out;
}

export function adfToText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value !== "object") return String(value);
  const node = value as AdfNode;
  const lines = node.type === "doc" ? blocksToLines(node.content) : blocksToLines([node]);
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function isAdf(value: unknown): value is AdfDoc {
  return typeof value === "object" && value !== null && (value as AdfNode).type === "doc";
}

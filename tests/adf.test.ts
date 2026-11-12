import { describe, expect, it } from "vitest";
import { adfToText, markdownToAdf } from "../src/jira/adf.js";

describe("markdownToAdf", () => {
  it("builds paragraphs with hard breaks", () => {
    expect(markdownToAdf("line one\nline two\n\nsecond")).toEqual({
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "line one" }, { type: "hardBreak" }, { type: "text", text: "line two" }],
        },
        { type: "paragraph", content: [{ type: "text", text: "second" }] },
      ],
    });
  });

  it("supports headings, lists, code fences and inline marks", () => {
    const doc = markdownToAdf("# Title\n- a\n- **b**\n1. one\n```ts\nconst x = 1;\n```\nsee [docs](https://x.dev) and `code`");
    const types = doc.content.map((n) => n.type);
    expect(types).toEqual(["heading", "bulletList", "orderedList", "codeBlock", "paragraph"]);
    expect(doc.content[1]!.content![1]!.content![0]!.content![0]).toEqual({
      type: "text",
      text: "b",
      marks: [{ type: "strong" }],
    });
    expect(doc.content[3]).toEqual({
      type: "codeBlock",
      attrs: { language: "ts" },
      content: [{ type: "text", text: "const x = 1;" }],
    });
    const para = doc.content[4]!.content!;
    expect(para.find((n) => n.marks?.[0]?.type === "link")?.marks?.[0]?.attrs).toEqual({ href: "https://x.dev" });
    expect(para.find((n) => n.marks?.[0]?.type === "code")?.text).toBe("code");
  });

  it("keeps snake_case identifiers intact", () => {
    const doc = markdownToAdf("use my_var_name here");
    expect(doc.content[0]!.content).toEqual([{ type: "text", text: "use my_var_name here" }]);
  });
});

describe("adfToText", () => {
  it("returns strings unchanged and handles empty values", () => {
    expect(adfToText("plain")).toBe("plain");
    expect(adfToText(null)).toBe("");
  });

  it("round-trips common structures", () => {
    const md = "# Title\n\nHello **world**\n\n- a\n- b\n\n1. one\n2. two\n\n```js\nx()\n```";
    const text = adfToText(markdownToAdf(md));
    expect(text).toContain("# Title");
    expect(text).toContain("Hello world");
    expect(text).toContain("- a\n- b");
    expect(text).toContain("1. one\n2. two");
    expect(text).toContain("```js\nx()\n```");
  });

  it("renders mentions, links and tables", () => {
    const doc = {
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [
            { type: "mention", attrs: { id: "1", text: "@Ana" } },
            { type: "text", text: " see " },
            { type: "text", text: "here", marks: [{ type: "link", attrs: { href: "https://x" } }] },
          ],
        },
        {
          type: "table",
          content: [
            { type: "tableRow", content: [{ type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "A" }] }] }] },
          ],
        },
      ],
    };
    expect(adfToText(doc)).toBe("@Ana see [here](https://x)\n\n| A |");
  });
});

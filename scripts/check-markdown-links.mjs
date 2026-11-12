#!/usr/bin/env node
// Offline check of relative links, images and heading anchors in the Markdown docs.
// External (http/https/mailto) links are never fetched, so the check stays stable.
import { existsSync, readFileSync, readdirSync, statSync, appendFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const roots = ["README.md", "CHANGELOG.md", "AGENTS.md", "docs"];

function collect(path, out) {
  const full = join(root, path);
  if (!existsSync(full)) return;
  if (statSync(full).isDirectory()) {
    for (const entry of readdirSync(full)) collect(join(path, entry), out);
  } else if (path.endsWith(".md")) {
    out.push(path);
  }
}

// Replaces fenced blocks and inline code with spaces, preserving line numbers.
function stripFences(text) {
  return text.replace(/^( {0,3})(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\2[`~]*[ \t]*$|(?![\s\S]))/gm, (s) => s.replace(/[^\n]/g, " "));
}

function stripCode(text) {
  return stripFences(text).replace(/(`+)[^`\n][\s\S]*?\1/g, (s) => s.replace(/[^\n]/g, " "));
}

function slug(heading) {
  return heading
    .trim()
    .replace(/<[^>]+>/g, "")
    .replace(/[<>]/g, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}_\- ]/gu, "")
    .replace(/ /g, "-");
}

const anchorCache = new Map();
function anchorsOf(file) {
  if (!anchorCache.has(file)) {
    const seen = new Map();
    const anchors = new Set();
    const text = stripFences(readFileSync(join(root, file), "utf8"));
    for (const m of text.matchAll(/^ {0,3}#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/gm)) {
      const base = slug(m[1]);
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      anchors.add(n === 0 ? base : `${base}-${n}`);
    }
    for (const m of text.matchAll(/<a\s[^>]*(?:id|name)=["']([^"']+)["']/gi)) anchors.add(m[1]);
    anchorCache.set(file, anchors);
  }
  return anchorCache.get(file);
}

function extractTargets(text) {
  const targets = [];
  const add = (index, raw, kind) => {
    const line = text.slice(0, index).split("\n").length;
    targets.push({ line, raw: raw.trim(), kind });
  };
  for (const m of text.matchAll(/(!?)\[(?:[^[\]]|\[[^\]]*\])*\]\(\s*(<[^>]*>|[^\s()]*(?:\([^\s()]*\)[^\s()]*)*)/g)) {
    add(m.index, m[2].replace(/^<|>$/g, ""), m[1] ? "image" : "link");
  }
  for (const m of text.matchAll(/^ {0,3}\[[^\]]+\]:[ \t]*(<[^>]*>|\S+)/gm)) {
    add(m.index, m[1].replace(/^<|>$/g, ""), "link");
  }
  for (const m of text.matchAll(/<(img|a|source)\s[^>]*?(src|href)=["']([^"']*)["']/gi)) {
    add(m.index, m[3], m[1].toLowerCase() === "a" ? "link" : "image");
  }
  return targets;
}

function markdownCell(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/`/g, "\\`")
    .replace(/[\r\n]/g, " ");
}

const files = [];
for (const r of roots) collect(r, files);
files.sort();

const problems = [];
let checked = 0;

for (const file of files) {
  const text = stripCode(readFileSync(join(root, file), "utf8"));
  for (const { line, raw, kind } of extractTargets(text)) {
    if (!raw || /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("//")) continue;
    checked++;
    const [pathPart, ...rest] = raw.split("#");
    const fragment = rest.join("#");
    let target = file;
    if (pathPart) {
      let decoded = pathPart.split("?")[0];
      try {
        decoded = decodeURI(decoded);
      } catch {
        problems.push({ file, line, kind, raw, reason: "invalid percent-encoding" });
        continue;
      }
      target = relative(root, decoded.startsWith("/") ? join(root, decoded) : resolve(root, dirname(file), decoded));
      if (target.startsWith("..") || !existsSync(join(root, target))) {
        problems.push({ file, line, kind, raw, reason: "target does not exist" });
        continue;
      }
    }
    if (fragment && target.endsWith(".md") && statSync(join(root, target)).isFile()) {
      let wanted = fragment;
      try {
        wanted = decodeURIComponent(fragment);
      } catch {
        // keep the raw fragment
      }
      if (!anchorsOf(target).has(wanted.toLowerCase())) {
        problems.push({ file, line, kind, raw, reason: `anchor not found in ${target.split(sep).join("/")}` });
      }
    }
  }
}

const lines = [];
if (problems.length === 0) {
  lines.push(`✅ ${checked} relative links and images checked in ${files.length} Markdown files; none are broken.`);
} else {
  lines.push(`❌ ${problems.length} broken link(s) or image(s) found (${checked} checked in ${files.length} files):`, "");
  lines.push("| File | Line | Type | Target | Problem |", "| --- | --- | --- | --- | --- |");
  for (const p of problems) {
    lines.push(`| ${markdownCell(p.file)} | ${p.line} | ${markdownCell(p.kind)} | ${markdownCell(p.raw)} | ${markdownCell(p.reason)} |`);
    console.error(`::error file=${p.file},line=${p.line}::Broken ${p.kind} "${p.raw}": ${p.reason}`);
  }
}
console.log(lines.join("\n"));
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### 🔗 Relative links and images\n\n${lines.join("\n")}\n\n`);
}
process.exit(problems.length === 0 ? 0 : 1);

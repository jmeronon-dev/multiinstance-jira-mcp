// postToolUse hook: check the file that the agent has just edited or created.
// On failure it returns the output as additionalContext, so the agent sees it in the same
// turn and fixes it. TypeScript/JavaScript runs the typecheck (fast on this code base) and
// the Markdown covered by the docs check runs markdownlint. Tests and the link check run
// once, in final-check.mjs.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  formatFailures,
  insideAgenticWorkflow,
  isCodeFile,
  isDocFile,
  lintMarkdown,
  readStdinJson,
  repoRoot,
  toRepoPath,
  typecheck,
} from "./checks.mjs";

if (insideAgenticWorkflow) process.exit(0);

const input = await readStdinJson();
const toolArgs = input.toolArgs ?? input.tool_input;

function parseArgs(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

// Collects the paths touched by edit/create tools (`path`) and apply_patch (`*** Update File:`).
function touchedPaths(args) {
  const paths = [];
  const patchHeader = /^\*\*\* (?:Add|Update) File: (.+)$/gm;
  const visit = (value) => {
    if (typeof value === "string") {
      for (const match of value.matchAll(patchHeader)) paths.push(match[1].trim());
    } else if (value && typeof value === "object") {
      for (const key of ["path", "file_path", "filePath"]) {
        if (typeof value[key] === "string") paths.push(value[key]);
      }
      for (const nested of Object.values(value)) if (typeof nested === "string") visit(nested);
    }
  };
  visit(parseArgs(args));
  return paths;
}

const files = [...new Set(touchedPaths(toolArgs).map((p) => toRepoPath(p, input.cwd)).filter(Boolean))].filter(
  (file) => existsSync(resolve(repoRoot, file)),
);
const codeFiles = files.filter(isCodeFile);
const docFiles = files.filter(isDocFile);

const results = [];
if (codeFiles.length > 0) results.push(typecheck());
if (docFiles.length > 0) results.push(lintMarkdown(docFiles));

const failures = formatFailures(results);
if (failures) {
  const context = [
    "The CI would reject this change (required checks `🧪 validate` and `📚 docs`).",
    "Fix the problems below now, before continuing:",
    "",
    failures,
  ].join("\n");
  process.stdout.write(JSON.stringify({ additionalContext: context }));
}

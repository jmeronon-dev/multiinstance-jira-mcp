// Shared helpers for the Agent Hooks. Zero dependencies: Node.js built-ins only.
// The checks mirror the required CI checks: "🧪 validate" (typecheck, tests) and "📚 docs"
// (markdownlint and relative-link check). Keep the markdownlint version in sync with
// .github/workflows/docs.yml.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const MARKDOWNLINT = "markdownlint-cli2@0.24.0";

// gh-aw runs the agent behind a firewall that blocks the npm registry, so `npx` cannot work there.
// The agentic workflows run these checks in their own post-steps instead (see docs/guardrails.md).
export const insideAgenticWorkflow = process.env.GITHUB_AW === "true";

const CODE_EXT = /\.(?:[cm]?[jt]sx?)$/;
const DOC_FILES = new Set(["README.md", "CHANGELOG.md", "AGENTS.md"]);
const MAX_OUTPUT = 6000;

export function isCodeFile(file) {
  return CODE_EXT.test(file) && !file.startsWith(".github/");
}

// Same scope as the `globs` of .markdownlint-cli2.jsonc.
export function isDocFile(file) {
  return DOC_FILES.has(file) || (file.startsWith("docs/") && file.endsWith(".md"));
}

// Normalizes a path to a repo-relative POSIX path, or returns null when it is outside the repo.
export function toRepoPath(file, cwd = repoRoot) {
  const abs = isAbsolute(file) ? file : resolve(cwd, file);
  const rel = relative(repoRoot, abs);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return null;
  return rel.split(sep).join("/");
}

export function readStdinJson() {
  return new Promise((resolveInput) => {
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (raw += chunk));
    process.stdin.on("end", () => {
      try {
        resolveInput(raw.trim() ? JSON.parse(raw) : {});
      } catch {
        resolveInput({});
      }
    });
    process.stdin.on("error", () => resolveInput({}));
  });
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    // npm and npx are .cmd shims on Windows.
    shell: process.platform === "win32",
    maxBuffer: 16 * 1024 * 1024,
    timeout: 240_000,
    env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1" },
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  const failed = result.error ? true : result.status !== 0;
  return { ok: !failed, output: result.error ? `${result.error.message}\n${output}`.trim() : output };
}

function hasLocalDependencies() {
  return existsSync(resolve(repoRoot, "node_modules", ".bin"));
}

function truncate(text) {
  return text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}\n... (output truncated)` : text;
}

// Each check returns { name, command, ok, output }; checks that cannot run return null.
function check(name, command, args) {
  const { ok, output } = run(command, args);
  return { name, command: [command, ...args].join(" "), ok, output: truncate(output) };
}

export function typecheck() {
  if (!hasLocalDependencies()) return null;
  return check("typecheck", "npm", ["run", "--silent", "typecheck"]);
}

export function unitTests() {
  if (!hasLocalDependencies()) return null;
  return check("tests", "npm", ["test", "--silent"]);
}

export function lintMarkdown(files) {
  // --no-globs lints only the given files; without files it uses the globs of the config.
  const args = ["--yes", MARKDOWNLINT, ...(files ? ["--no-globs", ...files] : [])];
  return check("markdownlint", "npx", args);
}

export function checkLinks() {
  return check("markdown links", "node", ["scripts/check-markdown-links.mjs"]);
}

export function formatFailures(results) {
  return results
    .filter((r) => r && !r.ok)
    .map((r) => `### ${r.name} failed (\`${r.command}\`)\n\n${r.output}`)
    .join("\n\n");
}

function git(args) {
  return spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
}

// The base branch of the pull request: FACTORY_BASE_BRANCH, then origin/HEAD, then the
// usual default branch names.
export function baseRef() {
  const candidates = [];
  if (process.env.FACTORY_BASE_BRANCH) candidates.push(`origin/${process.env.FACTORY_BASE_BRANCH}`);
  const head = git(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  if (head.status === 0 && head.stdout.trim()) candidates.push(head.stdout.trim());
  candidates.push("origin/develop", "origin/main");
  return candidates.find((ref) => git(["rev-parse", "--verify", "--quiet", ref]).status === 0) ?? null;
}

// Repo-relative files changed on this branch: committed (against the base branch), staged,
// unstaged and untracked. Deleted files are kept: removing a file can break imports or links.
export function changedFiles() {
  const base = baseRef();
  const lists = [
    ...(base ? [["diff", "--name-only", `${base}...HEAD`]] : []),
    ["diff", "--name-only", "HEAD"],
    ["ls-files", "--others", "--exclude-standard"],
  ];
  const files = new Set();
  for (const args of lists) {
    const result = git(args);
    if (result.status !== 0) continue;
    for (const line of result.stdout.split("\n")) if (line.trim()) files.add(line.trim());
  }
  return [...files];
}

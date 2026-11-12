# Guardrails

> **Purpose:** summarise the rules that must not be broken when changing the server or the factory.
> **Keep up to date:** every rule must match `AGENTS.md` and the code. `AGENTS.md` is the source; this page only summarises it.

## Credentials

- Never log, return, persist or commit tokens, PATs, passwords, cookies or `Authorization` headers. `src/logger.ts` redacts every registered secret; new secrets must be registered with `registerSecret`.
- The server never writes tokens to disk. Browser sessions are stored per instance in `session.json` with permissions `0600`, and only for cookies of the Jira host.
- Vulnerabilities and leaked credentials are reported through a private security advisory, never in a public Issue.

## Jira deployments

- Keep Jira Cloud and Data Center working: REST v3 vs v2, ADF vs plain text, `/search/jql` vs `/search`, `accountId` vs `username`.
- Anything that only works on one deployment says so in the tool description and the README.

## Routing and tools

- Routing order: `instance` argument → `name:KEY` prefix → issue URL host → project-key mapping → default instance → only instance. Ambiguous calls fail and name the options.
- Fan-out tools return one entry per instance and never hide healthy results.
- Write tools call `ensureWritable` and use the `WRITE` or `DESTRUCTIVE` annotation; read-only mode blocks them before any request.
- Tool names, argument names and output shapes are a public contract. Breaking changes need an Issue and a `Changed` entry in the CHANGELOG.

## Process

- GitHub Flow: reuse or create an Issue, a focused branch with its number, Conventional Commits and an independent review before opening a PR.
- PR workflows only validate. They never receive secrets or write permissions for PR code.
- Done means `npm run typecheck`, `npm test` and `npm run build` green for code, and `npm run docs:lint` and `npm run docs:links` green for docs.

## Agent Hooks: checks before the PR

The required checks of the default branch are `🧪 validate` and `📚 docs`. To let agents fix problems before the PR exists, `.github/hooks/pre-pr-checks.json` declares two [Copilot hooks](https://docs.github.com/en/copilot/reference/hooks-reference). The scripts in `.github/hooks/scripts/` use only Node.js built-ins.

| Hook | When | What it checks | How the agent learns about it |
|---|---|---|---|
| `postToolUse` (`post-edit-check.mjs`) | After each `edit`, `create` or `apply_patch` | TypeScript/JavaScript → `npm run typecheck`; `README.md`, `CHANGELOG.md`, `AGENTS.md` and `docs/**/*.md` → `markdownlint-cli2` on the edited file | The error is returned as `additionalContext` in the same turn |
| `agentStop` (`final-check.mjs`) | When the agent is about to finish | Everything changed on the branch against the base branch: code → typecheck, then `npm test`; Markdown → markdownlint and the link check | It blocks the stop (`decision: "block"`) and the error becomes the next prompt |

- The base branch is `FACTORY_BASE_BRANCH` if set, then `origin/HEAD`, then `origin/develop` or `origin/main`.
- Both hooks do nothing when no file of those types changed, and they exit at once inside gh-aw (`GITHUB_AW=true`), whose firewall blocks the npm registry; the agentic workflows run the checks in their own `post-steps`.
- Code checks need `node_modules`; without `npm ci` they are skipped.

## Who reviews what

The ruleset of the default branch should require a code owner review. In CODEOWNERS the last matching rule wins for each file.

| Paths | Code owner |
|---|---|
| `AGENTS.md`, `.github/`, `.vscode/` | `@jmeronon-dev` |
| `src/auth/` | `@jmeronon-dev` |
| `package.json`, `package-lock.json` | `@jmeronon-dev` |
| Everything else (`src/`, `tests/`, `docs/`, `README.md`…) | No owner (see [Lights-out](lights-out.md)) |

- There is no `*` rule, so lights-out PRs are not blocked: Copilot cannot approve, and the approval of whoever launched it does not count on its PRs.
- Accepted risk: human PRs that only touch code without owner do not need a code owner review either. The barriers are the required checks `🧪 validate` and `📚 docs`.

More context: [Architecture](architecture.md) and [Software factory](software-factory.md).

# AGENTS.md

## Project context

- `multiinstance-jira-mcp` is a [Model Context Protocol](https://modelcontextprotocol.io) server that connects AI assistants to **1..N Jira sites at once**: Jira Cloud and Jira Data Center / Server, each with its own authentication (API token, personal access token or browser SSO).
- TypeScript (strict, ESM, `NodeNext`), Node.js **20+**, MCP over **stdio**. Runtime dependencies: `@modelcontextprotocol/sdk`, `playwright` (browser SSO only) and `zod`. Tests use Vitest against a fake Jira; they never call a real Jira.
- Code, comments, docs, Issues and PRs are written in English.
- Keep scope focused. Do not add runtime dependencies, new authentication methods, persistence of tokens or telemetry without an Issue that asks for it.

## Key entrypoints

- `src/index.ts`: entry point and CLI subcommands (`serve`, `login`, `logout`, `instances`).
- `src/cli.ts`: argument parser with instance-scoped flag blocks (`--instance <name>` starts a block).
- `src/config/`: types, normalisation and inference (`normalize.ts`), multi-source loading with precedence (`load.ts`).
- `src/auth/`: auth providers, cookie store and Playwright browser login. **Handles credentials: protected path.**
- `src/instances/registry.ts`: instance registry and routing (`resolve` and `select`); `login-manager.ts` and `keepalive.ts` for browser sessions.
- `src/jira/client.ts`: REST client (Cloud v3 / Data Center v2); `adf.ts` Markdown ↔ ADF; `format.ts` compact output.
- `src/tools/`: MCP tool definitions; `shared.ts` holds `defineTool`, shared arguments, `fanOut`, `ensureWritable` and annotations.
- `src/server.ts`: `McpServer` and the dynamic instructions sent to the assistant.
- `tests/`: Vitest suites; `tests/helpers/fake-jira.ts` is the fake Jira router.
- `docs/index.md`: project wiki. Read it before changing code and open only the pages relevant to the task.
- `.github/skills/`: agent skills (`triage-issue`, `add-mcp-tool`, `release-version`). `docs/software-factory.md` explains how Issues flow to merged PRs; `docs/releasing.md` explains releases.

## Development and run

Use Node.js 20+ (22 recommended) and npm. Install dependencies first; tests never need a browser:

```sh
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci
```

Validate:

```sh
npm run typecheck
npm test
npm run build
```

Documentation checks (same as the required `📚 docs` check):

```sh
npm run docs:lint
npm run docs:links
```

Run the server from source with `npm run dev -- <flags>` and inspect it with `npm run build && npm run inspect`.

## Guardrails

- Never log, return, persist or commit tokens, PATs, passwords, cookies or `Authorization` headers. Logs go through `src/logger.ts`, which redacts secrets; keep it that way. The server never writes tokens to disk.
- Keep Jira Cloud **and** Data Center working: REST v3 vs v2, ADF vs plain text, `/search/jql` vs `/search`, `accountId` vs `username`. A change that only works on one deployment must say so in the tool description and the README.
- Preserve the routing order: `instance` argument → `name:KEY` prefix → issue URL host → project-key mapping → default instance → only instance. Ambiguous calls must fail with a message that names the options.
- Fan-out tools return one entry per instance and never hide results because another instance failed.
- Every write tool calls `ensureWritable` and uses the `WRITE` or `DESTRUCTIVE` annotation; read-only mode (global or per instance) must block it before any request.
- Keep tool names, argument names and output shapes stable: they are the public contract with assistants. Breaking changes need an Issue and a CHANGELOG entry under `Changed`.
- Follow GitHub Flow: find or reuse a relevant Issue before implementation; use a focused branch with the Issue number (`feat/<n>-<slug>`, `fix/<n>-<slug>`) and Conventional Commits. Use only labels declared in `.github/labels.yml`. Do not merge automatically.
- Check scope before starting another Issue or deliverable; normal corrections stay with the active task.
- PR workflows validate only. Never expose secrets or write permissions to code from a pull request.

## Definition of done

- For code changes: `npm run typecheck`, `npm test` and `npm run build` pass, with meaningful tests for the behaviour changed (Cloud and Data Center, routing, read-only mode when relevant); do not merely mirror the implementation.
- For documentation-only changes: `npm run docs:lint` and `npm run docs:links` pass; verify paths, commands, flags and accuracy against the code.
- User-visible changes (tools, flags, environment variables, behaviour) update the README and add an entry under `## [Unreleased]` in `CHANGELOG.md`.
- Complete an independent review of the actual diff, resolve actionable findings and verify the fixes. Present the result and wait for **explicit user approval before any PR, including a draft**. Material changes require a renewed review and approval.
- The Agent Hooks in `.github/hooks/` run the same checks as CI before you finish; do not bypass them.

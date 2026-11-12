# Procedure: add an MCP tool

Part of `add-mcp-tool`. The code is the source of truth: when this page and the code disagree, follow the code and propose a fix to this page.

## Where things live

| Piece | File | Notes |
|---|---|---|
| REST call | `src/jira/client.ts` | One method per operation. Choose v3/v2 paths from the instance config; Cloud uses `accountId`, Data Center uses `username`. |
| Rich text | `src/jira/adf.ts` | Markdown → ADF on v3, plain text on v2. ADF → text when reading. |
| Compact output | `src/jira/format.ts` | `compact`, `compactUser`, `json`: never return raw Jira payloads unless the tool has `raw: true`. |
| Tool definition | `src/tools/*.ts` | `defineTool(server, name, { title, description, input, annotations, run })`. |
| Shared arguments | `src/tools/shared.ts` | `instanceArg`, `issueArg`, `fanOutArgs`, `fanOut`, `ensureWritable`, `READ_ONLY`, `WRITE`, `DESTRUCTIVE`. |
| Registration | `src/server.ts` | Only if you add a new `register*Tools` file. |
| Tests | `tests/server.test.ts`, `tests/client.test.ts` | In-memory MCP client plus `fakeJira` routes `"<METHOD> <host> <path>"`. |

## Conventions

- Name: `jira_<verb>_<noun>` in snake_case. Title in sentence case. Description in one or two sentences, saying when to use it and whether it supports several instances.
- Routing: single-instance tools call `registry.resolve({ instance, issue | projectKey })`; fan-out tools call `registry.select({ instance, instances, all })` and `fanOut`, returning one entry per instance (errors included, never hiding other results).
- Errors the user can fix are `UserError` (`src/errors.ts`); everything else bubbles up and `defineTool` turns it into `isError: true`.
- Write tools: annotation `WRITE` (or `DESTRUCTIVE` for deletions) and `ensureWritable(instance)` before any request. The server instructions already ask the assistant to confirm deletions.
- Never log or return tokens, cookies or `Authorization` headers; use `log.debug` for diagnostics.
- Code and comments in English, ESM imports with the `.js` suffix, strict TypeScript (`noUncheckedIndexedAccess`).

## Tests to add

1. The tool appears in `listTools` with the expected annotations.
2. Happy path on a Cloud instance (v3 path, ADF if relevant).
3. Happy path on a Data Center instance (v2 path).
4. Routing by `instance:KEY` or URL when the tool takes an issue.
5. For fan-out tools: one instance failing still returns the others.
6. For write tools: a read-only instance returns an error and sends no request.

## Validation

```sh
npm run typecheck
npm test
npm run build
```

## Pull request

- Branch `feat/<issue-number>-<tool-name>`, Conventional Commits (`feat(tools): add jira_list_worklogs`).
- Body with `Closes #<n>`, the tool contract (inputs/outputs), the tests added and the validation output.
- Update the README tools table and `CHANGELOG.md` (`## [Unreleased]` → `### Added`).
- Wait for explicit approval before opening the PR, including drafts.

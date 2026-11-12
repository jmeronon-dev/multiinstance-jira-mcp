---
name: add-mcp-tool
description: "Turn an approved 🧰 new-tool Issue (fields of new-tool.yml) into a working `jira_*` MCP tool: client method, tool definition, tests, README and CHANGELOG. USE FOR: implementing a new tool or extending an existing one with a new operation. DO NOT USE FOR: proposing or judging tools, changing authentication or routing, or refactoring unrelated code."
---

# Add an MCP tool

> Detailed procedure, conventions and checklist: [procedure](references/procedure.md).

## Steps

1. Read the Issue fields (`tool_name`, `endpoints`, `inputs`, `output`, `kind`, `instances`) and `docs/architecture.md`. If a field is missing or contradictory, stop and ask in the Issue.
2. Add the REST call to `src/jira/client.ts`, choosing the endpoint by `apiVersion` / deployment (Cloud v3 vs Data Center v2).
3. Register the tool with `defineTool` in the matching file of `src/tools/` (`issues.ts`, `metadata.ts`, `instances.ts` or `transfer.ts`), using `instanceArg`, `issueArg` and `fanOutArgs` from `shared.ts` and the right annotation (`READ_ONLY`, `WRITE` or `DESTRUCTIVE`). Write tools call `ensureWritable`.
4. Add tests in `tests/` with `tests/helpers/fake-jira.ts`, covering Cloud and Data Center, routing and read-only mode for writes.
5. Document the tool in the README tools table and add an `Unreleased` entry to `CHANGELOG.md`.
6. Run `npm run typecheck`, `npm test` and `npm run build`; all must pass.
7. Stop before opening the PR: report the result and wait for explicit approval.

## Limits

Do not store or return credentials, do not add runtime dependencies without the Issue saying so, and do not change routing, authentication or configuration loading.

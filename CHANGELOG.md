# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.1] - 2026-11-13

First version published to npm.

### Added

- Agentic software factory: Issue templates (bug, enhancement, new MCP tool, software factory change), declared labels synced by `🏷️ Sync labels`, and `CODEOWNERS` for governance, credential handling and the supply chain.
- Agentic workflows (gh-aw): `🚦 Triage` with the `triage-issue` skill, `🔁 Triage learn` to improve the triage rules from human corrections, and `📚 Docs sync` to keep `docs/` and `README.md` in sync with the code.
- 🌙 Lights-out lane: `🌙 Lights-out assign` assigns simple Issues to the Copilot cloud agent and `🔀 Lights-out auto-merge` enables auto-merge on its small PRs that pass the guardrails in `.github/scripts/lights-out-guard.sh`.
- Agent instructions (`AGENTS.md`, `.github/copilot-instructions.md`), the `add-mcp-tool` skill, Agent Hooks that run the CI checks before the agent finishes, and `copilot-setup-steps.yml`.
- CI: required `🧪 validate` and `📚 docs` checks, `🏭 Factory checks`, `🥷 Validate skills`, `🏷️ PR labels` and Dependabot for actions and npm. Actions are pinned by commit SHA.
- Project wiki in `docs/` and `npm run docs:lint`, `docs:links` and `factory:test` scripts.
- `🚀 Publish to npm` workflow: a published GitHub Release stages the package on npm with trusted publishing (OIDC) and provenance, and a maintainer approves it with 2FA. See `docs/releasing.md`.
- `repository`, `homepage` and `bugs` fields in `package.json`.

### Changed

- The build no longer emits source maps, which pointed to `src/` files that are not published, and `npm run build` empties `dist/` first.

## [0.1.0] - 2026-11-12

Not published to npm.

### Added

- Multi-instance support: 1..N Jira Cloud / Data Center sites in one server.
- Authentication per instance: API token (basic), personal access token (bearer) and browser SSO (Playwright, persistent profile per instance).
- Configuration from CLI flags (instance-scoped blocks), environment variables (single or `JIRA_INSTANCES` + prefixed vars, or JSON), a JSON config file and the runtime `jira_add_instance` tool.
- Automatic routing by `instance` argument, `name:KEY` prefix, issue URL host, project-key mapping, default instance or single instance.
- Tools: instance management (`jira_list_instances`, `jira_whoami`, `jira_login`, `jira_logout`, `jira_add_instance`, `jira_remove_instance`, `jira_set_default_instance`), issues (`jira_search`, `jira_get_issue`, `jira_create_issue`, `jira_update_issue`, `jira_delete_issue`, `jira_assign_issue`, `jira_get_transitions`, `jira_transition_issue`, `jira_get_comments`, `jira_add_comment`, `jira_add_attachment`, `jira_copy_issue`) and metadata (`jira_list_projects`, `jira_list_boards`, `jira_list_sprints`, `jira_list_issue_types`, `jira_list_statuses`, `jira_search_users`).
- Cross-instance fan-out for search and project listing.
- Markdown → ADF conversion for Cloud, ADF → text for reading.
- Background login that outlives tool-call timeouts, session keep-alive and cookie rotation.
- Global and per-instance read-only mode; secret redaction in logs.
- CLI subcommands: `serve`, `login`, `logout`, `instances`.

[Unreleased]: https://github.com/jmeronon-dev/multiinstance-jira-mcp/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/jmeronon-dev/multiinstance-jira-mcp/releases/tag/v0.1.1

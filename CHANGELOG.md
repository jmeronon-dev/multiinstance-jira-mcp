# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-11-12

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

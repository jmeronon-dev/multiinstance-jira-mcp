# Triage rules of the software factory

Part of `triage-issue`: 🚦 Triage reads it and 🔁 Triage learn changes it through a reviewed PR.

## What the project is

An MCP server (TypeScript, Node.js 20+, stdio) that connects AI assistants to 1..N Jira
sites at once: Jira Cloud and Data Center, with API tokens, PATs or browser SSO. Tools are
`jira_*` definitions in `src/tools/`; the REST client is `src/jira/client.ts`.

## Rules

- ✅ agent-ready: reproducible bug (steps, expected result, versions); new tool with
  endpoints, inputs, output and both mandatory confirmations ticked; or a small,
  verifiable enhancement in one area.
- 📐 needs-spec: new behaviour that changes routing, authentication, configuration
  precedence or the public contract of several tools; or an open-ended request.
- 💬 needs-info: missing steps, versions, deployment, endpoints or what fails. In 🧰 new-tool,
  also when a mandatory confirmation is unticked. Ask for it; neither triage nor the agent
  ticks boxes for the author.
- 💡 lights-on: changes what the server does (tools, routing, auth, config, output).
- 🌙 lights-out: only changes documentation (`docs/`, `README.md`, tool descriptions in docs);
  it takes precedence over 💡 lights-on.
- Security: anything about leaked credentials or a vulnerability → 💬 needs-info and ask the
  author to use a private security advisory instead.

### Complexity

- 🟢 complexity-low: 1–2 files, no new logic (typos, docs, a description, an error message).
- 🟡 complexity-medium: bounded feature or bug fix; every 🧰 new-tool.
- 🔴 complexity-high: authentication, cookies, routing, configuration loading, architecture,
  new dependencies or open scope.

### Area

ONE at most, from this closed list: 🔐 auth (tokens, PAT, SSO, cookies), 🧭 routing
(registry, instance resolution, login manager), 🧩 tools (tool definitions, inputs, outputs),
🔌 jira-api (REST client, ADF, formatting), ⚙️ config (CLI flags, env, config file),
📝 documentation (only docs), 🚀 ci-release (CI, packaging, publishing). None for
🏭 software-factory, when a person already set one, or when none fits clearly.
Enhancement template, `Area`: map each option to its label; "Other" → by content.
📝 documentation or 🧩 tools + 🟢 low + ✅ agent-ready activates `🌙 Lights-out assign`.

### By Issue type

- 🐛 bug: ✅ agent-ready with steps, expected result and versions; otherwise 💬 needs-info.
- 🧰 new-tool: ✅ agent-ready with endpoints for both deployments (or a stated limitation),
  inputs, output and both confirmations; otherwise 💬 needs-info. Always 🟡 or 🔴.
- ✨ enhancement: 📐 needs-spec unless it is small, in one area and verifiable.
- 🏭 software-factory: never 🌙 lights-out; always 💡 lights-on. With concrete, verifiable
  criteria, ✅ agent-ready; 📐 needs-spec only if it is unclear how to do it. No area.

## Examples

### `jira_search` fails on Data Center 8.5 with "Unrecognized field nextPageToken"

- Decision: ✅ agent-ready · 💡 lights-on · 🟡 complexity-medium · 🔌 jira-api
- Why: reproducible, with versions and expected result; it touches the REST client.

### Add a `jira_list_worklogs` tool

- Decision: ✅ agent-ready · 💡 lights-on · 🟡 complexity-medium · 🧩 tools
- Why: endpoints for Cloud and DC, inputs, output and both confirmations ticked.

### Support OAuth 2.0 (3LO) for Jira Cloud

- Decision: 📐 needs-spec · 🔴 complexity-high · 🔐 auth
- Why: new authentication method; it needs a design for token storage and refresh.

### Fix the description of `jira_assign_issue` in the README

- Decision: ✅ agent-ready · 🌙 lights-out · 🟢 complexity-low · 📝 documentation
- Why: documentation only, one file, verifiable.

### "Copy issue does not work"

- Decision: 💬 needs-info · 🟢 complexity-low
- Why: no steps, deployment or error message.
- Next step: author, add the steps, both deployments involved and the redacted error.

## Lessons

<!-- The 🔁 Triage learn workflow appends one example per human correction. -->

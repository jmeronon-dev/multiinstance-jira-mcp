# multiinstance-jira-mcp — Project wiki

> **Purpose:** front page of the wiki. Explains what the project is and links every page of `docs/`.
> **Keep up to date:** every page of `docs/` appears in the index with a one-line description, and the summary matches the code.

## What the project is

An MCP server, written in TypeScript for Node.js 20+, that connects AI assistants (Claude, Cursor, VS Code Copilot, OpenCode…) to several Jira sites at the same time: Jira Cloud and Jira Data Center / Server, each with its own authentication (API token, personal access token or browser SSO). It speaks MCP over stdio and routes every tool call to the right instance automatically.

The repository also works as a *software factory*: ideas enter as Issues, they are classified with written rules, an agent implements them and a person reviews them before they are merged. Only documentation and small, low-risk changes can merge without a human review (🌙 lights-out).

## Index

| Page | What it covers |
|---|---|
| [Architecture](architecture.md) | Modules, configuration precedence, routing, the tool contract and tests. |
| [Software factory](software-factory.md) | The path of an Issue: templates, triage, agent, review and merge. |
| [Lights-out](lights-out.md) | Which changes merge without human review, why, and the workflows that do it. |
| [Guardrails](guardrails.md) | Rules that must not be broken: credentials, deployments, routing, process and reviews. |
| [Skills and MCP](skills-and-mcp.md) | Agent skills, Agent Hooks, MCP configuration and how they are validated. |
| [Releasing](releasing.md) | How a version reaches npm with trusted publishing, the one-time setup and the release steps. |

## Where else to look

- [`README.md`](../README.md): installation, configuration and the tool list for users.
- [`AGENTS.md`](../AGENTS.md): instructions for agents; it is the source of the working rules.
- [`CHANGELOG.md`](../CHANGELOG.md): released and unreleased changes.
- [`.github/skills/triage-issue/`](../.github/skills/triage-issue/SKILL.md): triage skill; the rules are in [`references/rules.md`](../.github/skills/triage-issue/references/rules.md).

When the documentation and the code disagree, the code is right.

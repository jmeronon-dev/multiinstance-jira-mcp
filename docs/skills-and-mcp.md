# Skills and MCP

> **Purpose:** inventory the repository skills, the Agent Hooks and the MCP configuration, and explain how they are validated.
> **Keep up to date:** the skill list (one per folder of `.github/skills/`), `.vscode/mcp.json` and `validate-skills.yml`. Review this page when any of them change.

## Skills

They live in `.github/skills/<name>/SKILL.md`, with the long detail in `references/`.

### `triage-issue`

Triages a new Issue: one status (`✅ agent-ready`, `📐 needs-spec` or `💬 needs-info`), the lights (only for `✅ agent-ready`), one complexity, at most one area, and a single short comment with the format "Triage / Why / Next step".

- **Used by:** the agentic workflow `🚦 Triage` on every new Issue; it can also be used by hand.
- **Limits:** it never writes code, assigns, closes or edits Issues, and never invents labels. When in doubt it chooses the most cautious option.
- **Content:** `SKILL.md` and `references/rules.md`. The rules are changed only through reviewed PRs, usually opened by `🔁 Triage learn`.

### `add-mcp-tool`

Turns an approved `🧰 new-tool` Issue (fields of `new-tool.yml`) into a working `jira_*` tool: client method in `src/jira/client.ts`, definition with `defineTool`, tests against the fake Jira for Cloud and Data Center, README table and CHANGELOG.

- **Limits:** it does not change authentication, routing or configuration loading, does not add runtime dependencies unless the Issue asks for them, and stops before opening the PR to wait for approval.
- **Content:** `SKILL.md` and `references/procedure.md` (where things live, conventions, tests and PR checklist).

### `release-version`

Releases a new version of the npm package: proposes the SemVer bump from `CHANGELOG.md`, opens the release PR, creates the GitHub Release that triggers `🚀 Publish to npm`, follows the run and verifies the version on npm. The process is described in [Releasing](releasing.md).

- **Limits:** it never runs `npm publish`, approves staged versions, merges PRs or handles OTPs and tokens. It asks for confirmation before the release PR and before the GitHub Release, and hands the 2FA approval on npmjs.com to a maintainer.
- **Content:** `SKILL.md` and `references/procedure.md` (preflight, version rules, commands and recovery).

## Agent Hooks

`.github/hooks/pre-pr-checks.json` runs the CI checks inside the agent session before it finishes. Details in [Guardrails](guardrails.md#agent-hooks-checks-before-the-pr).

## MCP

`.vscode/mcp.json` configures two servers for VS Code:

- **github:** the read-only GitHub MCP server (`https://api.githubcopilot.com/mcp/readonly`), to read Issues, PRs and runs.
- **jira-dev:** this server from source (`npx tsx src/index.ts`) in **read-only** mode, to dogfood changes against a real Jira. VS Code prompts for the URL, the email (empty for a Data Center PAT) and the token, and keeps the token as a password input.

## Validation

`.github/workflows/validate-skills.yml` runs when `.github/skills/**` or the workflow itself change. It installs [waza](https://github.com/microsoft/waza) with a pinned version and SHA-256 checksum, checks that every skill is ready, counts its tokens and compares the result with the base branch: any skill file that grows more than 10% fails the check (new files are exempt). On PRs from this repository it keeps a single sticky comment with the result table.

## Relation with the factory

Changes to skills, hooks and MCP are `🏭 software-factory` changes: a person always reviews them. See [Software factory](software-factory.md).

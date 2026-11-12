# multiinstance-jira-mcp

A [Model Context Protocol](https://modelcontextprotocol.io) server that connects AI assistants (Claude, Cursor, VS Code Copilot, OpenCode, …) to **any number of Jira sites at the same time**: Jira Cloud and Jira Data Center / Server, each with its own authentication method:

| Method | Use it for | How it authenticates |
|---|---|---|
| **API token** (`basic`) | Jira Cloud | `email` + [API token](https://id.atlassian.com/manage-profile/security/api-tokens) |
| **Personal access token** (`bearer`) | Jira Data Center / Server 8.14+ | PAT sent as `Authorization: Bearer` |
| **Browser SSO** (`browser`) | Any site behind SAML / OIDC / corporate SSO where tokens are not allowed | A real browser window opens, you sign in, the Jira session cookies are stored per instance |

You can pass tokens **as command-line arguments**, environment variables, a config file, or add instances while the server is running.

## What makes it different

- **1..N instances in one server.** A Cloud site with an API token, an internal Data Center with a PAT and a partner's Jira behind SSO can all be configured together.
- **Automatic routing.** Every call is sent to the right instance using, in order: the `instance` argument → a `name:KEY-1` prefix → the host of a pasted issue URL → project-key mapping → the default instance → the only instance. If a call is ambiguous, the server asks for the instance and names the options.
- **Search across instances.** `jira_search` and `jira_list_projects` accept `allInstances: true` (or a list of instances) and return results grouped per instance. If one instance fails, you still get the results from the others.
- **Copy between instances.** `jira_copy_issue` copies an issue from one site to another and adds a link back to the original on each issue.
- **Independent sessions.** Each browser-auth instance has its own cookie jar and its own browser profile. Logins don't block tool calls, and a `login` run from a terminal is picked up by a running server without a restart.
- **Cloud and Data Center differences handled for you.** This covers REST v3 vs v2, ADF vs plain-text descriptions, `/search/jql` vs `/search`, and `accountId` vs `username`.
- **Read-only mode.** You can turn off writes globally or for one instance.

---

## Quick start

Requires **Node.js 20+**.

### One Jira Cloud site (API token)

```bash
npx -y multiinstance-jira-mcp --url https://acme.atlassian.net --email me@acme.com --token "$JIRA_API_TOKEN"
```

### Several sites at once

```bash
npx -y multiinstance-jira-mcp \
  --instance cloud   --url https://acme.atlassian.net   --email me@acme.com --token "$CLOUD_TOKEN" --projects WEB,APP \
  --instance dc      --url https://jira.corp.local/jira --token "$DC_PAT"   --projects OPS,INFRA \
  --instance partner --url https://jira.partner.com     --auth browser \
  --default-instance cloud
```

Each `--instance <name>` starts a new block. The flags after it (`--url`, `--email`, `--token`, `--auth`, …) apply to that instance until the next `--instance`.

### Browser SSO

Install a browser for Playwright once. You can skip this step if you set `--browser-channel chrome` to use your installed Chrome or Edge.

```bash
npx playwright install chromium
```

Then either ask the assistant to *"log in to the partner Jira"*, which calls `jira_login`, or run the login from a terminal:

```bash
npx -y multiinstance-jira-mcp login partner --instance partner --url https://jira.partner.com --auth browser
```

---

## Client configuration

The server speaks MCP over **stdio**. Your client starts it, so you normally don't run it by hand.

<details open>
<summary><b>Claude Desktop / Claude Code</b> (<code>claude_desktop_config.json</code> / <code>.mcp.json</code>)</summary>

```json
{
  "mcpServers": {
    "jira": {
      "command": "npx",
      "args": [
        "-y", "multiinstance-jira-mcp",
        "--instance", "cloud", "--url", "https://acme.atlassian.net", "--email", "me@acme.com", "--token", "ATATT3x...",
        "--instance", "corp",  "--url", "https://jira.corp.local",    "--auth", "browser", "--projects", "OPS"
      ]
    }
  }
}
```
</details>

<details>
<summary><b>Cursor</b> (<code>~/.cursor/mcp.json</code>) — secrets in <code>env</code></summary>

```json
{
  "mcpServers": {
    "jira": {
      "command": "npx",
      "args": ["-y", "multiinstance-jira-mcp"],
      "env": {
        "JIRA_INSTANCES": "cloud,corp",
        "JIRA_CLOUD_URL": "https://acme.atlassian.net",
        "JIRA_CLOUD_EMAIL": "me@acme.com",
        "JIRA_CLOUD_API_TOKEN": "ATATT3x...",
        "JIRA_CORP_URL": "https://jira.corp.local",
        "JIRA_CORP_PAT": "NjM2...",
        "JIRA_CORP_PROJECTS": "OPS,INFRA",
        "JIRA_DEFAULT_INSTANCE": "cloud"
      }
    }
  }
}
```
</details>

<details>
<summary><b>VS Code / GitHub Copilot</b> (<code>.vscode/mcp.json</code>) — prompts for the token</summary>

```json
{
  "inputs": [
    { "id": "cloudToken", "type": "promptString", "description": "Jira Cloud API token", "password": true }
  ],
  "servers": {
    "jira": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y", "multiinstance-jira-mcp",
        "--instance", "cloud", "--url", "https://acme.atlassian.net", "--email", "me@acme.com", "--token", "${input:cloudToken}",
        "--instance", "corp", "--url", "https://jira.corp.local", "--auth", "browser"
      ]
    }
  }
}
```
</details>

<details>
<summary><b>OpenCode</b> (<code>opencode.json</code>)</summary>

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "jira": {
      "type": "local",
      "command": ["npx", "-y", "multiinstance-jira-mcp", "--config", "~/.multiinstance-jira-mcp/config.json"],
      "enabled": true,
      "environment": {
        "JIRA_CLOUD_TOKEN": "ATATT3x..."
      }
    }
  }
}
```
</details>

More ready-to-copy files live in [`examples/`](examples).

---

## Configuring instances

There are three startup sources. They are merged **per instance name, field by field**. The highest priority wins:

1. **CLI flags** (`--instance …`)
2. **Environment variables**
3. **Config file** (`--config`, `JIRA_MCP_CONFIG`, or `~/.multiinstance-jira-mcp/config.json` if it exists)

So you can, for example, keep URLs in a config file and pass only the tokens as arguments. You can also add instances while the server is running with the `jira_add_instance` tool. Those are kept in memory for the current session only.

### Instance fields

| Field | CLI flag | Env suffix (`JIRA_<NAME>_…`) | Description |
|---|---|---|---|
| `name` | `--instance <name>` | listed in `JIRA_INSTANCES` | Unique id (`a-z 0-9 - _`). |
| `url` | `--url` | `URL`, `BASE_URL` | Base URL, including context path if any (`https://host/jira`). |
| `email` | `--email`, `--username` | `EMAIL`, `USERNAME` | Account email (Cloud) or username (DC basic auth). |
| `token` | `--token`, `--api-token`, `--pat` | `API_TOKEN`, `TOKEN`, `PAT` | API token, PAT, or DC password. |
| `tokenEnv` | `--token-env` | `TOKEN_ENV` | Name of an env var that holds the token. Use it to keep secrets out of files. |
| `auth` | `--auth` | `AUTH` | `basic`, `bearer` or `browser`. **Inferred:** email+token → `basic`, token → `bearer`, neither → `browser`. |
| `deployment` | `--deployment` | `DEPLOYMENT` | `cloud` or `server`. Inferred from the host (`*.atlassian.net` → cloud). |
| `apiVersion` | `--api-version` | `API_VERSION` | `3` (cloud default) or `2` (server default). |
| `projects` | `--projects` | `PROJECTS` | Project keys on this instance, used for automatic routing. |
| `defaultProject` | `--default-project` | `DEFAULT_PROJECT` | Project used by `jira_create_issue` when none is given. |
| `loginUrl` | `--login-url` | `LOGIN_URL` | Page opened for browser login (default: base URL). |
| `description` | `--description` | `DESCRIPTION` | Free text shown to the assistant ("client X, production support"). |
| `readOnly` | `--instance-read-only` | `READ_ONLY` | Disable write tools on this instance. |

Instance flags given before any `--instance` configure an instance called `default`.

### Environment variables

**Single instance:**

```bash
JIRA_BASE_URL=https://acme.atlassian.net   # or JIRA_URL
JIRA_EMAIL=me@acme.com
JIRA_API_TOKEN=ATATT3x...
JIRA_INSTANCE_NAME=acme                     # optional, default "default"
```

**Many instances:** list the names, then prefix every field with `JIRA_<NAME>_`. The name is upper-cased, and anything that isn't a letter or digit becomes `_`.

```bash
JIRA_INSTANCES=cloud,client-a
JIRA_CLOUD_URL=https://acme.atlassian.net
JIRA_CLOUD_EMAIL=me@acme.com
JIRA_CLOUD_API_TOKEN=ATATT3x...
JIRA_CLIENT_A_URL=https://jira.client-a.com
JIRA_CLIENT_A_AUTH=browser
JIRA_CLIENT_A_PROJECTS=CLA
```

`JIRA_INSTANCES` also accepts JSON in the same format as `instances` in the config file.

> If `JIRA_BASE_URL`/`JIRA_URL` is set in your shell for other tools, it creates a `default` instance. Unset it in the MCP client's environment if you don't want that.

### Config file

```json
{
  "defaultInstance": "cloud",
  "loginTimeoutSeconds": 300,
  "instances": {
    "cloud": {
      "url": "https://acme.atlassian.net",
      "email": "me@acme.com",
      "tokenEnv": "JIRA_CLOUD_TOKEN",
      "projects": ["WEB", "APP"],
      "description": "Product development"
    },
    "corp": {
      "url": "https://jira.corp.local/jira",
      "tokenEnv": "JIRA_CORP_PAT",
      "projects": ["OPS", "INFRA"]
    },
    "partner": {
      "url": "https://jira.partner.com",
      "auth": "browser",
      "readOnly": true
    }
  }
}
```

`instances` can also be an array of objects with a `name` field. See [`examples/config.example.json`](examples/config.example.json).

### Global settings

| Setting | CLI | Env | Config file | Default |
|---|---|---|---|---|
| Config file | `--config` | `JIRA_MCP_CONFIG` | — | `<home>/config.json` if present |
| State directory | `--home` | `JIRA_MCP_HOME` | — | `~/.multiinstance-jira-mcp` |
| Default instance | `--default-instance` | `JIRA_DEFAULT_INSTANCE` | `defaultInstance` | — |
| Global read-only | `--read-only` | `JIRA_READ_ONLY` | `readOnly` | `false` |
| Browser login timeout (s) | `--login-timeout` | `JIRA_LOGIN_TIMEOUT_SECONDS` | `loginTimeoutSeconds` | `300` |
| Browser channel | `--browser-channel` | `JIRA_BROWSER_CHANNEL` | `browserChannel` | bundled Chromium, then Chrome, then Edge |
| Keep-alive interval (s, 0 = off) | `--keepalive` | `JIRA_KEEPALIVE_SECONDS` | `keepAliveSeconds` | `300` |
| Max attachment size (bytes) | — | `JIRA_MAX_ATTACHMENT_BYTES` | `maxAttachmentBytes` | 20 MiB |
| Log level | `--log-level` | `JIRA_MCP_LOG_LEVEL` | — | `info` |

---

## How routing works

Every tool takes an optional `instance` argument. Issue arguments also accept extended references:

| You pass | Routed to |
|---|---|
| `instance: "corp"` | `corp` |
| `"corp:OPS-12"` | `corp` |
| `"https://jira.corp.local/jira/browse/OPS-12"` | the instance whose URL matches that host and path |
| `"OPS-12"` with `corp` configured with `projects: ["OPS"]` | `corp` |
| anything else | the default instance, or the only instance |

If none of these rules matches and several instances exist, the tool returns an error listing the instances. The assistant can then ask you which one to use.

---

## Browser SSO in detail

- `jira_login` opens a **visible** Chromium/Chrome window on the Jira URL (or `loginUrl`). You complete SSO, MFA and anything else the identity provider asks for.
- While you sign in, the server checks `GET /rest/api/<v>/myself` with the browser's own cookie jar. As soon as Jira accepts the session, it stores only the cookies that belong to the Jira host. The file is `~/.multiinstance-jira-mcp/instances/<name>/session.json`, with permissions `0600`.
- Each instance has a **persistent browser profile**, so the identity provider usually remembers you and later logins take one click.
- MCP clients often time out long tool calls, so `jira_login` waits for `waitSeconds` (120 by default). After that it returns and the window stays open. The login finishes in the background, and calling `jira_login` again reports the result.
- A **keep-alive** loop pings each browser session regularly so idle sessions don't expire. Cookies the server rotates (for example a refreshed `JSESSIONID`) are saved automatically. Once the identity provider's session really expires, you need to log in interactively again.
- CLI equivalents: `multiinstance-jira-mcp login <instance>` and `multiinstance-jira-mcp logout <instance> [--forget-profile]`.

---

## Tools

All tools accept `instance` unless noted otherwise. Issue parameters accept `KEY-1`, `instance:KEY-1` or a browse URL.

### Instances and authentication

| Tool | Description |
|---|---|
| `jira_list_instances` | Configured instances, auth method, mapped projects, session state, default instance. |
| `jira_whoami` | Checks credentials by calling `/myself`. With no argument it checks all instances in parallel. |
| `jira_login` | Interactive browser SSO login for `browser` instances. |
| `jira_logout` | Deletes a stored session. Optionally also wipes the browser profile. |
| `jira_add_instance` | Registers a new instance at runtime (URL, auth, token, projects, …) and tests the connection. |
| `jira_remove_instance` | Removes an instance from the session. |
| `jira_set_default_instance` | Sets or clears the fallback instance. |

### Issues

| Tool | Description |
|---|---|
| `jira_search` | JQL search on one instance, several instances or all of them (`allInstances`). Supports extra `fields` and pagination. |
| `jira_get_issue` | Compact view of an issue: description as text, subtasks, links, latest comments. `raw: true` returns the full JSON. |
| `jira_create_issue` | Creates an issue. Description in light Markdown. Optional parent, labels, priority, assignee, components, due date, custom fields. |
| `jira_update_issue` | Changes only the fields you pass, including custom fields. |
| `jira_delete_issue` | Deletes an issue (marked destructive). |
| `jira_assign_issue` | Assigns to `me`, an email, an accountId or a username. `none` unassigns. |
| `jira_get_transitions` / `jira_transition_issue` | Lists the available transitions, or moves the issue by transition id, transition name or target status, with an optional comment. |
| `jira_get_comments` / `jira_add_comment` | Reads or writes comments. Comment text accepts Markdown. |
| `jira_add_attachment` | Attaches a file from a public URL or a local path. |
| `jira_copy_issue` | Copies an issue to another instance or project, optionally with comments and back-links. |

### Metadata

| Tool | Description |
|---|---|
| `jira_list_projects` | Projects, on one instance or several (`allInstances`). |
| `jira_list_boards` / `jira_list_sprints` | Jira Software boards and sprints. |
| `jira_list_issue_types` / `jira_list_statuses` | Issue types and statuses, globally or per project. |
| `jira_search_users` | User search, or assignable users for a project. |

**Rich text:** on REST v3 instances (Cloud), Markdown in descriptions and comments is converted to Atlassian Document Format (headings, lists, code blocks, quotes, bold, inline code, links). On REST v2 instances the text is sent as-is, so you can use Jira wiki markup there.

---

## Files on disk

```
~/.multiinstance-jira-mcp/            (override with --home / JIRA_MCP_HOME)
├── config.json                       optional config file
└── instances/
    └── <name>/
        ├── session.json              browser-session cookies (0600)
        └── browser-profile/          persistent browser profile for SSO
```

The server never writes tokens to disk.

## Security

- Treat `session.json` like a password: it gives the same access as your browser session.
- Prefer `tokenEnv`, environment variables or your client's secret prompts (such as VS Code `inputs`) over writing tokens into config files.
- Tokens passed to `jira_add_instance` go through the AI assistant. Use that tool only for quick tests.
- Tokens are masked in logs, and `jira_list_instances` never returns them.
- Use `--read-only` or `readOnly` per instance for exploration and production sites.
- `jira_add_attachment` with `filePath` reads files available to the user running the server.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Several Jira instances are configured …` | Pass `instance`, use `name:KEY-1`, map `projects`, or set a default instance. |
| `401` on a Cloud instance | Check the email and API token pair. API tokens only work on Cloud. |
| `401` on Data Center with a token | Check the PAT, or use `--auth basic --email <username> --token <password>` on older versions without PATs. |
| `received an HTML page instead of JSON` | The SSO session expired or a proxy redirected the request. Run `jira_login` again. |
| `Could not launch a browser` | `npx playwright install chromium`, or `--browser-channel chrome`. |
| `jira_login` returns before you finish | This is expected. Finish in the browser, then call `jira_login` again. |
| Wrong REST version | Set `apiVersion` (`2` or `3`) for that instance. |
| `410` on search | Handled automatically: the server falls back between `/search` and `/search/jql`. |

Set `--log-level debug` to log every request (method and path) to stderr.

---

## Development

```bash
npm install
npm run typecheck
npm test            # vitest: CLI, config merge, routing, cookies, ADF, REST client, MCP end-to-end
npm run build       # → dist/
npm run dev -- --instance cloud --url https://acme.atlassian.net --email me@acme.com --token "$TOKEN"
npm run inspect     # MCP Inspector against dist/index.js
```

Project layout:

```
src/
├── index.ts                 entry point & CLI subcommands (serve, login, logout, instances)
├── cli.ts                   argument parser (instance-scoped flag blocks)
├── server.ts                McpServer + dynamic instructions
├── config/                  types, normalisation/inference, multi-source loading
├── auth/                    auth providers, cookie jar, Playwright browser login
├── instances/               registry & routing, login manager, keep-alive
├── jira/                    REST client, ADF <-> text, compact formatting
└── tools/                   MCP tool definitions (instances, issues, metadata, transfer)
tests/                       vitest suites with a fake Jira
```

## Acknowledgements

Inspired by the browser-SSO idea in [`@svasimahmed283/jira-mcp`](https://www.npmjs.com/package/@svasimahmed283/jira-mcp). This project is an independent implementation built around multi-instance support and token authentication.

## License

[MIT](LICENSE)

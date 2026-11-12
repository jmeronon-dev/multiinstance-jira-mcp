import { UserError } from "./errors.js";
import type { InstanceInput } from "./config/types.js";

export type Command = "serve" | "login" | "logout" | "instances" | "help" | "version";

export interface CliOptions {
  command: Command;
  commandArgs: string[];
  configFile?: string;
  homeDir?: string;
  defaultInstance?: string;
  readOnly?: boolean;
  loginTimeoutSeconds?: number;
  browserChannel?: string;
  keepAliveSeconds?: number;
  logLevel?: string;
  /** `logout` only: also wipe the dedicated browser profile. */
  forgetProfile?: boolean;
  /** Instances declared with `--instance <name> [instance flags...]`, in order. */
  instances: InstanceInput[];
}

/** Flags that configure the instance currently being declared. */
const INSTANCE_FLAGS: Record<string, keyof InstanceInput> = {
  url: "url",
  "base-url": "url",
  email: "email",
  user: "email",
  username: "email",
  token: "token",
  "api-token": "token",
  pat: "token",
  "token-env": "tokenEnv",
  auth: "auth",
  deployment: "deployment",
  "api-version": "apiVersion",
  projects: "projects",
  "default-project": "defaultProject",
  "login-url": "loginUrl",
  description: "description",
  "instance-read-only": "readOnly",
};

const COMMANDS: Record<string, Command> = {
  serve: "serve",
  start: "serve",
  login: "login",
  logout: "logout",
  instances: "instances",
  list: "instances",
  help: "help",
  version: "version",
};

export const DEFAULT_INSTANCE_NAME = "default";

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { command: "serve", commandArgs: [], instances: [] };
  let commandSeen = false;
  let current: InstanceInput | undefined;

  const instanceFor = (): InstanceInput => {
    if (current) return current;
    // Instance flags used before any --instance apply to the implicit "default" instance.
    let implicit = options.instances.find((i) => i.name === DEFAULT_INSTANCE_NAME);
    if (!implicit) {
      implicit = { name: DEFAULT_INSTANCE_NAME };
      options.instances.push(implicit);
    }
    return implicit;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;

    if (!arg.startsWith("-") || arg === "-") {
      if (!commandSeen && COMMANDS[arg]) {
        options.command = COMMANDS[arg]!;
        commandSeen = true;
      } else if (commandSeen) {
        options.commandArgs.push(arg);
      } else {
        throw new UserError(`Unknown command "${arg}". Run with --help to see usage.`);
      }
      continue;
    }

    if (arg === "-h" || arg === "--help") {
      options.command = "help";
      continue;
    }
    if (arg === "-v" || arg === "--version") {
      options.command = "version";
      continue;
    }

    const eq = arg.indexOf("=");
    const flag = (eq === -1 ? arg : arg.slice(0, eq)).replace(/^--?/, "");
    const inline = eq === -1 ? undefined : arg.slice(eq + 1);

    const takeValue = (): string => {
      if (inline !== undefined) return inline;
      const next = argv[i + 1];
      if (next === undefined || (next.startsWith("--") && next.length > 2)) {
        throw new UserError(`Flag --${flag} requires a value.`);
      }
      i++;
      return next;
    };

    switch (flag) {
      case "instance":
      case "jira": {
        const name = takeValue();
        const existing = options.instances.find((x) => x.name === name);
        current = existing ?? { name };
        if (!existing) options.instances.push(current);
        break;
      }
      case "config":
        options.configFile = takeValue();
        break;
      case "home":
        options.homeDir = takeValue();
        break;
      case "default-instance":
        options.defaultInstance = takeValue();
        break;
      case "read-only":
        options.readOnly = inline === undefined ? true : !["false", "0", "no"].includes(inline.toLowerCase());
        break;
      case "login-timeout":
        options.loginTimeoutSeconds = toInt(flag, takeValue());
        break;
      case "browser-channel":
        options.browserChannel = takeValue();
        break;
      case "keepalive":
      case "keep-alive":
        options.keepAliveSeconds = toInt(flag, takeValue());
        break;
      case "log-level":
        options.logLevel = takeValue();
        break;
      case "forget-profile":
        options.forgetProfile = true;
        break;
      default: {
        const field = INSTANCE_FLAGS[flag];
        if (!field) throw new UserError(`Unknown flag --${flag}. Run with --help to see usage.`);
        if (field === "readOnly" && inline === undefined) {
          instanceFor().readOnly = true;
        } else {
          (instanceFor() as Record<string, unknown>)[field] = takeValue();
        }
      }
    }
  }

  return options;
}

function toInt(flag: string, value: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) throw new UserError(`Flag --${flag} expects a number, got "${value}".`);
  return n;
}

export const USAGE = `multiinstance-jira-mcp — MCP server for one or many Jira sites

Usage:
  multiinstance-jira-mcp [serve] [options]      Start the MCP server on stdio (default)
  multiinstance-jira-mcp login [instance]       Open a browser and capture an SSO session
  multiinstance-jira-mcp logout [instance]      Delete a stored browser session
                                                (--forget-profile also wipes the browser profile)
  multiinstance-jira-mcp instances              List configured instances and their status
  multiinstance-jira-mcp help | version

Global options:
  --config <file>             JSON config file (default: <home>/config.json if present)
  --home <dir>                State directory (default: ~/.multiinstance-jira-mcp)
  --default-instance <name>   Instance used when a call cannot be routed automatically
  --read-only                 Disable every write operation on every instance
  --login-timeout <seconds>   How long browser login waits for you (default 300)
  --browser-channel <name>    Playwright channel: chromium (default), chrome, msedge
  --keepalive <seconds>       Browser-session keep-alive interval, 0 disables (default 300)
  --log-level <level>         debug | info | warn | error | silent

Instance options (repeat the block once per Jira site):
  --instance <name>           Start declaring an instance; following flags apply to it
    --url <url>               Base URL, e.g. https://acme.atlassian.net
    --email <email>           Account email/username (enables basic auth with --token)
    --token <token>           API token (Cloud) or personal access token (Data Center)
    --token-env <VAR>         Read the token from this environment variable
    --auth <type>             basic | bearer | browser (inferred when omitted)
    --deployment <type>       cloud | server (inferred from the host)
    --api-version <2|3>       REST API version (cloud: 3, server: 2)
    --projects <K1,K2>        Project keys hosted here (routes issue keys automatically)
    --default-project <KEY>   Project used by jira_create_issue when none is given
    --login-url <url>         Page opened for browser login (default: base URL)
    --description <text>      Human description shown to the assistant
    --instance-read-only      Disable write operations on this instance only

Instance flags used before any --instance configure an instance named "default".

Examples:
  multiinstance-jira-mcp --url https://acme.atlassian.net --email me@acme.com --token $TOKEN

  multiinstance-jira-mcp \\
    --instance cloud --url https://acme.atlassian.net --email me@acme.com --token $CLOUD_TOKEN \\
    --instance dc    --url https://jira.corp.local --token $DC_PAT --projects OPS,INFRA \\
    --instance sso   --url https://jira.partner.com --auth browser
`;

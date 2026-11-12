#!/usr/bin/env node
import fs from "node:fs";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { parseArgs, USAGE, type CliOptions } from "./cli.js";
import { loadConfig } from "./config/load.js";
import { errorMessage } from "./errors.js";
import { startKeepAlive } from "./instances/keepalive.js";
import { LoginManager } from "./instances/login-manager.js";
import { InstanceRegistry } from "./instances/registry.js";
import { log } from "./logger.js";
import { browserProfileDir } from "./paths.js";
import { createServer } from "./server.js";
import { VERSION } from "./version.js";

async function serve(cli: CliOptions): Promise<void> {
  const app = loadConfig(cli);
  const registry = new InstanceRegistry(app);
  const logins = new LoginManager(app);
  const server = createServer(registry, app, logins);

  if (registry.list().length === 0) {
    log.warn("No Jira instances configured; the assistant can add them with jira_add_instance.");
  } else {
    log.info(
      `Serving ${registry.list().length} Jira instance(s): ${registry
        .list()
        .map((i) => `${i.name} [${i.config.auth}]`)
        .join(", ")}${registry.defaultInstance ? ` (default: ${registry.defaultInstance})` : ""}`,
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  const stopKeepAlive = startKeepAlive(registry, app.keepAliveSeconds);

  const shutdown = async () => {
    stopKeepAlive();
    await server.close().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.stdin.on("close", shutdown);
}

async function login(cli: CliOptions): Promise<void> {
  const app = loadConfig(cli);
  const registry = new InstanceRegistry(app);
  const name = cli.commandArgs[0];
  const browserInstances = registry.list().filter((i) => i.config.auth === "browser");
  const instance = name
    ? registry.get(name)
    : browserInstances.length === 1
      ? browserInstances[0]!
      : registry.resolve().instance;

  process.stdout.write(`Opening a browser for "${instance.name}" (${instance.config.baseUrl})...\n`);
  const result = await new LoginManager(app).start(instance);
  process.stdout.write(`${result.message}\n`);
  if (!result.ok) process.exitCode = 1;
}

function logout(cli: CliOptions): void {
  const app = loadConfig(cli);
  const registry = new InstanceRegistry(app);
  const instance = registry.resolve({ instance: cli.commandArgs[0] }).instance;
  const removed = instance.cookies.clear();
  if (cli.forgetProfile) {
    fs.rmSync(browserProfileDir(app.homeDir, instance.name), { recursive: true, force: true });
  }
  process.stdout.write(`${removed ? "Removed" : "No"} stored session for "${instance.name}".\n`);
}

async function listInstances(cli: CliOptions): Promise<void> {
  const app = loadConfig(cli);
  const registry = new InstanceRegistry(app);
  if (registry.list().length === 0) {
    process.stdout.write("No Jira instances configured.\n");
    return;
  }
  process.stdout.write(`Home: ${app.homeDir}${app.configFile ? `\nConfig file: ${app.configFile}` : ""}\n\n`);
  for (const instance of registry.list()) {
    let status: string;
    try {
      const me = await instance.client.myself();
      status = `OK as ${me.displayName ?? me.name ?? me.accountId}`;
    } catch (e) {
      status = `ERROR ${errorMessage(e).split("\n")[0]}`;
    }
    const isDefault = registry.defaultInstance === instance.name ? " (default)" : "";
    process.stdout.write(
      `${instance.name}${isDefault}\n  url:     ${instance.config.baseUrl}\n  type:    ${instance.config.deployment}, REST v${instance.config.apiVersion}\n  auth:    ${instance.auth.describe()}\n  status:  ${status}\n` +
        (instance.config.projectKeys.length ? `  projects: ${instance.config.projectKeys.join(", ")}\n` : "") +
        "\n",
    );
  }
}

async function main(argv: string[]): Promise<void> {
  const cli = parseArgs(argv);
  log.setLevel(cli.logLevel);
  switch (cli.command) {
    case "help":
      process.stdout.write(USAGE);
      return;
    case "version":
      process.stdout.write(`${VERSION}\n`);
      return;
    case "login":
      return login(cli);
    case "logout":
      return logout(cli);
    case "instances":
      return listInstances(cli);
    case "serve":
      return serve(cli);
  }
}

main(process.argv.slice(2)).catch((e) => {
  log.error(errorMessage(e));
  process.exit(1);
});

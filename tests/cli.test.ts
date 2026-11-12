import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/cli.js";

describe("parseArgs", () => {
  it("defaults to serve with no instances", () => {
    expect(parseArgs([])).toEqual({ command: "serve", commandArgs: [], instances: [] });
  });

  it("groups instance flags after each --instance", () => {
    const cli = parseArgs([
      "--instance",
      "cloud",
      "--url",
      "https://acme.atlassian.net",
      "--email",
      "me@acme.com",
      "--token",
      "ATATT3x=abc==",
      "--instance=dc",
      "--url=https://jira.corp.local",
      "--pat",
      "dc-token",
      "--projects",
      "OPS,INFRA",
      "--instance-read-only",
    ]);
    expect(cli.instances).toEqual([
      { name: "cloud", url: "https://acme.atlassian.net", email: "me@acme.com", token: "ATATT3x=abc==" },
      { name: "dc", url: "https://jira.corp.local", token: "dc-token", projects: "OPS,INFRA", readOnly: true },
    ]);
  });

  it("applies instance flags before any --instance to the implicit default instance", () => {
    const cli = parseArgs(["--url", "https://x.atlassian.net", "--token", "t0k3n-value", "--read-only"]);
    expect(cli.instances).toEqual([{ name: "default", url: "https://x.atlassian.net", token: "t0k3n-value" }]);
    expect(cli.readOnly).toBe(true);
  });

  it("parses subcommands and global options", () => {
    const cli = parseArgs(["login", "sso", "--login-timeout", "60", "--browser-channel", "chrome"]);
    expect(cli.command).toBe("login");
    expect(cli.commandArgs).toEqual(["sso"]);
    expect(cli.loginTimeoutSeconds).toBe(60);
    expect(cli.browserChannel).toBe("chrome");
  });

  it("rejects unknown flags and missing values", () => {
    expect(() => parseArgs(["--nope"])).toThrow(/Unknown flag/);
    expect(() => parseArgs(["--token"])).toThrow(/requires a value/);
    expect(() => parseArgs(["--instance", "a", "--url", "--token", "x"])).toThrow(/requires a value/);
  });

  it("recognises help and version", () => {
    expect(parseArgs(["--help"]).command).toBe("help");
    expect(parseArgs(["-v"]).command).toBe("version");
  });
});

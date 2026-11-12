import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseArgs } from "../src/cli.js";
import { instancesFromEnv, loadConfig } from "../src/config/load.js";
import { inferDeployment, normalizeBaseUrl, toInstanceConfig } from "../src/config/normalize.js";

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "mijm-config-"));
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

describe("toInstanceConfig", () => {
  it("infers basic auth, cloud deployment and REST v3 for atlassian.net", () => {
    const cfg = toInstanceConfig({ name: "Work", url: "https://acme.atlassian.net/", email: "a@b.c", token: "secret-token" });
    expect(cfg).toMatchObject({
      name: "work",
      baseUrl: "https://acme.atlassian.net",
      auth: "basic",
      deployment: "cloud",
      apiVersion: 3,
      readOnly: false,
    });
  });

  it("infers bearer auth, server deployment and REST v2 for self-hosted", () => {
    const cfg = toInstanceConfig({ name: "dc", url: "https://jira.corp.local/jira", token: "pat-123456" });
    expect(cfg).toMatchObject({ auth: "bearer", deployment: "server", apiVersion: 2, baseUrl: "https://jira.corp.local/jira" });
  });

  it("defaults to browser auth without credentials and drops tokens for browser auth", () => {
    expect(toInstanceConfig({ name: "sso", url: "https://jira.x.com" }).auth).toBe("browser");
    const cfg = toInstanceConfig({ name: "sso", url: "https://jira.x.com", auth: "sso", token: "ignored-token" });
    expect(cfg.auth).toBe("browser");
    expect(cfg.token).toBeUndefined();
  });

  it("reads the token from tokenEnv", () => {
    const cfg = toInstanceConfig({ name: "a", url: "https://a.atlassian.net", email: "e@x", tokenEnv: "MY_TOKEN" }, {
      MY_TOKEN: "from-env-token",
    });
    expect(cfg.token).toBe("from-env-token");
  });

  it("validates input", () => {
    expect(() => toInstanceConfig({ name: "a" })).toThrow(/no URL/);
    expect(() => toInstanceConfig({ name: "a", url: "ftp://x" })).toThrow(/protocol/);
    expect(() => toInstanceConfig({ name: "a", url: "https://x", auth: "basic", token: "t" })).toThrow(/email/);
    expect(() => toInstanceConfig({ name: "a", url: "https://x", auth: "magic" })).toThrow(/unknown auth/);
    expect(() => toInstanceConfig({ name: "a", url: "https://x", apiVersion: 4 })).toThrow(/apiVersion/);
  });

  it("normalises project keys", () => {
    const cfg = toInstanceConfig({ name: "a", url: "https://x", projects: "abc, def;ABC", defaultProject: "abc" });
    expect(cfg.projectKeys).toEqual(["ABC", "DEF"]);
    expect(cfg.defaultProject).toBe("ABC");
  });
});

describe("helpers", () => {
  it("normalizeBaseUrl strips trailing slashes, query and hash", () => {
    expect(normalizeBaseUrl("https://x.com/jira/?a=1#b")).toBe("https://x.com/jira");
  });
  it("inferDeployment", () => {
    expect(inferDeployment("https://acme.atlassian.net")).toBe("cloud");
    expect(inferDeployment("https://jira.acme.com")).toBe("server");
  });
});

describe("instancesFromEnv", () => {
  it("reads a single instance", () => {
    expect(instancesFromEnv({ JIRA_BASE_URL: "https://a.atlassian.net", JIRA_EMAIL: "e@a", JIRA_API_TOKEN: "tok" })).toEqual([
      { name: "default", url: "https://a.atlassian.net", email: "e@a", token: "tok" },
    ]);
  });

  it("reads named instances from JIRA_INSTANCES", () => {
    const env = {
      JIRA_INSTANCES: "work, client-a",
      JIRA_WORK_URL: "https://work.atlassian.net",
      JIRA_WORK_TOKEN: "t1",
      JIRA_CLIENT_A_BASE_URL: "https://jira.client.com",
      JIRA_CLIENT_A_AUTH: "browser",
      JIRA_CLIENT_A_PROJECTS: "CLI",
    };
    expect(instancesFromEnv(env)).toEqual([
      { name: "work", url: "https://work.atlassian.net", token: "t1" },
      { name: "client-a", url: "https://jira.client.com", auth: "browser", projects: "CLI" },
    ]);
  });

  it("reads JSON from JIRA_INSTANCES", () => {
    const env = { JIRA_INSTANCES: '{"a":{"url":"https://a.atlassian.net"}}' };
    expect(instancesFromEnv(env)).toEqual([{ name: "a", url: "https://a.atlassian.net" }]);
  });
});

describe("loadConfig", () => {
  it("merges file < env < CLI per instance name", () => {
    const file = path.join(home, "config.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        defaultInstance: "work",
        instances: {
          work: { url: "https://work.atlassian.net", email: "file@x", token: "file-token", projects: ["WRK"] },
          dc: { url: "https://jira.corp.local", auth: "browser" },
        },
      }),
    );
    const env = { JIRA_INSTANCES: "work", JIRA_WORK_EMAIL: "env@x" };
    const cli = parseArgs(["--home", home, "--instance", "work", "--token", "cli-token"]);
    const app = loadConfig(cli, env);

    expect(app.configFile).toBe(file);
    expect(app.defaultInstance).toBe("work");
    expect(app.instances.map((i) => i.name)).toEqual(["work", "dc"]);
    expect(app.instances[0]).toMatchObject({ email: "env@x", token: "cli-token", projectKeys: ["WRK"], auth: "basic" });
    expect(app.instances[1]).toMatchObject({ auth: "browser", deployment: "server" });
  });

  it("combines a CLI token with an env URL for the default instance", () => {
    const app = loadConfig(parseArgs(["--home", home, "--token", "only-token"]), { JIRA_URL: "https://jira.x.com" });
    expect(app.instances).toHaveLength(1);
    expect(app.instances[0]).toMatchObject({ name: "default", auth: "bearer", token: "only-token" });
  });

  it("applies global read-only and rejects an unknown default instance", () => {
    const app = loadConfig(parseArgs(["--home", home, "--read-only", "--url", "https://a.atlassian.net"]), {});
    expect(app.instances[0]!.readOnly).toBe(true);
    expect(() => loadConfig(parseArgs(["--home", home, "--default-instance", "nope"]), {})).toThrow(/not configured/);
  });

  it("allows starting with no instances", () => {
    expect(loadConfig(parseArgs(["--home", home]), {}).instances).toEqual([]);
  });
});

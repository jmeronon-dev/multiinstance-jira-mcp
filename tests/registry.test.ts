import os from "node:os";
import { describe, expect, it } from "vitest";
import { toInstanceConfig } from "../src/config/normalize.js";
import type { AppConfig, InstanceInput } from "../src/config/types.js";
import { InstanceRegistry, parseIssueRef } from "../src/instances/registry.js";

function app(instances: InstanceInput[], extra: Partial<AppConfig> = {}): AppConfig {
  return {
    instances: instances.map((i) => toInstanceConfig(i)),
    homeDir: os.tmpdir(),
    readOnly: false,
    loginTimeoutSeconds: 60,
    keepAliveSeconds: 0,
    maxAttachmentBytes: 1024,
    ...extra,
  };
}

const CLOUD = { name: "cloud", url: "https://acme.atlassian.net", email: "a@acme.com", token: "cloud-token", projects: "WEB,APP" };
const DC = { name: "dc", url: "https://jira.corp.local/jira", token: "dc-pat-token", projects: "OPS" };

describe("parseIssueRef", () => {
  it("parses keys, prefixed keys and URLs", () => {
    expect(parseIssueRef("web-12")).toEqual({ key: "WEB-12" });
    expect(parseIssueRef("DC:ops-1")).toEqual({ instance: "dc", key: "OPS-1" });
    expect(parseIssueRef("https://jira.corp.local/jira/browse/OPS-7?focused=1")).toEqual({
      key: "OPS-7",
      host: "jira.corp.local",
      path: "/jira",
    });
    expect(() => parseIssueRef("https://x.com/nothing")).toThrow(/issue key/);
  });
});

describe("InstanceRegistry.resolve", () => {
  const registry = new InstanceRegistry(app([CLOUD, DC]));

  it("uses the explicit instance", () => {
    expect(registry.resolve({ instance: "DC", issue: "WEB-1" }).instance.name).toBe("dc");
  });

  it("uses the instance prefix", () => {
    const r = registry.resolve({ issue: "cloud:OPS-3" });
    expect(r.instance.name).toBe("cloud");
    expect(r.issueKey).toBe("OPS-3");
  });

  it("uses the URL host", () => {
    expect(registry.resolve({ issue: "https://acme.atlassian.net/browse/ZZZ-1" }).instance.name).toBe("cloud");
    expect(() => registry.resolve({ issue: "https://other.net/browse/ZZZ-1" })).toThrow(/No configured instance/);
  });

  it("uses project mapping", () => {
    expect(registry.resolve({ issue: "OPS-99" }).instance.name).toBe("dc");
    expect(registry.resolve({ projectKey: "app" }).instance.name).toBe("cloud");
  });

  it("fails clearly when ambiguous", () => {
    expect(() => registry.resolve({ issue: "UNKNOWN-1" })).toThrow(/Several Jira instances/);
    expect(() => registry.resolve({ instance: "dc", issue: "cloud:X-1" })).toThrow(/Conflicting/);
  });

  it("falls back to the default and to a single instance", () => {
    const withDefault = new InstanceRegistry(app([CLOUD, DC], { defaultInstance: "dc" }));
    expect(withDefault.resolve({ issue: "UNKNOWN-1" }).instance.name).toBe("dc");
    const single = new InstanceRegistry(app([DC]));
    expect(single.resolve({ issue: "WEB-1" }).instance.name).toBe("dc");
  });

  it("errors when no instances exist", () => {
    expect(() => new InstanceRegistry(app([])).resolve()).toThrow(/No Jira instances/);
  });
});

describe("InstanceRegistry mutations", () => {
  it("adds, replaces, removes and enforces global read-only", () => {
    const registry = new InstanceRegistry(app([CLOUD], { readOnly: true }));
    registry.add(toInstanceConfig(DC));
    expect(registry.get("dc").config.readOnly).toBe(true);
    expect(() => registry.add(toInstanceConfig(DC))).toThrow(/already exists/);
    registry.add(toInstanceConfig({ ...DC, url: "https://jira2.corp.local" }), { replace: true });
    expect(registry.get("dc").config.baseUrl).toBe("https://jira2.corp.local");
    registry.setDefault("dc");
    registry.remove("dc");
    expect(registry.defaultInstance).toBeUndefined();
    expect(registry.names()).toEqual(["cloud"]);
  });

  it("describe() never leaks secrets", () => {
    const registry = new InstanceRegistry(app([CLOUD, DC]));
    const text = JSON.stringify(registry.list().map((i) => i.describe()));
    expect(text).not.toContain("cloud-token");
    expect(text).not.toContain("dc-pat-token");
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CookieStore } from "../src/auth/cookie-store.js";
import { createAuthProvider } from "../src/auth/providers.js";
import { toInstanceConfig } from "../src/config/normalize.js";
import type { InstanceInput } from "../src/config/types.js";
import { JiraHttpError, NotAuthenticatedError } from "../src/errors.js";
import { JiraClient } from "../src/jira/client.js";
import { fakeJira } from "./helpers/fake-jira.js";

function client(input: InstanceInput, routes: Parameters<typeof fakeJira>[0], cookieFile?: string) {
  const config = toInstanceConfig(input);
  const store = new CookieStore(cookieFile ?? path.join(os.tmpdir(), `mijm-${Math.random()}.json`));
  const fake = fakeJira(routes);
  return { client: new JiraClient(config, createAuthProvider(config, store), fake.fetchImpl), ...fake, store };
}

describe("JiraClient auth headers", () => {
  it("sends basic auth for email + token", async () => {
    const { client: c, requests } = client(
      { name: "c", url: "https://acme.atlassian.net", email: "me@acme.com", token: "tok-123" },
      { "GET acme.atlassian.net /rest/api/3/myself": () => ({ json: { accountId: "1" } }) },
    );
    await c.myself();
    expect(requests[0]!.headers.get("authorization")).toBe(`Basic ${Buffer.from("me@acme.com:tok-123").toString("base64")}`);
  });

  it("sends bearer auth for a PAT and honours a context path", async () => {
    const { client: c, requests } = client(
      { name: "d", url: "https://jira.corp.local/jira", token: "pat-xyz" },
      { "GET jira.corp.local /jira/rest/api/2/myself": () => ({ json: { name: "me" } }) },
    );
    await c.myself();
    expect(requests[0]!.headers.get("authorization")).toBe("Bearer pat-xyz");
  });

  it("sends only matching cookies for browser auth and asks for login when missing", async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mijm-")), "s.json");
    const { client: c, requests, store } = client(
      { name: "s", url: "https://jira.sso.com" },
      { "GET jira.sso.com /rest/api/2/myself": () => ({ json: { name: "me" } }) },
      file,
    );
    await expect(c.myself()).rejects.toBeInstanceOf(NotAuthenticatedError);
    store.save([
      { name: "JSESSIONID", value: "j", domain: "jira.sso.com", path: "/", expires: -1, secure: true },
      { name: "idp", value: "i", domain: "login.idp.com", path: "/", expires: -1, secure: true },
    ]);
    await c.myself();
    expect(requests[0]!.headers.get("cookie")).toBe("JSESSIONID=j");
  });
});

describe("JiraClient errors", () => {
  it("turns redirects and HTML login pages into 401 with an auth hint", async () => {
    const { client: c } = client(
      { name: "c", url: "https://acme.atlassian.net", email: "e@x", token: "tok-123" },
      {
        "GET acme.atlassian.net /rest/api/3/myself": () => ({ status: 302, headers: { location: "https://idp/login" } }),
        "GET acme.atlassian.net /rest/api/3/issue/A-1": () => ({ text: "<html>login</html>" }),
      },
    );
    await expect(c.myself()).rejects.toMatchObject({ status: 401 });
    await expect(c.getIssue("A-1")).rejects.toThrow(/API token/);
  });

  it("extracts Jira error messages", async () => {
    const { client: c } = client(
      { name: "c", url: "https://acme.atlassian.net", email: "e@x", token: "tok-123" },
      {
        "POST acme.atlassian.net /rest/api/3/issue": () => ({
          status: 400,
          json: { errorMessages: [], errors: { summary: "required" } },
        }),
      },
    );
    const error = await c.createIssue({}).catch((e) => e);
    expect(error).toBeInstanceOf(JiraHttpError);
    expect(error.message).toContain("summary: required");
    expect(error.message).toContain("[c]");
  });
});

describe("JiraClient.search", () => {
  it("uses /search/jql on Cloud", async () => {
    const { client: c, requests } = client(
      { name: "c", url: "https://acme.atlassian.net", email: "e@x", token: "tok-123" },
      {
        "POST acme.atlassian.net /rest/api/3/search/jql": () => ({
          json: { issues: [{ id: "1", key: "A-1" }], nextPageToken: "n", isLast: false },
        }),
      },
    );
    const page = await c.search({ jql: "project = A", maxResults: 500 });
    expect(page).toEqual({ issues: [{ id: "1", key: "A-1" }], nextPageToken: "n", isLast: false });
    expect(requests[0]!.body).toMatchObject({ jql: "project = A", maxResults: 100 });
  });

  it("uses /search on Data Center and falls back when missing", async () => {
    const { client: c, requests } = client(
      { name: "d", url: "https://jira.corp.local", token: "pat-123" },
      {
        "POST jira.corp.local /rest/api/2/search": () => ({ status: 404, json: {} }),
        "POST jira.corp.local /rest/api/2/search/jql": () => ({ json: { issues: [], isLast: true } }),
      },
    );
    const page = await c.search({ jql: "x", maxResults: 5 });
    expect(page.isLast).toBe(true);
    expect(requests.map((r) => r.url.pathname)).toEqual(["/rest/api/2/search", "/rest/api/2/search/jql"]);
  });
});

describe("JiraClient.listIssueLinkTypes", () => {
  it("uses the Cloud and Data Center API versions", async () => {
    const linkTypes = {
      issueLinkTypes: [{ id: "10000", name: "Blocks", inward: "is blocked by", outward: "blocks" }],
    };
    const cloud = client(
      { name: "c", url: "https://acme.atlassian.net", email: "e@x", token: "tok-123" },
      { "GET acme.atlassian.net /rest/api/3/issueLinkType": () => ({ json: linkTypes }) },
    );
    const dc = client(
      { name: "d", url: "https://jira.corp.local", token: "pat-123" },
      { "GET jira.corp.local /rest/api/2/issueLinkType": () => ({ json: linkTypes }) },
    );

    await expect(cloud.client.listIssueLinkTypes()).resolves.toEqual(linkTypes.issueLinkTypes);
    await expect(dc.client.listIssueLinkTypes()).resolves.toEqual(linkTypes.issueLinkTypes);
    expect(cloud.requests[0]!.url.pathname).toBe("/rest/api/3/issueLinkType");
    expect(dc.requests[0]!.url.pathname).toBe("/rest/api/2/issueLinkType");
  });
});

describe("JiraClient rich text and users", () => {
  it("sends ADF on v3 and plain text on v2", () => {
    const cloud = client({ name: "c", url: "https://a.atlassian.net", email: "e@x", token: "tok-123" }, {}).client;
    const dc = client({ name: "d", url: "https://jira.x.com", token: "pat-123" }, {}).client;
    expect(cloud.toRichText("hi")).toMatchObject({ type: "doc", version: 1 });
    expect(dc.toRichText("hi")).toBe("hi");
  });

  it("builds deployment-specific user references", async () => {
    const cloud = client({ name: "c", url: "https://a.atlassian.net", email: "e@x", token: "tok-123" }, {}).client;
    const dc = client({ name: "d", url: "https://jira.x.com", token: "pat-123" }, {}).client;
    expect(cloud.userRef(await cloud.resolveUser("5b10ac8d82e05b22cc7d4ef5"))).toEqual({ accountId: "5b10ac8d82e05b22cc7d4ef5" });
    expect(dc.userRef(await dc.resolveUser("jdoe"))).toEqual({ name: "jdoe" });
    expect(dc.userRef(null)).toEqual({ name: null });
  });

  it("resolves emails through user search", async () => {
    const { client: c } = client(
      { name: "c", url: "https://a.atlassian.net", email: "e@x", token: "tok-123" },
      {
        "GET a.atlassian.net /rest/api/3/user/search": () => ({
          json: [
            { accountId: "1", emailAddress: "ana@x.com", displayName: "Ana" },
            { accountId: "2", emailAddress: "anabel@x.com", displayName: "Anabel" },
          ],
        }),
      },
    );
    expect((await c.resolveUser("ana@x.com")).accountId).toBe("1");
  });
});

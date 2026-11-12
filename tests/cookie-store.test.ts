import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CookieStore, cookieAppliesTo, parseSetCookie, type StoredCookie } from "../src/auth/cookie-store.js";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mijm-cookies-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const cookie = (over: Partial<StoredCookie>): StoredCookie => ({
  name: "JSESSIONID",
  value: "abc",
  domain: "jira.acme.com",
  path: "/",
  expires: -1,
  secure: true,
  ...over,
});

describe("cookieAppliesTo", () => {
  const url = new URL("https://jira.acme.com/jira/rest/api/2/myself");
  it("matches domain, subdomain and path", () => {
    expect(cookieAppliesTo(cookie({}), url)).toBe(true);
    expect(cookieAppliesTo(cookie({ domain: ".acme.com" }), url)).toBe(true);
    expect(cookieAppliesTo(cookie({ path: "/jira" }), url)).toBe(true);
    expect(cookieAppliesTo(cookie({ path: "/jir" }), url)).toBe(false);
    expect(cookieAppliesTo(cookie({ domain: "idp.example.com" }), url)).toBe(false);
  });
  it("respects expiry and secure", () => {
    expect(cookieAppliesTo(cookie({ expires: 1 }), url)).toBe(false);
    expect(cookieAppliesTo(cookie({}), new URL("http://jira.acme.com/"))).toBe(false);
  });
});

describe("parseSetCookie", () => {
  it("parses attributes", () => {
    const parsed = parseSetCookie("sid=xyz; Path=/jira; Domain=acme.com; Secure; HttpOnly; Max-Age=60", new URL("https://jira.acme.com/x"), 1000);
    expect(parsed).toEqual({ name: "sid", value: "xyz", domain: ".acme.com", path: "/jira", expires: 1060, secure: true, httpOnly: true });
  });
});

describe("CookieStore", () => {
  it("saves with restrictive permissions, builds headers and absorbs rotations", () => {
    const store = new CookieStore(path.join(dir, "a", "session.json"));
    expect(store.headerFor(new URL("https://jira.acme.com/"))).toBeUndefined();

    store.save([cookie({}), cookie({ name: "other", value: "1", domain: "idp.example.com" })], "Ana");
    if (process.platform !== "win32") expect(fs.statSync(store.file).mode & 0o777).toBe(0o600);
    expect(store.info()).toMatchObject({ user: "Ana", count: 2 });
    expect(store.headerFor(new URL("https://jira.acme.com/rest"))).toBe("JSESSIONID=abc");

    store.absorb(new URL("https://jira.acme.com/rest"), ["JSESSIONID=rotated; Path=/; Secure"]);
    expect(store.headerFor(new URL("https://jira.acme.com/rest"))).toBe("JSESSIONID=rotated");

    expect(store.clear()).toBe(true);
    expect(store.exists()).toBe(false);
  });

  it("picks up files written by another process", () => {
    const file = path.join(dir, "session.json");
    const a = new CookieStore(file);
    const b = new CookieStore(file);
    expect(a.cookies()).toEqual([]);
    b.save([cookie({ value: "fresh" })]);
    expect(a.headerFor(new URL("https://jira.acme.com/"))).toBe("JSESSIONID=fresh");
  });
});

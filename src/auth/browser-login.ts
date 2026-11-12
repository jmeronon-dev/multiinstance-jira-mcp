import fs from "node:fs";
import type { BrowserContext } from "playwright";
import type { InstanceConfig } from "../config/types.js";
import { UserError } from "../errors.js";
import { log } from "../logger.js";
import { domainMatches, type CookieStore, type StoredCookie } from "./cookie-store.js";

export interface BrowserLoginOptions {
  timeoutSeconds: number;
  /** Playwright browser channel ("chrome", "msedge", ...). Bundled Chromium when omitted. */
  channel?: string;
  profileDir: string;
  pollIntervalMs?: number;
}

export interface BrowserLoginResult {
  ok: boolean;
  instance: string;
  user?: string;
  cookieCount: number;
  message: string;
}

type Playwright = typeof import("playwright");

async function loadPlaywright(): Promise<Playwright> {
  try {
    return await import("playwright");
  } catch {
    throw new UserError(
      "Browser login needs the `playwright` package. Install it next to this server (npm i playwright) " +
        "and download a browser with `npx playwright install chromium`, or use token authentication instead.",
    );
  }
}

async function launchContext(pw: Playwright, profileDir: string, channel?: string): Promise<BrowserContext> {
  fs.mkdirSync(profileDir, { recursive: true, mode: 0o700 });
  // Bundled Chromium first, then locally installed Chrome / Edge as fallbacks.
  const candidates = channel ? [channel] : [undefined, "chrome", "msedge"];
  const failures: string[] = [];
  for (const candidate of candidates) {
    try {
      return await pw.chromium.launchPersistentContext(profileDir, {
        headless: false,
        channel: candidate === "chromium" ? undefined : candidate,
        viewport: null,
        args: ["--disable-blink-features=AutomationControlled"],
      });
    } catch (e) {
      failures.push(`${candidate ?? "chromium"}: ${(e as Error).message.split("\n")[0]}`);
    }
  }
  throw new UserError(
    `Could not launch a browser for SSO login.\n${failures.join("\n")}\n` +
      "Run `npx playwright install chromium`, or set --browser-channel chrome / JIRA_BROWSER_CHANNEL=chrome to use your installed Chrome.",
  );
}

/**
 * Uses the browser context's own request client (shares its cookie jar, no CORS)
 * to check whether Jira already accepts the session.
 */
async function probeSession(context: BrowserContext, myselfUrl: string): Promise<string | undefined> {
  try {
    const res = await context.request.get(myselfUrl, {
      headers: { Accept: "application/json" },
      maxRedirects: 0,
      failOnStatusCode: false,
      timeout: 15_000,
    });
    if (res.status() !== 200) return undefined;
    if (!(res.headers()["content-type"] ?? "").includes("json")) return undefined;
    const user = (await res.json()) as Record<string, unknown>;
    const label = user.displayName ?? user.emailAddress ?? user.name ?? user.accountId ?? user.key;
    return typeof label === "string" && label ? label : undefined;
  } catch {
    return undefined;
  }
}

function toStoredCookie(c: Awaited<ReturnType<BrowserContext["cookies"]>>[number]): StoredCookie {
  return {
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path || "/",
    expires: c.expires,
    secure: c.secure,
    httpOnly: c.httpOnly,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Opens a real (headed) browser on the Jira site, waits until the user finishes
 * SSO, and stores the Jira-domain cookies for REST calls. A persistent profile
 * per instance is used so the identity provider remembers the user next time.
 */
export async function runBrowserLogin(
  instance: InstanceConfig,
  store: CookieStore,
  options: BrowserLoginOptions,
): Promise<BrowserLoginResult> {
  const pw = await loadPlaywright();
  const context = await launchContext(pw, options.profileDir, options.channel);
  let closedByUser = false;
  context.on("close", () => {
    closedByUser = true;
  });

  const myselfUrl = `${instance.baseUrl}/rest/api/${instance.apiVersion}/myself`;
  const entryUrl = instance.loginUrl ?? instance.baseUrl;
  const deadline = Date.now() + options.timeoutSeconds * 1000;
  const pollMs = options.pollIntervalMs ?? 2000;

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    log.info(`[${instance.name}] Opening ${entryUrl} — complete the sign-in in the browser window.`);
    await page.goto(entryUrl, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch((e: Error) => {
      log.warn(`[${instance.name}] Initial navigation did not finish cleanly: ${e.message.split("\n")[0]}`);
    });

    let user: string | undefined;
    while (Date.now() < deadline && !closedByUser) {
      user = await probeSession(context, myselfUrl);
      if (user) break;
      await sleep(pollMs);
    }

    if (!user) {
      return {
        ok: false,
        instance: instance.name,
        cookieCount: 0,
        message: closedByUser
          ? `Login for "${instance.name}" was cancelled: the browser window was closed before Jira accepted the session.`
          : `Login for "${instance.name}" timed out after ${options.timeoutSeconds}s without a valid Jira session.`,
      };
    }

    const host = new URL(instance.baseUrl).hostname;
    const cookies = (await context.cookies()).filter((c) => domainMatches(c.domain, host)).map(toStoredCookie);
    store.save(cookies, user);
    log.info(`[${instance.name}] Signed in as ${user}; stored ${cookies.length} cookies.`);
    return {
      ok: true,
      instance: instance.name,
      user,
      cookieCount: cookies.length,
      message: `Signed in to "${instance.name}" (${instance.baseUrl}) as ${user}.`,
    };
  } finally {
    if (!closedByUser) await context.close().catch(() => undefined);
  }
}

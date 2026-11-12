import type { AuthType, InstanceConfig } from "../config/types.js";
import { NotAuthenticatedError } from "../errors.js";
import type { CookieStore } from "./cookie-store.js";

export interface AuthProvider {
  readonly type: AuthType;
  /** Adds credentials to an outgoing request. Throws NotAuthenticatedError when none are available. */
  apply(url: URL, headers: Headers): void;
  /** Lets cookie-based auth absorb rotated cookies. */
  afterResponse?(url: URL, response: Response): void;
  /** Whether credentials are present (not whether they are still valid). */
  hasCredentials(): boolean;
  describe(): string;
  /** Hint appended to 401 errors. */
  unauthorizedHint(instance: string): string;
}

class BasicAuth implements AuthProvider {
  readonly type = "basic" as const;
  private readonly header: string;

  constructor(private readonly email: string, token: string) {
    this.header = `Basic ${Buffer.from(`${email}:${token}`, "utf8").toString("base64")}`;
  }

  apply(_url: URL, headers: Headers): void {
    headers.set("Authorization", this.header);
  }

  hasCredentials(): boolean {
    return true;
  }

  describe(): string {
    return `basic (${this.email} + API token)`;
  }

  unauthorizedHint(instance: string): string {
    return `Check the email and API token configured for instance "${instance}". Cloud tokens are created at https://id.atlassian.com/manage-profile/security/api-tokens`;
  }
}

class BearerAuth implements AuthProvider {
  readonly type = "bearer" as const;
  private readonly header: string;

  constructor(token: string) {
    this.header = `Bearer ${token}`;
  }

  apply(_url: URL, headers: Headers): void {
    headers.set("Authorization", this.header);
  }

  hasCredentials(): boolean {
    return true;
  }

  describe(): string {
    return "bearer (personal access token)";
  }

  unauthorizedHint(instance: string): string {
    return `The personal access token for instance "${instance}" was rejected (expired, revoked or wrong site).`;
  }
}

class BrowserCookieAuth implements AuthProvider {
  readonly type = "browser" as const;

  constructor(private readonly instance: string, private readonly store: CookieStore) {}

  apply(url: URL, headers: Headers): void {
    const cookie = this.store.headerFor(url);
    if (!cookie) {
      throw new NotAuthenticatedError(
        `Instance "${this.instance}" uses browser SSO and has no active session. ` +
          `Call the jira_login tool with instance "${this.instance}" (or run \`multiinstance-jira-mcp login ${this.instance}\`).`,
      );
    }
    headers.set("Cookie", cookie);
  }

  afterResponse(url: URL, response: Response): void {
    const setCookies =
      typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
    if (setCookies.length > 0) this.store.absorb(url, setCookies);
  }

  hasCredentials(): boolean {
    return this.store.cookies().length > 0;
  }

  describe(): string {
    return "browser (SSO session cookies)";
  }

  unauthorizedHint(instance: string): string {
    return `The browser session for instance "${instance}" expired or was rejected. Call jira_login with instance "${instance}" to sign in again.`;
  }
}

export function createAuthProvider(config: InstanceConfig, store: CookieStore): AuthProvider {
  switch (config.auth) {
    case "basic":
      return new BasicAuth(config.email!, config.token!);
    case "bearer":
      return new BearerAuth(config.token!);
    case "browser":
      return new BrowserCookieAuth(config.name, store);
  }
}

import { runBrowserLogin, type BrowserLoginResult } from "../auth/browser-login.js";
import type { AppConfig } from "../config/types.js";
import { UserError } from "../errors.js";
import { log } from "../logger.js";
import { browserProfileDir } from "../paths.js";
import type { JiraInstance } from "./registry.js";

/**
 * Coordinates interactive browser logins so each instance has at most one
 * login window open, and lets callers poll a login that outlives a tool call.
 */
export class LoginManager {
  private readonly inflight = new Map<string, Promise<BrowserLoginResult>>();
  private readonly lastResult = new Map<string, BrowserLoginResult & { finishedAt: string }>();

  constructor(private readonly app: AppConfig) {}

  isRunning(name: string): boolean {
    return this.inflight.has(name);
  }

  last(name: string) {
    return this.lastResult.get(name);
  }

  start(instance: JiraInstance): Promise<BrowserLoginResult> {
    if (instance.config.auth !== "browser") {
      throw new UserError(
        `Instance "${instance.name}" uses ${instance.config.auth} auth; browser login is only for instances with auth "browser".`,
      );
    }
    const running = this.inflight.get(instance.name);
    if (running) return running;

    const promise = runBrowserLogin(instance.config, instance.cookies, {
      timeoutSeconds: this.app.loginTimeoutSeconds,
      channel: this.app.browserChannel,
      profileDir: browserProfileDir(this.app.homeDir, instance.name),
    })
      .catch((e: unknown): BrowserLoginResult => {
        log.error(`[${instance.name}] Browser login failed:`, e);
        return {
          ok: false,
          instance: instance.name,
          cookieCount: 0,
          message: e instanceof Error ? e.message : String(e),
        };
      })
      .then((result) => {
        this.lastResult.set(instance.name, { ...result, finishedAt: new Date().toISOString() });
        return result;
      })
      .finally(() => this.inflight.delete(instance.name));

    this.inflight.set(instance.name, promise);
    return promise;
  }
}

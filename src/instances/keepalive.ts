import { JiraHttpError } from "../errors.js";
import { log } from "../logger.js";
import type { InstanceRegistry } from "./registry.js";

/**
 * Periodically calls /myself on every browser-authenticated instance that has a
 * stored session. This keeps idle SSO sessions alive and surfaces expiry early.
 * Silent re-authentication is impossible with SSO: an expired session always
 * needs a new interactive login.
 */
export function startKeepAlive(registry: InstanceRegistry, intervalSeconds: number): () => void {
  if (intervalSeconds <= 0) {
    log.info("Browser-session keep-alive disabled.");
    return () => undefined;
  }
  const failures = new Map<string, number>();

  const tick = async () => {
    const targets = registry.list().filter((i) => i.config.auth === "browser" && i.auth.hasCredentials());
    await Promise.allSettled(
      targets.map(async (instance) => {
        try {
          await instance.client.myself();
          if ((failures.get(instance.name) ?? 0) > 0) log.info(`[${instance.name}] Session is responding again.`);
          failures.set(instance.name, 0);
        } catch (e) {
          if (e instanceof JiraHttpError && e.status === 401) {
            const count = (failures.get(instance.name) ?? 0) + 1;
            failures.set(instance.name, count);
            log.warn(`[${instance.name}] Browser session rejected (${count}x). Run jira_login for "${instance.name}".`);
          } else {
            log.debug(`[${instance.name}] Keep-alive ping failed: ${(e as Error).message}`);
          }
        }
      }),
    );
  };

  const timer = setInterval(() => void tick(), intervalSeconds * 1000);
  timer.unref();
  const first = setTimeout(() => void tick(), 5_000);
  first.unref();
  log.debug(`Browser-session keep-alive every ${intervalSeconds}s.`);
  return () => {
    clearInterval(timer);
    clearTimeout(first);
  };
}

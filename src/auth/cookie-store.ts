import fs from "node:fs";
import path from "node:path";
import { log } from "../logger.js";

export interface StoredCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  /** Unix seconds; -1 for session cookies. */
  expires: number;
  secure: boolean;
  httpOnly?: boolean;
}

interface SessionFile {
  version: 1;
  savedAt: string;
  user?: string;
  cookies: StoredCookie[];
}

export function domainMatches(cookieDomain: string, host: string): boolean {
  const domain = cookieDomain.toLowerCase().replace(/^\./, "");
  const h = host.toLowerCase();
  return h === domain || h.endsWith(`.${domain}`);
}

export function pathMatches(cookiePath: string, requestPath: string): boolean {
  const cp = cookiePath || "/";
  if (requestPath === cp) return true;
  if (!requestPath.startsWith(cp)) return false;
  return cp.endsWith("/") || requestPath.charAt(cp.length) === "/";
}

export function cookieAppliesTo(cookie: StoredCookie, url: URL, nowSeconds = Date.now() / 1000): boolean {
  if (cookie.expires > 0 && cookie.expires < nowSeconds) return false;
  if (cookie.secure && url.protocol !== "https:") return false;
  return domainMatches(cookie.domain, url.hostname) && pathMatches(cookie.path, url.pathname);
}

/** Parses one `Set-Cookie` header value relative to the request URL. */
export function parseSetCookie(header: string, url: URL, nowSeconds = Date.now() / 1000): StoredCookie | undefined {
  const [pair, ...attrs] = header.split(";");
  if (!pair) return undefined;
  const eq = pair.indexOf("=");
  if (eq <= 0) return undefined;
  const cookie: StoredCookie = {
    name: pair.slice(0, eq).trim(),
    value: pair.slice(eq + 1).trim(),
    domain: url.hostname,
    path: "/",
    expires: -1,
    secure: false,
  };
  for (const attr of attrs) {
    const [rawKey, ...rest] = attr.split("=");
    const key = rawKey?.trim().toLowerCase();
    const value = rest.join("=").trim();
    if (key === "domain" && value) cookie.domain = `.${value.replace(/^\./, "")}`;
    else if (key === "path" && value) cookie.path = value;
    else if (key === "secure") cookie.secure = true;
    else if (key === "httponly") cookie.httpOnly = true;
    else if (key === "max-age") {
      const secs = Number.parseInt(value, 10);
      if (Number.isFinite(secs)) cookie.expires = secs <= 0 ? 0.5 : nowSeconds + secs;
    } else if (key === "expires" && cookie.expires === -1) {
      const ms = Date.parse(value);
      if (Number.isFinite(ms)) cookie.expires = Math.max(0.5, ms / 1000);
    }
  }
  return cookie;
}

/**
 * Per-instance cookie jar persisted as JSON (mode 0600). The file is re-read
 * whenever it changes on disk, so a `login` run from a terminal is picked up
 * by an already running server without a restart.
 */
export class CookieStore {
  private cache?: { mtimeMs: number; data: SessionFile };

  constructor(readonly file: string) {}

  exists(): boolean {
    return fs.existsSync(this.file);
  }

  private read(): SessionFile | undefined {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(this.file);
    } catch {
      this.cache = undefined;
      return undefined;
    }
    if (this.cache && this.cache.mtimeMs === stat.mtimeMs) return this.cache.data;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, "utf8")) as SessionFile;
      if (!Array.isArray(parsed.cookies)) throw new Error("missing cookies array");
      this.cache = { mtimeMs: stat.mtimeMs, data: parsed };
      return parsed;
    } catch (e) {
      log.warn(`Ignoring unreadable session file ${this.file}: ${(e as Error).message}`);
      return undefined;
    }
  }

  cookies(): StoredCookie[] {
    return this.read()?.cookies ?? [];
  }

  info(): { savedAt?: string; user?: string; count: number } | undefined {
    const data = this.read();
    return data ? { savedAt: data.savedAt, user: data.user, count: data.cookies.length } : undefined;
  }

  save(cookies: StoredCookie[], user?: string): void {
    const data: SessionFile = { version: 1, savedAt: new Date().toISOString(), user, cookies };
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
    this.cache = undefined;
  }

  clear(): boolean {
    this.cache = undefined;
    try {
      fs.unlinkSync(this.file);
      return true;
    } catch {
      return false;
    }
  }

  headerFor(url: URL): string | undefined {
    const now = Date.now() / 1000;
    const matching = this.cookies()
      .filter((c) => cookieAppliesTo(c, url, now))
      // Longer paths first, as browsers do.
      .sort((a, b) => b.path.length - a.path.length);
    if (matching.length === 0) return undefined;
    return matching.map((c) => `${c.name}=${c.value}`).join("; ");
  }

  /** Applies rotated cookies (e.g. a refreshed JSESSIONID) from a response. */
  absorb(url: URL, setCookieHeaders: string[]): void {
    if (setCookieHeaders.length === 0) return;
    const data = this.read();
    if (!data) return;
    const now = Date.now() / 1000;
    let changed = false;
    const cookies = [...data.cookies];
    for (const header of setCookieHeaders) {
      const incoming = parseSetCookie(header, url, now);
      if (!incoming) continue;
      const index = cookies.findIndex(
        (c) =>
          c.name === incoming.name &&
          c.path === incoming.path &&
          c.domain.replace(/^\./, "") === incoming.domain.replace(/^\./, ""),
      );
      const expired = incoming.expires > 0 && incoming.expires < now;
      if (index >= 0) {
        if (expired) cookies.splice(index, 1);
        else if (cookies[index]!.value !== incoming.value) cookies[index] = { ...cookies[index]!, ...incoming };
        else continue;
        changed = true;
      } else if (!expired) {
        cookies.push(incoming);
        changed = true;
      }
    }
    if (changed) {
      try {
        this.save(cookies, data.user);
      } catch (e) {
        log.warn(`Could not persist refreshed cookies to ${this.file}: ${(e as Error).message}`);
      }
    }
  }
}

import type { FetchLike } from "../../src/jira/client.js";

export interface RecordedRequest {
  method: string;
  url: URL;
  headers: Headers;
  body?: unknown;
}

type Handler = (req: RecordedRequest) => { status?: number; json?: unknown; text?: string; headers?: Record<string, string> };

/**
 * A tiny fake Jira router: `routes["GET acme.atlassian.net /rest/api/3/myself"] = handler`.
 * Unknown routes return 404.
 */
export function fakeJira(routes: Record<string, Handler>) {
  const requests: RecordedRequest[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const url = new URL(input);
    const headers = new Headers(init.headers);
    let body: unknown;
    if (typeof init.body === "string") body = JSON.parse(init.body);
    else if (init.body) body = init.body;
    const req: RecordedRequest = { method: init.method ?? "GET", url, headers, body };
    requests.push(req);
    const handler = routes[`${req.method} ${url.host} ${url.pathname}`];
    if (!handler) {
      return new Response(JSON.stringify({ errorMessages: [`No route for ${req.method} ${url.pathname}`] }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }
    const out = handler(req);
    const text = out.text ?? (out.json === undefined ? "" : JSON.stringify(out.json));
    return new Response(text, {
      status: out.status ?? 200,
      headers: { "content-type": out.text ? "text/html" : "application/json", ...out.headers },
    });
  };
  return { fetchImpl, requests };
}

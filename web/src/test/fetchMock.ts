import { vi } from 'vitest';

export function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

export type FetchRoute = (req: Request) => Response;

/**
 * vi.fn fetch stub routed by URL pathname; unmatched paths get the server
 * 404 error envelope (mirrors the Hono app's notFound handler).
 */
export function fetchMock(routes: Record<string, FetchRoute>): ReturnType<typeof vi.fn> {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input), 'http://localhost').pathname;
    const handler = routes[path];
    if (handler === undefined) {
      return Promise.resolve(
        jsonResponse({ error: { code: 'not_found', message: 'resource not found' } }, 404),
      );
    }
    const method = init?.method ?? 'GET';
    const body = method === 'GET' ? undefined : (init?.body as BodyInit | undefined);
    return Promise.resolve(handler(new Request(`http://localhost${path}`, { method, body })));
  });
}

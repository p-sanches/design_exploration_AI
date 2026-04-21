// Cloudflare Pages Function: proxies /api/claude to Anthropic.
// The API key stays on the server; browser never sees it.
// Supports streaming, per-IP rate limit, optional workshop-code gate.

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 30; // requests per IP per window

// Per-isolate in-memory rate bucket. Good enough for a workshop; for stricter
// guarantees swap to KV. Cloudflare spreads requests across isolates so this
// is approximate (leakier than a true global limit).
const buckets = new Map();

function rateLimit(ip) {
  const now = Date.now();
  const b = buckets.get(ip) || { count: 0, start: now };
  if (now - b.start > RATE_WINDOW_MS) {
    b.count = 0;
    b.start = now;
  }
  b.count += 1;
  buckets.set(ip, b);
  return b.count <= RATE_MAX;
}

export async function onRequestPost({ request, env }) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!rateLimit(ip)) {
    return new Response('Rate limit exceeded. Try again in a minute.', { status: 429 });
  }

  if (env.WORKSHOP_CODE) {
    const given = request.headers.get('X-Workshop-Code');
    if (given !== env.WORKSHOP_CODE) {
      return new Response('Invalid or missing workshop code.', { status: 403 });
    }
  }

  if (!env.ANTHROPIC_KEY) {
    return new Response('Server misconfigured: ANTHROPIC_KEY not set.', { status: 500 });
  }

  let body;
  try { body = await request.json(); } catch {
    return new Response('Invalid JSON body.', { status: 400 });
  }

  const upstream = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  // Forward the response stream verbatim (SSE-friendly).
  const headers = new Headers(upstream.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');
  headers.set('Cache-Control', 'no-cache');

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

// Reject other methods cleanly.
export async function onRequest({ request }) {
  if (request.method === 'POST') return; // delegated to onRequestPost
  return new Response('Method Not Allowed', { status: 405 });
}

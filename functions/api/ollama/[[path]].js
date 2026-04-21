// Proxy for Ollama — forwards /api/ollama/* to OLLAMA_URL (set as env var).
// Useful if the workshop wants to keep the Ollama provider option available.
// Skip deploying this if you don't need Ollama in production.

export async function onRequest({ request, env, params }) {
  if (!env.OLLAMA_URL) {
    return new Response('OLLAMA_URL not configured.', { status: 501 });
  }

  const subpath = Array.isArray(params.path) ? params.path.join('/') : (params.path || '');
  const url = new URL(request.url);
  const target = env.OLLAMA_URL.replace(/\/$/, '') + '/' + subpath + url.search;

  const upstream = await fetch(target, {
    method: request.method,
    headers: request.headers,
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
  });

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

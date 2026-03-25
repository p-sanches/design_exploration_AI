export async function sendOllama(messages, systemPrompt, model, baseUrl, callbacks) {
  const allMessages = [
    { role: 'system', content: systemPrompt },
    ...messages.filter(m => m.role !== 'system'),
  ];

  // Normalize base URL: strip trailing slash, append API path
  const url = baseUrl.replace(/\/+$/, '') + '/v1/chat/completions';

  console.log('[Ollama] POST', url, '| model:', model);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: allMessages, stream: true }),
    });

    if (!res.ok) {
      const body = await res.text();
      const msg = `Ollama error ${res.status}: ${body}`;
      console.error('[Ollama]', msg);
      callbacks.onError(msg);
      return;
    }

    console.log('[Ollama] connected, streaming...');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    function processLines(text) {
      const lines = text.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        const d = trimmed.slice(6).trim();
        if (d === '[DONE]') continue;
        try {
          const p = JSON.parse(d);
          const tok = p.choices?.[0]?.delta?.content;
          if (tok) callbacks.onToken(tok);
        } catch { /* skip */ }
      }
    }

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      const lastNewline = buf.lastIndexOf('\n');
      if (lastNewline !== -1) {
        processLines(buf.slice(0, lastNewline));
        buf = buf.slice(lastNewline + 1);
      }
    }
    if (buf.trim()) processLines(buf);

    console.log('[Ollama] done');
    callbacks.onDone();
  } catch (e) {
    const msg = `Cannot reach Ollama at ${url} — is it running? (${e.message})`;
    console.error('[Ollama]', msg);
    callbacks.onError(msg);
  }
}

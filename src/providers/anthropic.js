const ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';

export async function sendAnthropic(messages, systemPrompt, callbacks) {
  const userAssistantMsgs = messages.filter(m => m.role !== 'system');

  const headers = { 'Content-Type': 'application/json' };
  // If a workshop code is baked into the build, send it so the proxy accepts us.
  const workshopCode = import.meta.env.VITE_WORKSHOP_CODE;
  if (workshopCode) headers['X-Workshop-Code'] = workshopCode;

  try {
    const res = await fetch('/api/claude', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 16384,
        stream: true,
        system: systemPrompt,
        messages: userAssistantMsgs,
      }),
    });

    if (!res.ok) {
      callbacks.onError(`Claude proxy error ${res.status}: ${await res.text()}`);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    function processLines(text) {
      const lines = text.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        const d = trimmed.slice(6);
        if (d === '[DONE]') continue;
        try {
          const p = JSON.parse(d);
          if (p.type === 'content_block_delta' && p.delta?.text) {
            callbacks.onToken(p.delta.text);
          }
        } catch { /* skip malformed JSON */ }
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

    callbacks.onDone();
  } catch (e) {
    callbacks.onError(`Network error: ${e.message}`);
  }
}

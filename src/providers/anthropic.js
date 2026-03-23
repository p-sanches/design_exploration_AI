const ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';

export async function sendAnthropic(messages, systemPrompt, callbacks) {
  const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY;
  if (!apiKey) {
    callbacks.onError('VITE_ANTHROPIC_API_KEY not set in .env');
    return;
  }

  const userAssistantMsgs = messages.filter(m => m.role !== 'system');

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 16384,
        stream: true,
        system: systemPrompt,
        messages: userAssistantMsgs,
      }),
    });

    if (!res.ok) {
      callbacks.onError(`Anthropic API error ${res.status}: ${await res.text()}`);
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

      // Process all complete lines, keep incomplete tail in buf
      const lastNewline = buf.lastIndexOf('\n');
      if (lastNewline !== -1) {
        processLines(buf.slice(0, lastNewline));
        buf = buf.slice(lastNewline + 1);
      }
    }
    // Flush remaining buffer
    if (buf.trim()) processLines(buf);

    callbacks.onDone();
  } catch (e) {
    callbacks.onError(`Network error: ${e.message}`);
  }
}

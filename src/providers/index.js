import { sendAnthropic } from './anthropic.js';
import { sendOllama } from './ollama.js';

export function sendMessage(provider, ollamaModel, ollamaUrl, messages, systemPrompt, callbacks) {
  if (provider === 'ollama') {
    return sendOllama(messages, systemPrompt, ollamaModel, ollamaUrl, callbacks);
  }
  return sendAnthropic(messages, systemPrompt, callbacks);
}

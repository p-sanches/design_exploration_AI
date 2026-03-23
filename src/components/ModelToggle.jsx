import { useState } from 'react';
import { useTreeStore } from '../store/tree.js';

export function ModelToggle() {
  const provider = useTreeStore(s => s.provider);
  const ollamaModel = useTreeStore(s => s.ollamaModel);
  const ollamaUrl = useTreeStore(s => s.ollamaUrl);
  const setProvider = useTreeStore(s => s.setProvider);
  const setOllamaModel = useTreeStore(s => s.setOllamaModel);
  const setOllamaUrl = useTreeStore(s => s.setOllamaUrl);

  const [editingModel, setEditingModel] = useState(false);
  const [editingUrl, setEditingUrl] = useState(false);
  const [modelInput, setModelInput] = useState(ollamaModel);
  const [urlInput, setUrlInput] = useState(ollamaUrl);

  const toggle = () => setProvider(provider === 'anthropic' ? 'ollama' : 'anthropic');

  const submitModel = () => {
    setOllamaModel(modelInput.trim() || 'llama3.1');
    setEditingModel(false);
  };

  const submitUrl = () => {
    setOllamaUrl(urlInput.trim() || 'https://tokai.informatik.umu.se');
    setEditingUrl(false);
  };

  // Show short version of URL for display
  const shortUrl = ollamaUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '');

  return (
    <div className="model-toggle">
      <div className="toggle-track" onClick={toggle}>
        <span className={provider === 'anthropic' ? 'active' : ''}>Claude</span>
        <span className={provider === 'ollama' ? 'active' : ''}>Ollama</span>
      </div>
      {provider === 'anthropic' && <span className="model-label">claude-sonnet</span>}
      {provider === 'ollama' && (
        <>
          {editingModel ? (
            <input
              className="model-input"
              value={modelInput}
              onChange={e => setModelInput(e.target.value)}
              onBlur={submitModel}
              onKeyDown={e => e.key === 'Enter' && submitModel()}
              autoFocus
              placeholder="model name"
            />
          ) : (
            <span className="model-label clickable" onClick={() => { setModelInput(ollamaModel); setEditingModel(true); }}>
              {ollamaModel}
            </span>
          )}
          {editingUrl ? (
            <input
              className="model-input url-input"
              value={urlInput}
              onChange={e => setUrlInput(e.target.value)}
              onBlur={submitUrl}
              onKeyDown={e => e.key === 'Enter' && submitUrl()}
              autoFocus
              placeholder="https://..."
            />
          ) : (
            <span className="model-label clickable url-label" onClick={() => { setUrlInput(ollamaUrl); setEditingUrl(true); }} title={ollamaUrl}>
              {shortUrl}
            </span>
          )}
        </>
      )}
    </div>
  );
}

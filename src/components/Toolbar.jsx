import { useRef } from 'react';
import { useTreeStore, STAGES } from '../store/tree.js';
import { ModelToggle } from './ModelToggle.jsx';

function exportTreeAsHTML(nodes) {
  function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function getAnc(id) {
    const res = [];
    let cur = nodes.find(n => n.id === id);
    while (cur?.parentId) { const p = nodes.find(n => n.id === cur.parentId); if (p) res.unshift(p); cur = p; }
    return res;
  }

  function branch(node, depth) {
    const children = nodes.filter(n => n.parentId === node.id);
    const t = STAGES[node.stage] || STAGES.sketch;
    const anc = getAnc(node.id);
    const chain = anc.length ? `<div style="font-size:12px;color:#888;margin-bottom:8px;">${anc.map(a => esc(a.title)).join(' → ')} →</div>` : '';
    return `<div style="margin-left:${depth * 32}px;margin-bottom:16px;padding:16px;border-left:3px solid ${t.border};background:${t.bg};border-radius:8px;">
  <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
    <span style="font-size:11px;padding:2px 8px;border-radius:10px;background:${t.border};color:white;">${t.label}</span>
    <strong>${esc(node.title)}</strong>
  </div>
  ${chain}
  ${node.prompt ? `<div style="margin-bottom:8px;"><em>Prompt:</em> ${esc(node.prompt)}</div>` : ''}
  ${node.response ? `<div style="background:white;padding:12px;border-radius:6px;font-size:14px;line-height:1.6;white-space:pre-wrap;">${esc(node.response)}</div>` : ''}
  ${node.code ? `<details style="margin-top:8px;"><summary style="cursor:pointer;font-size:12px;color:#666;">Generated code</summary><pre style="background:#f5f5f5;padding:12px;border-radius:6px;overflow-x:auto;font-size:11px;margin-top:4px;">${esc(node.code)}</pre></details>` : ''}
  ${children.map(c => branch(c, depth + 1)).join('')}
</div>`;
  }

  const roots = nodes.filter(n => !n.parentId);
  const now = new Date().toISOString().slice(0, 16).replace('T', ' ');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Design Exploration — Export</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:900px;margin:0 auto;padding:32px;background:#fafafa;color:#1a1a1a;line-height:1.6}h1{font-size:20px;font-weight:600;margin-bottom:4px}.meta{font-size:13px;color:#888;margin-bottom:24px}</style>
</head><body><h1>Clinical Design Exploration Tree</h1><div class="meta">Exported ${now} · ${nodes.length} nodes</div>${roots.map(r => branch(r, 0)).join('')}</body></html>`;
}

export function Toolbar() {
  const nodes = useTreeStore(s => s.nodes);
  const addRoot = useTreeStore(s => s.addRoot);
  const saveToJSON = useTreeStore(s => s.saveToJSON);
  const loadFromJSON = useTreeStore(s => s.loadFromJSON);
  const fileRef = useRef(null);

  const handleSave = () => {
    const blob = new Blob([saveToJSON()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `exploration-${Date.now()}.json`;
    a.click();
  };

  const handleLoad = () => fileRef.current?.click();

  const handleFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => loadFromJSON(r.result);
    r.readAsText(f);
    e.target.value = '';
  };

  const handleExport = () => {
    const blob = new Blob([exportTreeAsHTML(nodes)], { type: 'text/html' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `exploration-export-${Date.now()}.html`;
    a.click();
  };

  return (
    <div className="toolbar">
      <div className="toolbar-left">
        <button onClick={addRoot}>+ New idea</button>
        <button onClick={handleSave} disabled={!nodes.length}>Save</button>
        <button onClick={handleLoad}>Open</button>
        <button onClick={handleExport} disabled={!nodes.length}>Share</button>
        <input ref={fileRef} type="file" accept=".json" onChange={handleFile} hidden />
        <span className="toolbar-hint">Drag to move · scroll to zoom</span>
      </div>
      <ModelToggle />
    </div>
  );
}

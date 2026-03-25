import { useRef, useCallback } from 'react';
import { useTreeStore, STAGES, STAGE_LIST } from '../store/tree.js';

export function NodeCard({ node, selected, scale }) {
  const select = useTreeStore(s => s.select);
  const fork = useTreeStore(s => s.fork);
  const deleteNode = useTreeStore(s => s.deleteNode);
  const updateNodePosition = useTreeStore(s => s.updateNodePosition);
  const setStage = useTreeStore(s => s.setStage);

  const dragRef = useRef(null);
  const movedRef = useRef(false);
  const stage = node.stage || 'sketch';
  const stageInfo = STAGES[stage] || STAGES.sketch;

  const onPointerDown = useCallback((e) => {
    const tag = e.target.tagName;
    if (tag === 'BUTTON' || tag === 'SELECT' || tag === 'SPAN') return;
    if (e.target.closest('.node-add-handle')) return;
    e.stopPropagation();
    movedRef.current = false;
    dragRef.current = { startX: e.clientX, startY: e.clientY, nodeX: node.x, nodeY: node.y };
    e.target.setPointerCapture(e.pointerId);
  }, [node.x, node.y]);

  const onPointerMove = useCallback((e) => {
    if (!dragRef.current) return;
    const dx = (e.clientX - dragRef.current.startX) / scale;
    const dy = (e.clientY - dragRef.current.startY) / scale;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) movedRef.current = true;
    updateNodePosition(node.id, dragRef.current.nodeX + dx, dragRef.current.nodeY + dy);
  }, [node.id, scale, updateNodePosition]);

  const onPointerUp = useCallback(() => {
    const wasDrag = movedRef.current;
    dragRef.current = null;
    if (!wasDrag) select(node.id);
  }, [node.id, select]);

  const cycleStage = useCallback((e) => {
    e.stopPropagation();
    const idx = STAGE_LIST.indexOf(stage);
    const next = STAGE_LIST[(idx + 1) % STAGE_LIST.length];
    setStage(node.id, next);
  }, [node.id, stage, setStage]);

  const hasCode = !!node.code;
  const preview = node.prompt || 'Describe your idea\u2026';

  return (
    <div
      className={`node-card${selected ? ' selected' : ''}${node.loading ? ' loading' : ''}`}
      style={{
        left: node.x,
        top: node.y,
        borderLeftColor: stageInfo.border,
        borderLeftWidth: 4,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <div className="node-title">{node.title}</div>
      <div className="node-preview">{preview}</div>
      <div className="node-actions">
        <span className={`stage-badge stage-${stage}`} onClick={cycleStage} title="Tap to change stage">
          {stageInfo.label}
        </span>
        {hasCode && <span className="code-badge">preview</span>}
        <button className="delete-btn" onClick={e => { e.stopPropagation(); deleteNode(node.id); }}>×</button>
      </div>
      <div className="node-add-handle" onClick={e => { e.stopPropagation(); fork(node.id); }}>
        <svg className="node-add-stem" width="2" height="16" viewBox="0 0 2 16">
          <line x1="1" y1="0" x2="1" y2="16" stroke="var(--border)" strokeWidth="1.5" strokeDasharray="3 3" />
        </svg>
        <div className="node-add-circle">+</div>
      </div>
    </div>
  );
}

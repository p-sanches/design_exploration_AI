import { useRef, useState, useCallback } from 'react';
import { useTreeStore } from '../store/tree.js';
import { NodeCard } from './NodeCard.jsx';
import { NodeExpanded } from './NodeExpanded.jsx';
import { Connectors } from './Connectors.jsx';

export function Canvas() {
  const nodes = useTreeStore(s => s.nodes);
  const selectedId = useTreeStore(s => s.selectedId);
  const select = useTreeStore(s => s.select);
  const containerRef = useRef(null);

  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0, px: 0, py: 0 });

  const selectedNode = nodes.find(n => n.id === selectedId);

  const handleWheel = useCallback((e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const d = e.deltaY > 0 ? 0.9 : 1.1;
      setScale(s => Math.min(3, Math.max(0.15, s * d)));
    } else {
      setPan(p => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
    }
  }, []);

  const handlePointerDown = useCallback((e) => {
    if (e.target !== containerRef.current) return;
    isPanning.current = true;
    panStart.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
    e.target.setPointerCapture(e.pointerId);
  }, [pan]);

  const handlePointerMove = useCallback((e) => {
    if (!isPanning.current) return;
    setPan({
      x: panStart.current.px + (e.clientX - panStart.current.x),
      y: panStart.current.py + (e.clientY - panStart.current.y),
    });
  }, []);

  const handlePointerUp = useCallback(() => { isPanning.current = false; }, []);

  // Click on empty canvas deselects
  const handleCanvasClick = useCallback((e) => {
    if (e.target === containerRef.current && selectedId) {
      select(null);
    }
  }, [selectedId, select]);

  return (
    <div
      className="canvas-area"
      ref={containerRef}
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onClick={handleCanvasClick}
    >
      <div
        className="canvas-inner"
        style={{ transform: `translate(${pan.x}px,${pan.y}px) scale(${scale})`, transformOrigin: '0 0' }}
      >
        <Connectors nodes={nodes} />
        {nodes.map(node => (
          <NodeCard key={node.id} node={node} selected={node.id === selectedId} scale={scale} />
        ))}
        {selectedNode && (
          <NodeExpanded key={'exp-' + selectedNode.id} node={selectedNode} scale={scale} />
        )}
      </div>
    </div>
  );
}

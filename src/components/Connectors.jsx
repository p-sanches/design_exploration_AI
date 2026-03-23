import { STAGES } from '../store/tree.js';

const NODE_W = 240;
const NODE_H = 140;

export function Connectors({ nodes }) {
  return (
    <svg className="connectors-svg">
      {nodes.map(node => {
        if (!node.parentId) return null;
        const parent = nodes.find(n => n.id === node.parentId);
        if (!parent) return null;

        const x1 = parent.x + NODE_W / 2;
        const y1 = parent.y + NODE_H;
        const x2 = node.x + NODE_W / 2;
        const y2 = node.y;
        const my = (y1 + y2) / 2;
        const color = STAGES[node.stage]?.border || '#9CA3AF';

        return (
          <path
            key={`${parent.id}-${node.id}`}
            d={`M${x1} ${y1} C${x1} ${my},${x2} ${my},${x2} ${y2}`}
            stroke={color}
            strokeWidth={1.5}
            fill="none"
            opacity={0.4}
          />
        );
      })}
    </svg>
  );
}

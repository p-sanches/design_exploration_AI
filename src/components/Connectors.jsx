import { STAGES } from '../store/tree.js';

const NODE_W = 240;
const NODE_H = 160;

export function Connectors({ nodes }) {
  const connectorData = nodes
    .filter(n => n.parentId)
    .map(node => {
      const parent = nodes.find(n => n.id === node.parentId);
      if (!parent) return null;
      const color = STAGES[node.stage]?.border || '#A89F96';
      return { parent, node, color };
    })
    .filter(Boolean);

  const uniqueColors = [...new Set(connectorData.map(c => c.color))];

  return (
    <svg className="connectors-svg">
      <defs>
        {uniqueColors.map(color => (
          <marker
            key={color}
            id={`arrow-${color.replace('#', '')}`}
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 2 L 8 5 L 0 8" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
          </marker>
        ))}
      </defs>
      {connectorData.map(({ parent, node, color }) => {
        const x1 = parent.x + NODE_W / 2;
        const y1 = parent.y + NODE_H;
        const x2 = node.x + NODE_W / 2;
        const y2 = node.y;
        const my = (y1 + y2) / 2;

        return (
          <path
            key={`${parent.id}-${node.id}`}
            d={`M${x1} ${y1} C${x1} ${my},${x2} ${my},${x2} ${y2}`}
            stroke={color}
            strokeWidth={2.5}
            strokeLinecap="round"
            fill="none"
            opacity={0.6}
            markerEnd={`url(#arrow-${color.replace('#', '')})`}
          />
        );
      })}
    </svg>
  );
}

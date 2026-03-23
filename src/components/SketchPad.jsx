import { useRef, useEffect, useState, useCallback } from 'react';

const COLORS = ['#000000', '#DC2626', '#2563EB', '#16A34A', '#9333EA', '#D97706'];
const SIZES = [2, 4, 8];

export function SketchPad({ initialImage, onSave, onCancel }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const lastPos = useRef(null);
  const [color, setColor] = useState('#000000');
  const [size, setSize] = useState(4);
  const [erasing, setErasing] = useState(false);

  // Initialize canvas with existing image or blank
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (initialImage) {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      };
      img.src = initialImage;
    }
  }, []);

  const getPos = useCallback((e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = canvasRef.current.width / rect.width;
    const scaleY = canvasRef.current.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }, []);

  const onPointerDown = useCallback((e) => {
    drawing.current = true;
    lastPos.current = getPos(e);
    e.target.setPointerCapture(e.pointerId);
  }, [getPos]);

  const onPointerMove = useCallback((e) => {
    if (!drawing.current) return;
    const pos = getPos(e);
    const ctx = canvasRef.current.getContext('2d');

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (erasing) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineWidth = size * 4;
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = color;
      ctx.lineWidth = size;
    }

    ctx.beginPath();
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();

    lastPos.current = pos;
  }, [color, size, erasing, getPos]);

  const onPointerUp = useCallback(() => {
    drawing.current = false;
    lastPos.current = null;
  }, []);

  const handleClear = () => {
    const ctx = canvasRef.current.getContext('2d');
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height);
  };

  const handleSave = () => {
    const dataUrl = canvasRef.current.toDataURL('image/png');
    onSave(dataUrl);
  };

  return (
    <div className="sketch-overlay" onClick={onCancel}>
      <div className="sketch-modal" onClick={e => e.stopPropagation()}>
        <div className="sketch-toolbar">
          <div className="sketch-colors">
            {COLORS.map(c => (
              <button
                key={c}
                className={`sketch-color-btn ${c === color && !erasing ? 'active' : ''}`}
                style={{ background: c }}
                onClick={() => { setColor(c); setErasing(false); }}
              />
            ))}
            <button
              className={`sketch-eraser-btn ${erasing ? 'active' : ''}`}
              onClick={() => setErasing(!erasing)}
            >
              eraser
            </button>
          </div>
          <div className="sketch-sizes">
            {SIZES.map(s => (
              <button
                key={s}
                className={`sketch-size-btn ${s === size ? 'active' : ''}`}
                onClick={() => setSize(s)}
              >
                <span style={{ width: s + 4, height: s + 4, borderRadius: '50%', background: 'currentColor', display: 'inline-block' }} />
              </button>
            ))}
          </div>
          <div className="sketch-actions">
            <button onClick={handleClear}>clear</button>
            <button onClick={onCancel}>cancel</button>
            <button className="sketch-save-btn" onClick={handleSave}>use sketch</button>
          </div>
        </div>
        <canvas
          ref={canvasRef}
          className="sketch-canvas"
          width={800}
          height={600}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        />
      </div>
    </div>
  );
}

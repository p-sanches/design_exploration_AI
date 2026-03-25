import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { useTreeStore, STAGES } from '../store/tree.js';
import { SketchPad } from './SketchPad.jsx';
import { predict } from '../datalayer/modelInference.js';

// Error handler — injected FIRST so it catches all script errors.
// Reports errors to parent via postMessage.
const ERROR_SCRIPT = `<script>
window.onerror=function(msg,src,line){
window.parent.postMessage({type:'__iframe_error',msg:msg,line:line},'*');
};
<\/script>`;

// Bridge — injected LAST so user's onBioframe is already defined.
// Also injects window.bioModel API for ML model inference via postMessage.
const BRIDGE_SCRIPT = `<script>
window.latestBioframe=null;
var _bioReqId=0;
var _bioCallbacks={};
window.bioModel={
predict:function(name,input){
return new Promise(function(resolve,reject){
var id=++_bioReqId;
_bioCallbacks[id]={resolve:resolve,reject:reject};
window.parent.postMessage({type:'predict',id:id,name:name,input:input},'*');
});
},
list:function(){
return new Promise(function(resolve){
var id=++_bioReqId;
_bioCallbacks[id]={resolve:resolve};
window.parent.postMessage({type:'model_list',id:id},'*');
});
}
};
window.addEventListener('message',function(e){
if(e.data&&e.data.type==='bioframe'){
window.latestBioframe=e.data;
if(typeof window.onBioframe==='function')window.onBioframe(e.data);
}
if(e.data&&e.data.type==='predict_result'&&_bioCallbacks[e.data.id]){
var cb=_bioCallbacks[e.data.id];delete _bioCallbacks[e.data.id];
if(e.data.error)cb.reject&&cb.reject(new Error(e.data.error));
else cb.resolve(e.data.output);
}
if(e.data&&e.data.type==='model_list_result'&&_bioCallbacks[e.data.id]){
var cb=_bioCallbacks[e.data.id];delete _bioCallbacks[e.data.id];
cb.resolve(e.data.models);
}
});
<\/script>`;

function injectScripts(code) {
  let html = code;
  // Error handler goes right after <head> or at the very start
  if (html.includes('<head>')) {
    html = html.replace('<head>', '<head>' + ERROR_SCRIPT);
  } else if (html.includes('<html>')) {
    html = html.replace('<html>', '<html>' + ERROR_SCRIPT);
  } else {
    html = ERROR_SCRIPT + html;
  }
  // Bridge goes right before </body> or at the very end
  if (html.includes('</body>')) {
    html = html.replace('</body>', BRIDGE_SCRIPT + '</body>');
  } else if (html.includes('</html>')) {
    html = html.replace('</html>', BRIDGE_SCRIPT + '</html>');
  } else {
    html = html + BRIDGE_SCRIPT;
  }
  return html;
}

export function NodeExpanded({ node }) {
  const select = useTreeStore(s => s.select);
  const sendMsg = useTreeStore(s => s.sendMessage);
  const updatePrompt = useTreeStore(s => s.updatePrompt);
  const updateCode = useTreeStore(s => s.updateCode);
  const updateSketch = useTreeStore(s => s.updateSketch);
  const getAncestors = useTreeStore(s => s.getAncestors);

  const textareaRef = useRef(null);
  const iframeRef = useRef(null);
  const [showCode, setShowCode] = useState(false);
  const [iframeError, setIframeError] = useState(null);
  const [maximized, setMaximized] = useState(false);
  const [showSketchPad, setShowSketchPad] = useState(false);
  const sketchFileRef = useRef(null);
  const [size, setSize] = useState({ w: 420, h: 500 });
  const resizing = useRef(null);

  const ancestors = getAncestors(node.id);
  const stageInfo = STAGES[node.stage] || STAGES.sketch;

  // Build the full HTML with injected scripts.
  // useMemo so it only recomputes when code changes.
  const iframeHtml = useMemo(() => {
    if (!node.code) return null;
    return injectScripts(node.code);
  }, [node.code]);

  // Focus prompt on open
  useEffect(() => {
    if (textareaRef.current) textareaRef.current.focus();
  }, [node.id]);

  const models = useTreeStore(s => s.models);

  // Listen for error messages and model inference requests from the iframe
  useEffect(() => {
    function onMessage(e) {
      if (e.data && e.data.type === '__iframe_error') {
        setIframeError(`Line ${e.data.line}: ${e.data.msg}`);
      }
      // ML model predict request from iframe
      if (e.data && e.data.type === 'predict') {
        const { id, name, input } = e.data;
        const currentModels = useTreeStore.getState().models;
        predict(name, input, currentModels)
          .then(output => {
            iframeRef.current?.contentWindow?.postMessage(
              { type: 'predict_result', id, output }, '*'
            );
          })
          .catch(err => {
            iframeRef.current?.contentWindow?.postMessage(
              { type: 'predict_result', id, error: err.message }, '*'
            );
          });
      }
      // ML model list request from iframe
      if (e.data && e.data.type === 'model_list') {
        const { id } = e.data;
        const currentModels = useTreeStore.getState().models;
        const list = currentModels.map(m => ({
          name: m.name, format: m.format,
          inputDescription: m.inputDescription,
          outputLabels: m.outputLabels,
        }));
        iframeRef.current?.contentWindow?.postMessage(
          { type: 'model_list_result', id, models: list }, '*'
        );
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // Clear error when code changes
  useEffect(() => {
    setIframeError(null);
  }, [node.code]);

  // Manual re-run: force iframe reload by briefly clearing and re-setting srcdoc
  const rerun = useCallback(() => {
    if (!iframeRef.current || !iframeHtml) return;
    setIframeError(null);
    iframeRef.current.srcdoc = '';
    requestAnimationFrame(() => {
      if (iframeRef.current) iframeRef.current.srcdoc = iframeHtml;
    });
  }, [iframeHtml]);

  const onResizeDown = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    resizing.current = { startX: e.clientX, startY: e.clientY, startW: size.w, startH: size.h };
    const onMove = (ev) => {
      if (!resizing.current) return;
      setSize({
        w: Math.max(320, resizing.current.startW + (ev.clientX - resizing.current.startX)),
        h: Math.max(300, resizing.current.startH + (ev.clientY - resizing.current.startY)),
      });
    };
    const onUp = () => {
      resizing.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [size]);

  const handleSketchUpload = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    const reader = new FileReader();
    reader.onload = () => updateSketch(node.id, reader.result);
    reader.readAsDataURL(file);
  }, [node.id, updateSketch]);

  const handleSketchSave = useCallback((dataUrl) => {
    updateSketch(node.id, dataUrl);
    setShowSketchPad(false);
  }, [node.id, updateSketch]);

  const handleSend = () => {
    if (node.prompt.trim()) {
      setShowCode(false);
      sendMsg(node.id);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  const NODE_CARD_W = 240;
  const GAP = 16;
  const panelStyle = maximized
    ? { borderLeftColor: stageInfo.border }
    : {
        position: 'absolute',
        left: node.x + NODE_CARD_W + GAP,
        top: node.y,
        width: size.w,
        height: size.h,
        borderLeftColor: stageInfo.border,
      };

  return (
    <div
      className={`node-expanded${maximized ? ' ne-maximized' : ''}`}
      style={panelStyle}
      onClick={e => e.stopPropagation()}
    >
      {/* Header */}
      <div className="ne-header">
        <span className="theme-dot" style={{ background: stageInfo.border }} />
        <span className="ne-title">{node.title}</span>
        {node.code && (
          <button
            className={`ne-code-toggle ${showCode ? 'active' : ''}`}
            onClick={() => setShowCode(!showCode)}
            title="View code"
          >
            {'</>'}
          </button>
        )}
        <button
          className="ne-maximize-btn"
          onClick={() => setMaximized(!maximized)}
          title={maximized ? 'Restore' : 'Maximize'}
        >
          {maximized ? '⊡' : '⊞'}
        </button>
        <button className="close-btn" onClick={() => select(null)}>×</button>
      </div>

      {/* Ancestors */}
      {ancestors.length > 0 && (
        <div className="ne-ancestors">
          {ancestors.map(a => (
            <span key={a.id} className="ne-ancestor" onClick={() => select(a.id)}>
              {a.title}
            </span>
          ))}
        </div>
      )}

      {/* Main content area */}
      <div className="ne-main">
        {/* Prompt bar */}
        <div className="ne-prompt-bar">
          <textarea
            ref={textareaRef}
            className="ne-prompt"
            placeholder="What should this app do?"
            value={node.prompt}
            onChange={e => updatePrompt(node.id, e.target.value)}
            onKeyDown={handleKeyDown}
            rows={2}
          />
          <button
            className="ne-send"
            onClick={handleSend}
            disabled={node.loading || !node.prompt.trim()}
          >
            {node.loading ? '...' : '⏎'}
          </button>
        </div>

        {/* Sketch bar — upload or draw a wireframe */}
        <div className="ne-sketch-bar">
          {node.sketch ? (
            <div className="ne-sketch-preview">
              <img src={node.sketch} alt="sketch" className="ne-sketch-thumb" />
              <span className="ne-sketch-label">sketch attached</span>
              <button className="ne-sketch-btn" onClick={() => setShowSketchPad(true)}>edit</button>
              <button className="ne-sketch-btn" onClick={() => updateSketch(node.id, null)}>remove</button>
            </div>
          ) : (
            <div className="ne-sketch-actions">
              <button className="ne-sketch-btn" onClick={() => sketchFileRef.current?.click()}>Upload a sketch</button>
              <button className="ne-sketch-btn" onClick={() => setShowSketchPad(true)}>Draw a sketch</button>
            </div>
          )}
          <input ref={sketchFileRef} type="file" accept="image/*" onChange={handleSketchUpload} hidden />
        </div>

        {/* Loading ribbon */}
        {node.loading && (
          <div className="ne-loading">
            <div className="ne-loading-bar" />
            <span className="ne-loading-text">Creating your preview…</span>
          </div>
        )}

        {/* Output */}
        <div className="ne-output">
          {iframeError && <div className="ne-error">{iframeError}</div>}
          {iframeHtml ? (
            <iframe
              ref={iframeRef}
              className="node-iframe"
              sandbox="allow-scripts allow-same-origin"
              srcDoc={iframeHtml}
              title="prototype"
            />
          ) : !node.loading ? (
            <div className="ne-empty">
              <div className="ne-empty-icon">○</div>
              <div>Describe what you want to see, then press the button</div>
            </div>
          ) : null}
        </div>

        {/* Code drawer */}
        {showCode && (
          <div className="ne-code-drawer">
            <textarea
              className="ne-code"
              value={node.code}
              onChange={e => updateCode(node.id, e.target.value)}
              placeholder="Code behind the preview (advanced)"
              spellCheck={false}
            />
            <div className="ne-code-actions">
              <button className="ne-send" onClick={rerun}>Refresh preview</button>
            </div>
          </div>
        )}
      </div>

      {/* Resize handle — bottom-right corner */}
      {!maximized && (
        <div className="ne-resize-handle" onPointerDown={onResizeDown} />
      )}

      {/* Sketch pad modal */}
      {showSketchPad && (
        <SketchPad
          initialImage={node.sketch}
          onSave={handleSketchSave}
          onCancel={() => setShowSketchPad(false)}
        />
      )}
    </div>
  );
}

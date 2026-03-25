import { create } from 'zustand';
import { sendMessage } from '../providers/index.js';
import { saveModel as saveModelToDB, deleteModel as deleteModelFromDB } from '../datalayer/modelStore.js';
import { removeSession } from '../datalayer/modelInference.js';

// Base technical context shared across all depths
const DATA_HOOK = `Your app receives live biometric data automatically. You MUST define this global function:

window.onBioframe = function(frame) {
  // frame.source = 'mediapipe' | 'csv' | 'bluetooth'
  // frame.timestamp = milliseconds
  // frame.joints = object with these EXACT key names (MediaPipe Pose):
  //   nose, left_eye, right_eye, left_ear, right_ear,
  //   left_shoulder, right_shoulder, left_elbow, right_elbow,
  //   left_wrist, right_wrist, left_hip, right_hip,
  //   left_knee, right_knee, left_ankle, right_ankle,
  //   left_heel, right_heel, left_foot_index, right_foot_index
  // Each joint: { x, y, z, confidence }
  //   x,y are 0-1 normalised screen coords. z is depth. confidence is 0-1.
  // For webcam/MediaPipe: use these exact names (e.g. frame.joints.left_knee.x)
  // For CSV data: joint names come from the CSV columns (see CSV context below)
};

This function is called ~10 times per second. You MUST define window.onBioframe — it is the only way your app receives data.
For CSV data: frame.row has the raw CSV values (e.g. frame.row.RHip_x), frame.columns lists column names. No frame.joints.
For webcam: frame.joints has named landmarks (e.g. frame.joints.left_knee). No frame.row.
Check frame.source ('csv' vs 'mediapipe' vs 'bluetooth') if you need to handle both.
Keep all code in a single HTML file. Keep code concise to avoid truncation.`;

// Progressive fidelity prompts — depth determines the design stage
const STAGE_PROMPTS = {
  sketch: `You are helping physiotherapists and occupational therapists explore clinical app ideas in the EARLY SKETCHING stage.

${DATA_HOOK}

YOUR ROLE AT THIS STAGE: Build a raw, minimal data probe. This is NOT an app yet — it is a sketch to see if the idea has legs.

Rules for this stage:
- Show the raw incoming data visually: print joint names, coordinates, confidence values directly on screen
- Use a plain white background with black monospace text — no gradients, no rounded corners, no colour themes
- Add a visible data status line: "frames received: N" counter, timestamp of last frame, data source name
- If data stops arriving or joints are missing, show that clearly (e.g. "left_knee: NO DATA")
- Show the ONE core calculation or visualisation the user asked about, in the simplest possible way
- Label everything explicitly — the user should understand what every number on screen means
- Keep the code under 80 lines if possible
- No polish. No branding. No icons. Think "developer console meets whiteboard sketch"`,

  explore: `You are helping physiotherapists and occupational therapists refine a clinical app idea. This is the EXPLORATION stage — the idea has been sketched and now we are testing variations.

${DATA_HOOK}

YOUR ROLE AT THIS STAGE: Build a functional prototype that tests a specific design direction. The previous sketch proved the data works — now shape it into something a patient might recognise.

Rules for this stage:
- Still show a small data status indicator (dot + frame count) but it can be subtle, e.g. a small line at the bottom
- Add basic layout structure: a clear heading, a main content area, maybe a secondary info area
- Use simple colours to convey meaning (green=good, amber=caution, red=alert) but keep the palette minimal
- The core interaction or feedback loop should be clear and working
- Keep some transparency into what the data is doing — e.g. show the key angles or values that drive the UI
- Typography and spacing should be clean but don't over-design
- It's OK to look like a wireframe with real data running through it`,

  refine: `You are helping physiotherapists and occupational therapists polish a clinical app concept. This is the REFINEMENT stage — the idea and interaction pattern are established.

${DATA_HOOK}

YOUR ROLE AT THIS STAGE: Build a near-final prototype that feels like a real patient-facing app.

Rules for this stage:
- No debug info visible by default (OK to keep it behind a tap/toggle)
- Full visual design: colour palette, typography hierarchy, rounded corners, shadows, spacing
- Smooth transitions and animations where they aid comprehension (e.g. animating a gauge)
- The UI should be understandable by a patient without explanation
- Consider mobile-first layout (max-width ~400px centered)
- Add contextual feedback: encouragement, warnings, tips — not just raw numbers
- Handle edge cases gracefully: missing data, low confidence, person leaving frame`,
};

function getSystemPrompt(stage) {
  return STAGE_PROMPTS[stage] || STAGE_PROMPTS.sketch;
}

export const STAGES = {
  sketch:  { bg: '#FEF3C7', border: '#E0A030', label: 'Sketch' },
  explore: { bg: '#EDE5FF', border: '#7C5CFC', label: 'Explore' },
  refine:  { bg: '#D1FAE5', border: '#059669', label: 'Refine' },
};

export const STAGE_LIST = ['sketch', 'explore', 'refine'];

function getDataSourceContext(source, csvColumns) {
  if (source === 'mediapipe') {
    return 'The user has a LIVE WEBCAM connected via MediaPipe Pose. Real-time skeleton data is streaming now. The bioframe.joints object contains 33 named landmarks including: nose, left_shoulder, right_shoulder, left_elbow, right_elbow, left_wrist, right_wrist, left_hip, right_hip, left_knee, right_knee, left_ankle, right_ankle, left_heel, right_heel, left_foot_index, right_foot_index. Each joint has {x, y, z, confidence} where x/y are 0-1 normalized screen coordinates. The data is already flowing — generate code that uses it immediately, do not show a "waiting" state. IMPORTANT: confidence values fluctuate — use a low threshold like 0.3 or skip the confidence check entirely. Do not filter out frames aggressively.';
  }
  if (source === 'csv') {
    const cols = csvColumns.length ? `\nThe CSV columns are: ${csvColumns.join(', ')}` : '';
    return `A CSV file is loaded and streaming row-by-row. The data is already flowing — generate code that uses it immediately.${cols}

For CSV data, the frame object is different from webcam:
- frame.row — the entire CSV row as an object, e.g. frame.row.RHip_x, frame.row.Time, frame.row["Force (N)"]
- frame.columns — array of all column names
- frame.rowIndex — current row number
- frame.row values are auto-typed (numbers are numbers, strings are strings)
Use frame.row.ColumnName to access data. Column names are EXACTLY as listed above — use them verbatim.
Do NOT use frame.joints for CSV data — use frame.row directly.`;
  }
  if (source === 'bluetooth') {
    return 'A Bluetooth sensor is connected and streaming. bioframe.joints.sensor has {x, y, z, confidence} and bioframe.raw.values has the raw sensor array. The data is already flowing — generate code that uses it immediately.';
  }
  return null;
}

function getModelContext(models) {
  if (!models || models.length === 0) return null;
  const lines = models.map(m => {
    const fmt = m.format.toUpperCase();
    const input = m.inputDescription ? ` — input: ${m.inputDescription}` : '';
    const output = m.outputLabels?.length ? `, output: [${m.outputLabels.join(', ')}]` : '';
    return `- "${m.name}" (${fmt})${input}${output}`;
  });
  return `ML models available for inference:
${lines.join('\n')}

Call: const scores = await window.bioModel.predict("modelName", [val1, val2, ...])
Returns array of scores, one per output label.
Use window.bioModel.list() to see available models at runtime.`;
}

let counter = 0;
function uid() { return 'n' + (++counter) + '_' + Date.now().toString(36); }

// Extract the first HTML code block from a response string.
// Uses manual string search instead of regex to handle very long responses reliably.
function extractCode(text) {
  if (!text) return null;

  // Look for opening code fence: ```html or ```HTML or just ```
  let fenceStart = -1;
  let searchFrom = 0;
  while (true) {
    const idx = text.indexOf('```', searchFrom);
    if (idx === -1) break;
    fenceStart = idx;
    break;
  }

  if (fenceStart !== -1) {
    // Find end of the opening fence line
    let contentStart = text.indexOf('\n', fenceStart);
    if (contentStart === -1) contentStart = fenceStart + 3;
    else contentStart += 1;

    // Find closing fence
    const fenceEnd = text.indexOf('```', contentStart);
    let content;
    if (fenceEnd !== -1) {
      content = text.slice(contentStart, fenceEnd).trim();
    } else {
      // No closing fence (response may have been truncated) — take everything after opening
      content = text.slice(contentStart).trim();
    }

    if (content.length > 20) return content;
  }

  // Fallback: if the whole response is an HTML document
  const trimmed = text.trim();
  if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html')) return trimmed;
  return null;
}

export const useTreeStore = create((set, get) => ({
  // Tree
  nodes: [],
  selectedId: null,

  // Provider
  provider: 'anthropic',
  ollamaModel: 'qwen3-coder:latest',
  ollamaUrl: '/ollama-api',

  // ML models (metadata only — binary data lives in IndexedDB)
  models: [],  // { id, name, format, inputDescription, outputLabels, sizeBytes }

  // Data layer
  dataSource: 'none',  // 'none' | 'csv' | 'mediapipe' | 'bluetooth'
  dataFlowing: false,
  frameCount: 0,
  csvColumns: [],

  // Data layer actions
  setDataSource: (source) => set({ dataSource: source, dataFlowing: false, frameCount: 0, csvColumns: [] }),
  setDataFlowing: (flowing) => set({ dataFlowing: flowing }),
  incrementFrame: () => set(s => ({ frameCount: s.frameCount + 1 })),
  setCsvColumns: (cols) => set({ csvColumns: cols }),

  // Model actions
  addModel: async (file, name, format, inputDescription, outputLabels) => {
    const id = 'model_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
    const arrayBuffer = await file.arrayBuffer();
    await saveModelToDB(id, arrayBuffer);
    const meta = { id, name, format, inputDescription, outputLabels, sizeBytes: arrayBuffer.byteLength };
    set(s => ({ models: [...s.models, meta] }));
    return meta;
  },

  removeModel: async (id) => {
    removeSession(id);
    await deleteModelFromDB(id);
    set(s => ({ models: s.models.filter(m => m.id !== id) }));
  },

  // Tree actions
  addRoot: () => {
    const id = uid();
    const roots = get().nodes.filter(n => !n.parentId);
    set(s => ({
      nodes: [...s.nodes, {
        id, parentId: null,
        x: 200 + roots.length * 280, y: 60,
        title: 'New idea', prompt: '', response: '', code: '', sketch: null,
        loading: false, stage: 'sketch',
      }],
      selectedId: id,
    }));
  },

  fork: (parentId) => {
    const parent = get().nodes.find(n => n.id === parentId);
    if (!parent) return;
    const id = uid();
    const siblings = get().nodes.filter(n => n.parentId === parentId);
    const offset = (siblings.length - siblings.length / 2) * 240;
    set(s => ({
      nodes: [...s.nodes, {
        id, parentId,
        x: parent.x + offset, y: parent.y + 240,
        title: 'What if…', prompt: '', response: '', code: parent.code || '', sketch: parent.sketch || null,
        loading: false, stage: parent.stage || 'sketch',
      }],
      selectedId: id,
    }));
  },

  select: (id) => set({ selectedId: id }),

  deleteNode: (id) => {
    // Collect this node and all descendants
    const { nodes, selectedId } = get();
    const toDelete = new Set();
    function collect(nid) {
      toDelete.add(nid);
      nodes.filter(n => n.parentId === nid).forEach(n => collect(n.id));
    }
    collect(id);
    set({
      nodes: nodes.filter(n => !toDelete.has(n.id)),
      selectedId: toDelete.has(selectedId) ? null : selectedId,
    });
  },

  updatePrompt: (id, prompt) => set(s => ({
    nodes: s.nodes.map(n => n.id === id ? { ...n, prompt } : n),
  })),

  updateCode: (id, code) => set(s => ({
    nodes: s.nodes.map(n => n.id === id ? { ...n, code } : n),
  })),

  updateSketch: (id, sketch) => set(s => ({
    nodes: s.nodes.map(n => n.id === id ? { ...n, sketch } : n),
  })),

  updateNodePosition: (id, x, y) => set(s => ({
    nodes: s.nodes.map(n => n.id === id ? { ...n, x, y } : n),
  })),

  setStage: (id, stage) => set(s => ({
    nodes: s.nodes.map(n => n.id === id ? { ...n, stage } : n),
  })),

  getAncestors: (id) => {
    const { nodes } = get();
    const result = [];
    let cur = nodes.find(n => n.id === id);
    while (cur?.parentId) {
      const p = nodes.find(n => n.id === cur.parentId);
      if (p) result.unshift(p);
      cur = p;
    }
    return result;
  },

  sendMessage: async (nodeId) => {
    const state = get();
    const node = state.nodes.find(n => n.id === nodeId);
    if (!node || !node.prompt.trim()) return;

    const title = node.prompt.slice(0, 32) + (node.prompt.length > 32 ? '…' : '');
    set(s => ({
      nodes: s.nodes.map(n => n.id === nodeId ? { ...n, loading: true, title, response: '' } : n),
    }));

    const ancestors = get().getAncestors(nodeId);
    const stage = node.stage || 'sketch';
    const systemPrompt = getSystemPrompt(stage);

    const messages = ancestors.flatMap(a => {
      const m = [];
      if (a.prompt) m.push({ role: 'user', content: a.prompt });
      if (a.response) m.push({ role: 'assistant', content: a.response });
      return m;
    });
    // Tell the AI which data source is active so it generates relevant code
    const dataContext = getDataSourceContext(state.dataSource, state.csvColumns);
    const modelContext = getModelContext(state.models);
    const contextParts = [`[Stage: ${stage.toUpperCase()}]`];
    if (dataContext) contextParts.push(dataContext);
    if (modelContext) contextParts.push(modelContext);
    const userText = `${node.prompt}\n\n[${contextParts.join(' | ')}]`;

    // Build the user message — include sketch image if present
    if (node.sketch && state.provider === 'anthropic') {
      // Extract base64 data and media type from data URI
      const match = node.sketch.match(/^data:(image\/\w+);base64,(.+)$/);
      if (match) {
        messages.push({
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: match[1], data: match[2] },
            },
            {
              type: 'text',
              text: userText + '\n\n[An attached sketch/wireframe shows the desired layout and design direction. Match its structure, placement, and visual style closely.]',
            },
          ],
        });
      } else {
        messages.push({ role: 'user', content: userText });
      }
    } else {
      messages.push({ role: 'user', content: userText });
    }

    await sendMessage(state.provider, state.ollamaModel, state.ollamaUrl, messages, systemPrompt, {
      onToken: (token) => {
        set(s => ({
          nodes: s.nodes.map(n =>
            n.id === nodeId ? { ...n, response: n.response + token } : n
          ),
        }));
      },
      onDone: () => {
        // Extract code from the node's own response (built by onToken, guaranteed complete)
        const currentNode = get().nodes.find(n => n.id === nodeId);
        const extracted = extractCode(currentNode?.response || '');
        set(s => ({
          nodes: s.nodes.map(n =>
            n.id === nodeId ? {
              ...n,
              loading: false,
              code: extracted || n.code,
            } : n
          ),
        }));
      },
      onError: (error) => {
        set(s => ({
          nodes: s.nodes.map(n =>
            n.id === nodeId ? { ...n, loading: false, response: `Error: ${error}` } : n
          ),
        }));
      },
    });
  },

  setProvider: (provider) => set({ provider }),
  setOllamaModel: (model) => set({ ollamaModel: model }),
  setOllamaUrl: (url) => set({ ollamaUrl: url }),

  saveToJSON: () => {
    const { nodes, provider, ollamaModel, ollamaUrl, models } = get();
    return JSON.stringify({ version: 2, nodes, provider, ollamaModel, ollamaUrl, models }, null, 2);
  },

  loadFromJSON: (json) => {
    try {
      const data = JSON.parse(json);
      if (!Array.isArray(data.nodes)) throw new Error('Invalid format');
      set({
        nodes: data.nodes.map(n => ({ ...n, loading: false, code: n.code || '' })),
        selectedId: null,
        provider: data.provider || 'anthropic',
        ollamaModel: data.ollamaModel || 'qwen3-coder:latest',
        ollamaUrl: data.ollamaUrl || 'http://tokai.informatik.umu.se:11434',
        models: data.models || [],
      });
    } catch (e) {
      console.error('Failed to load tree:', e);
    }
  },
}));

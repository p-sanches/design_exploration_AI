// ML model inference engine.
// Loads ONNX Runtime / TensorFlow.js from CDN on first use,
// caches sessions, and runs predictions.

import { loadModel } from './modelStore.js';

const sessions = new Map(); // modelId → { session, format }

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

// ── ONNX Runtime ──

async function ensureONNX() {
  if (window.ort) return;
  await loadScript('https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.0/dist/ort.min.js');
  if (!window.ort) throw new Error('Failed to load ONNX Runtime');
}

async function createONNXSession(arrayBuffer) {
  await ensureONNX();
  return await window.ort.InferenceSession.create(arrayBuffer);
}

async function runONNX(session, inputArray) {
  const inputName = session.inputNames[0];
  const tensor = new window.ort.Tensor('float32', Float32Array.from(inputArray), [1, inputArray.length]);
  const feeds = { [inputName]: tensor };
  const results = await session.run(feeds);
  const outputName = session.outputNames[0];
  return Array.from(results[outputName].data);
}

// ── TensorFlow.js ──

async function ensureTFJS() {
  if (window.tf) return;
  await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.17.0/dist/tf.min.js');
  if (!window.tf) throw new Error('Failed to load TensorFlow.js');
}

async function createTFJSSession(arrayBuffer) {
  await ensureTFJS();
  // TFJS JSON model: user uploads the .json file, weights (.bin) are embedded
  // or fetched. For simplicity, we load from a Blob URL.
  const text = new TextDecoder().decode(arrayBuffer);
  const modelJSON = JSON.parse(text);

  // If weights are inline (weightsManifest with embedded data), use tf.loadLayersModel
  // Otherwise, the user needs to provide a directory — we handle the simple case.
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  try {
    const model = await window.tf.loadLayersModel(url);
    return model;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function runTFJS(model, inputArray) {
  const input = window.tf.tensor2d([inputArray]);
  const output = model.predict(input);
  const data = await output.data();
  input.dispose();
  output.dispose();
  return Array.from(data);
}

// ── Custom JS ──

async function createJSSession(arrayBuffer) {
  const code = new TextDecoder().decode(arrayBuffer);
  // The JS file should assign a predict function: module.exports = { predict }
  // or window.__customPredict = function(input) { ... }
  // We wrap it in a function that captures the export.
  const wrappedCode = `(function() {
    const module = { exports: {} };
    const exports = module.exports;
    ${code}
    return module.exports.predict || window.__customPredict;
  })()`;
  const predictFn = eval(wrappedCode);
  if (typeof predictFn !== 'function') {
    throw new Error('JS model must export a predict(input) function via module.exports.predict or window.__customPredict');
  }
  return { predict: predictFn };
}

async function runJS(session, inputArray) {
  const result = await session.predict(inputArray);
  return Array.isArray(result) ? result : [result];
}

// ── Public API ──

export async function loadSession(id, format, arrayBuffer) {
  if (sessions.has(id)) return sessions.get(id);

  let session;
  if (format === 'onnx') {
    session = await createONNXSession(arrayBuffer);
  } else if (format === 'tfjs') {
    session = await createTFJSSession(arrayBuffer);
  } else if (format === 'js') {
    session = await createJSSession(arrayBuffer);
  } else {
    throw new Error(`Unknown model format: ${format}`);
  }

  const entry = { session, format };
  sessions.set(id, entry);
  return entry;
}

export async function predict(modelId, inputArray, modelsMeta) {
  // Find model metadata
  const meta = modelsMeta.find(m => m.id === modelId || m.name === modelId);
  if (!meta) throw new Error(`Model "${modelId}" not found`);

  const id = meta.id;

  // Load session if not cached
  if (!sessions.has(id)) {
    const arrayBuffer = await loadModel(id);
    if (!arrayBuffer) throw new Error(`Model data for "${modelId}" not found in storage`);
    await loadSession(id, meta.format, arrayBuffer);
  }

  const { session, format } = sessions.get(id);

  if (format === 'onnx') return runONNX(session, inputArray);
  if (format === 'tfjs') return runTFJS(session, inputArray);
  if (format === 'js') return runJS(session, inputArray);
  throw new Error(`Unknown format: ${format}`);
}

export function removeSession(id) {
  if (sessions.has(id)) {
    const { session, format } = sessions.get(id);
    try {
      if (format === 'onnx' && session.release) session.release();
      if (format === 'tfjs' && session.dispose) session.dispose();
    } catch {}
    sessions.delete(id);
  }
}

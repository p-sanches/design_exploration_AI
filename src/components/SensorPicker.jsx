import { useEffect, useRef, useState } from 'react';
import {
  isBluetoothSupported,
  connectBluetooth,
  subscribeAllNotify,
  commitCharacteristic,
  stopBluetooth,
  buildAIParser,
} from '../datalayer/bluetooth.js';
import { useTreeStore } from '../store/tree.js';
import { sendMessage as providerSend } from '../providers/index.js';

// UI states: 'idle' → 'connecting' → 'browsing' | 'error' | 'unsupported'
export function SensorPicker({ onCommit, onCancel }) {
  const [state, setState] = useState(isBluetoothSupported() ? 'idle' : 'unsupported');
  const [error, setError] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [chars, setChars] = useState([]);          // [{ serviceUUID, charUUID, _char }]
  const [selectedKey, setSelectedKey] = useState(null);
  const [friendlyName, setFriendlyName] = useState('');
  const [parsers, setParsers] = useState({});      // { key: parserType }
  const [aiResults, setAiResults] = useState({});  // { key: { loading, error, name, description, decoderJS } }
  const liveRef = useRef({});                      // { key: { bytes, samples: [byteFrames], updatedAt } }
  const [, forceRender] = useState(0);
  const provider = useTreeStore(s => s.provider);
  const ollamaModel = useTreeStore(s => s.ollamaModel);
  const ollamaUrl = useTreeStore(s => s.ollamaUrl);

  useEffect(() => {
    const interval = setInterval(() => forceRender(n => n + 1), 250);
    return () => clearInterval(interval);
  }, []);

  const handleConnect = async () => {
    setState('connecting');
    setError('');
    try {
      const { deviceName, characteristics } = await connectBluetooth();
      if (characteristics.length === 0) {
        setError('Connected, but the device did not expose any notify characteristics from the standard services. Vendor-specific sensors may need custom service UUIDs.');
        setState('error');
        await stopBluetooth();
        return;
      }
      setDeviceName(deviceName);
      setChars(characteristics);
      // Smart default parser per service
      const defaults = {};
      for (const c of characteristics) {
        defaults[c.serviceUUID + '|' + c.charUUID] = defaultParserFor(c.serviceUUID);
      }
      setParsers(defaults);
      setState('browsing');

      await subscribeAllNotify(characteristics, ({ serviceUUID, charUUID, dataView }) => {
        const key = serviceUUID + '|' + charUUID;
        const bytes = [];
        for (let i = 0; i < dataView.byteLength; i++) bytes.push(dataView.getUint8(i));
        const prev = liveRef.current[key];
        const samples = prev?.samples ? prev.samples.slice(-9) : [];
        samples.push(bytes);
        liveRef.current[key] = {
          bytes,
          samples,
          updatedAt: Date.now(),
        };
      });
    } catch (e) {
      setError(e?.message || String(e));
      setState('error');
    }
  };

  const handleCommit = async () => {
    const match = chars.find(c => (c.serviceUUID + '|' + c.charUUID) === selectedKey);
    if (!match) return;
    const aiRes = aiResults[selectedKey];
    const parserType = parsers[selectedKey] || defaultParserFor(match.serviceUUID);
    const useAI = parserType === 'ai' && aiRes?.decoderJS;
    const name = friendlyName.trim() || (useAI && aiRes.name) || defaultNameFor(match);
    try {
      await commitCharacteristic(match, name, parserType, useAI ? aiRes.decoderJS : null);
      onCommit({
        friendlyName: name,
        parserType,
        decoderDescription: useAI ? aiRes.description : '',
        serviceUUID: match.serviceUUID,
        charUUID: match.charUUID,
        deviceName,
      });
    } catch (e) {
      setError(e?.message || String(e));
      setState('error');
    }
  };

  const handleAskAI = async (key) => {
    const c = chars.find(x => (x.serviceUUID + '|' + x.charUUID) === key);
    const live = liveRef.current[key];
    if (!c || !live || !live.samples?.length) return;
    setAiResults(r => ({ ...r, [key]: { loading: true } }));

    const sampleLines = live.samples.map(s =>
      s.map(b => b.toString(16).padStart(2, '0')).join(' ')
    ).join('\n');

    const system = `You are a Bluetooth protocol analyst. Given metadata about a BLE characteristic and sample notification payloads (hex bytes), infer the most likely byte layout and write a small JavaScript decoder function.

Respond with ONLY a single JSON object, no prose, no markdown fences, in this exact shape:
{
  "friendlyName": "short lowercase identifier, e.g. 'hr', 'emg', 'accel'",
  "description": "one sentence describing what the values mean and their units",
  "decoderJS": "(bytes, dv) => [ ... ]"
}

Rules:
- decoderJS must be a valid JavaScript arrow function expression that takes (bytes: Uint8Array, dv: DataView) and returns an array of numbers (or a single number).
- Keep it pure, synchronous, no external calls.
- If multi-channel, return one number per channel in stable order.
- If you recognize the standard service (e.g. Heart Rate 0x180D / 0x2A37), use the spec-correct decoder.
- If uncertain between formats, pick the most plausible based on byte magnitudes and packet length stability.
- Do not include comments inside decoderJS.`;

    const user = `Device name: ${deviceName}
Service UUID: ${c.serviceUUID}
Characteristic UUID: ${c.charUUID}
Packet length (bytes): ${live.bytes.length}

Recent payloads (one per line, hex):
${sampleLines}`;

    let buffer = '';
    try {
      await new Promise((resolve, reject) => {
        providerSend(provider, ollamaModel, ollamaUrl,
          [{ role: 'user', content: user }],
          system,
          {
            onToken: t => { buffer += t; },
            onDone: () => resolve(),
            onError: msg => reject(new Error(msg)),
          },
        );
      });

      const parsed = extractJSON(buffer);
      if (!parsed || !parsed.decoderJS) throw new Error('Could not parse AI response');

      // Test the decoder locally before accepting it
      const testParser = buildAIParser(parsed.decoderJS);
      const testDV = bytesToDataView(live.bytes);
      const testOut = testParser(testDV);
      if (!Array.isArray(testOut)) throw new Error('Decoder did not return an array');

      setAiResults(r => ({
        ...r,
        [key]: {
          loading: false,
          name: parsed.friendlyName || 'sensor',
          description: parsed.description || '',
          decoderJS: parsed.decoderJS,
          sampleOutput: testOut,
        },
      }));
      setParsers(p => ({ ...p, [key]: 'ai' }));
      setFriendlyName(parsed.friendlyName || '');
    } catch (e) {
      setAiResults(r => ({ ...r, [key]: { loading: false, error: e?.message || String(e) } }));
    }
  };

  const handleCancel = async () => {
    try { await stopBluetooth(); } catch {}
    onCancel();
  };

  return (
    <div className="sensor-picker-overlay" onClick={handleCancel}>
      <div className="sensor-picker" onClick={e => e.stopPropagation()}>
        <div className="sensor-picker-header">
          <span>Connect a sensor</span>
          <button className="sensor-picker-close" onClick={handleCancel}>&times;</button>
        </div>

        {state === 'unsupported' && (
          <div className="sensor-picker-body">
            <p className="sensor-picker-error">
              Web Bluetooth isn't available in this browser. Use <b>Chrome</b>, <b>Edge</b>, or <b>Opera</b> on desktop.
              Firefox and Safari do not ship Web Bluetooth. You also need the page served over <code>localhost</code> or <code>https</code>.
            </p>
          </div>
        )}

        {state === 'idle' && (
          <div className="sensor-picker-body">
            <p className="sensor-picker-help">
              Click <b>Scan for devices</b> to open your browser's Bluetooth picker. After you pick a device, this panel will show every data stream it exposes so you can pick which one to use.
            </p>
            <button className="sensor-picker-primary" onClick={handleConnect}>Scan for devices</button>
          </div>
        )}

        {state === 'connecting' && (
          <div className="sensor-picker-body">
            <p>Opening your browser's device picker…</p>
            <p className="sensor-picker-help">If you don't see a popup, check that your browser supports Web Bluetooth and that Bluetooth is enabled on your computer.</p>
          </div>
        )}

        {state === 'error' && (
          <div className="sensor-picker-body">
            <p className="sensor-picker-error">{error}</p>
            <button className="sensor-picker-primary" onClick={handleConnect}>Try again</button>
          </div>
        )}

        {state === 'browsing' && (
          <div className="sensor-picker-body">
            <p className="sensor-picker-device">
              Connected to <b>{deviceName}</b>. Click the stream that looks like the data you want — values update live.
            </p>
            <div className="sensor-picker-list">
              {chars.map(c => {
                const key = c.serviceUUID + '|' + c.charUUID;
                const live = liveRef.current[key];
                const isSelected = selectedKey === key;
                const shortService = shortUUID(c.serviceUUID);
                const shortChar = shortUUID(c.charUUID);
                const humanName = humanizeService(c.serviceUUID);
                const parserType = parsers[key] || defaultParserFor(c.serviceUUID);
                return (
                  <div
                    key={key}
                    className={`sensor-char-row ${isSelected ? 'selected' : ''}`}
                    onClick={() => setSelectedKey(key)}
                  >
                    <div className="sensor-char-head">
                      <span className="sensor-char-service">{humanName}</span>
                      <span className="sensor-char-uuid">{shortService} / {shortChar}</span>
                      {live && <span className="sensor-char-pulse">●</span>}
                    </div>
                    {live ? (
                      <div className="sensor-char-data">
                        <div>
                          <span className="label">decode as</span>
                          <select
                            className="sensor-char-parser"
                            value={parserType}
                            onClick={e => e.stopPropagation()}
                            onChange={e => setParsers(p => ({ ...p, [key]: e.target.value }))}
                          >
                            <option value="heart_rate">heart rate (HR profile)</option>
                            <option value="int16">int16 array</option>
                            <option value="uint16">uint16 array</option>
                            <option value="float32">float32 array</option>
                            <option value="raw">raw bytes</option>
                            {aiResults[key]?.decoderJS && <option value="ai">AI decoder</option>}
                          </select>
                          <span className="mono sensor-char-primary">→ {formatValuesFor(parserType, live.bytes, aiResults[key])}</span>
                        </div>
                        <div><span className="label">bytes</span> <span className="mono">{live.bytes.map(b => b.toString(16).padStart(2, '0')).join(' ')}</span></div>
                        <div className="sensor-char-age">updated {ageMs(live.updatedAt)} ago</div>
                        <div className="sensor-char-ai-row">
                          <button
                            className="sensor-char-ai-btn"
                            disabled={aiResults[key]?.loading || (live.samples?.length ?? 0) < 2}
                            onClick={e => { e.stopPropagation(); handleAskAI(key); }}
                          >
                            {aiResults[key]?.loading ? 'Asking AI…' :
                             aiResults[key]?.decoderJS ? 'Re-ask AI' : 'Ask AI to decode'}
                          </button>
                          {aiResults[key]?.description && (
                            <span className="sensor-char-ai-desc">{aiResults[key].description}</span>
                          )}
                          {aiResults[key]?.error && (
                            <span className="sensor-char-ai-error">{aiResults[key].error}</span>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="sensor-char-data sensor-char-waiting">waiting for data…</div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="sensor-picker-name">
              <label htmlFor="sensor-friendly-name">Name this stream (used in AI prompts)</label>
              <input
                id="sensor-friendly-name"
                type="text"
                value={friendlyName}
                onChange={e => setFriendlyName(e.target.value)}
                placeholder={selectedKey ? defaultNameFor(chars.find(c => (c.serviceUUID + '|' + c.charUUID) === selectedKey)) : 'e.g. HR, EMG-ch1, accel'}
              />
            </div>

            <div className="sensor-picker-actions">
              <button onClick={handleCancel}>Cancel</button>
              <button
                className="sensor-picker-primary"
                onClick={handleCommit}
                disabled={!selectedKey}
              >
                Use this stream
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function shortUUID(uuid) {
  if (typeof uuid !== 'string') return String(uuid);
  if (uuid.length === 36 && uuid.startsWith('0000') && uuid.endsWith('-0000-1000-8000-00805f9b34fb')) {
    return '0x' + uuid.slice(4, 8).toUpperCase();
  }
  return uuid.slice(0, 8) + '…';
}

const SERVICE_NAMES = {
  '0000180d': 'Heart rate',
  '0000180a': 'Device info',
  '0000180f': 'Battery',
  '00001800': 'Generic access',
  '00001801': 'Generic attribute',
  '0000181a': 'Environmental sensing',
  '00001816': 'Cycling speed/cadence',
  '00001818': 'Cycling power',
  '00001814': 'Running speed/cadence',
  '00001826': 'Fitness machine',
  '00001810': 'Blood pressure',
  '00001809': 'Thermometer',
  '00001808': 'Glucose',
  '00001822': 'Pulse oximeter',
  '0000181b': 'Body composition',
  '0000181d': 'Weight scale',
};

function humanizeService(uuid) {
  const prefix = uuid.slice(0, 8);
  return SERVICE_NAMES[prefix] || 'Custom service';
}

function defaultParserFor(serviceUUID) {
  const prefix = serviceUUID.slice(0, 8);
  if (prefix === '0000180d') return 'heart_rate';
  return 'int16';
}

function formatValues(parserType, bytes) {
  if (parserType === 'heart_rate') return parseHeartRate(bytes) + ' bpm';
  if (parserType === 'int16') return '[' + bytesToInt16(bytes).join(', ') + ']';
  if (parserType === 'uint16') return '[' + bytesToUint16(bytes).join(', ') + ']';
  if (parserType === 'float32') return '[' + bytesToFloat32(bytes).map(f => f.toFixed(3)).join(', ') + ']';
  if (parserType === 'raw') return '[' + bytes.join(', ') + ']';
  return '';
}

function formatValuesFor(parserType, bytes, aiRes) {
  if (parserType === 'ai' && aiRes?.decoderJS) {
    try {
      const fn = new Function('bytes', 'dv', `"use strict"; const f = ${aiRes.decoderJS}; return typeof f === 'function' ? f(bytes, dv) : f;`);
      const dv = bytesToDataView(bytes);
      const out = fn(new Uint8Array(bytes), dv);
      const arr = Array.isArray(out) ? out : [out];
      return '[' + arr.map(v => typeof v === 'number' ? v.toFixed(v % 1 === 0 ? 0 : 3) : String(v)).join(', ') + ']';
    } catch { return '(decoder error)'; }
  }
  return formatValues(parserType, bytes);
}

function bytesToDataView(bytes) {
  const u8 = new Uint8Array(bytes);
  return new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
}

function extractJSON(text) {
  if (!text) return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

function bytesToUint16(bytes) {
  const out = [];
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    out.push(bytes[i] | (bytes[i + 1] << 8));
  }
  return out;
}

function defaultNameFor(c) {
  if (!c) return 'sensor';
  const prefix = c.serviceUUID.slice(0, 8);
  if (prefix === '0000180d') return 'HR';
  if (prefix === '0000180f') return 'battery';
  if (prefix === '0000181a') return 'env';
  if (prefix === '00001814') return 'running';
  if (prefix === '00001816') return 'cycling';
  return 'sensor';
}

function bytesToInt16(bytes) {
  const out = [];
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    let v = bytes[i] | (bytes[i + 1] << 8);
    if (v & 0x8000) v = v - 0x10000;
    out.push(v);
  }
  return out;
}

function bytesToFloat32(bytes) {
  const out = [];
  const buf = new ArrayBuffer(4);
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  for (let i = 0; i + 3 < bytes.length; i += 4) {
    u8[0] = bytes[i]; u8[1] = bytes[i + 1]; u8[2] = bytes[i + 2]; u8[3] = bytes[i + 3];
    out.push(dv.getFloat32(0, true));
  }
  return out;
}

// BLE Heart Rate Measurement characteristic (0x2A37): first byte is flags,
// bit 0 determines whether value is uint8 (byte 1) or uint16 (bytes 1-2).
function parseHeartRate(bytes) {
  if (!bytes.length) return '—';
  const flags = bytes[0];
  if (flags & 0x01) return (bytes[1] | (bytes[2] << 8));
  return bytes[1];
}

function ageMs(t) {
  const ms = Date.now() - t;
  if (ms < 1000) return ms + 'ms';
  return (ms / 1000).toFixed(1) + 's';
}

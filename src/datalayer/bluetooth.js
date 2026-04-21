import { setFrame } from './broadcast.js';

// Broad list of standard BLE services. Needed when using acceptAllDevices —
// browsers only expose services that were declared as optional. Custom/vendor
// UUIDs can be added here by the user if their sensor isn't standard.
const STANDARD_SERVICES = [
  'generic_access',
  'generic_attribute',
  'device_information',
  'battery_service',
  'heart_rate',
  'blood_pressure',
  'health_thermometer',
  'glucose',
  'pulse_oximeter',
  'running_speed_and_cadence',
  'cycling_speed_and_cadence',
  'cycling_power',
  'location_and_navigation',
  'environmental_sensing',
  'body_composition',
  'weight_scale',
  'user_data',
  'continuous_glucose_monitoring',
  'human_interface_device',
  'fitness_machine',
  'tx_power',
  'immediate_alert',
  'link_loss',
];

let device = null;
let activeCommitted = null;       // the single characteristic committed for streaming
let subscribedChars = [];         // all chars we attached listeners to during browsing
let browseListeners = new Set();  // callbacks from the picker UI

export function isBluetoothSupported() {
  return typeof navigator !== 'undefined' && !!navigator.bluetooth;
}

export async function connectBluetooth(extraServiceUUIDs = []) {
  if (!isBluetoothSupported()) {
    throw new Error('Web Bluetooth is not available in this browser. Use Chrome, Edge, or Opera on desktop.');
  }

  device = await navigator.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: [...STANDARD_SERVICES, ...extraServiceUUIDs],
  });

  const server = await device.gatt.connect();
  const services = await server.getPrimaryServices();

  const chars = [];
  for (const service of services) {
    let serviceChars;
    try {
      serviceChars = await service.getCharacteristics();
    } catch {
      continue;
    }
    for (const ch of serviceChars) {
      if (ch.properties.notify || ch.properties.indicate) {
        chars.push({
          serviceUUID: service.uuid,
          charUUID: ch.uuid,
          _char: ch,
        });
      }
    }
  }

  return {
    deviceName: device.name || '(unnamed)',
    deviceId: device.id,
    characteristics: chars.map(c => ({
      serviceUUID: c.serviceUUID,
      charUUID: c.charUUID,
      _char: c._char, // opaque handle, the picker passes it back on commit
    })),
  };
}

// Subscribe to every notify characteristic so the picker can preview live values.
// onValue is called with ({ serviceUUID, charUUID, dataView }).
export async function subscribeAllNotify(characteristics, onValue) {
  browseListeners.add(onValue);
  for (const c of characteristics) {
    const ch = c._char;
    const listener = (e) => {
      browseListeners.forEach(cb => cb({
        serviceUUID: c.serviceUUID,
        charUUID: c.charUUID,
        dataView: e.target.value,
      }));
    };
    ch.addEventListener('characteristicvaluechanged', listener);
    try {
      await ch.startNotifications();
      subscribedChars.push({ char: ch, listener });
    } catch (err) {
      console.warn('Could not subscribe to', c.charUUID, err);
      ch.removeEventListener('characteristicvaluechanged', listener);
    }
  }
}

export function removeBrowseListener(onValue) {
  browseListeners.delete(onValue);
}

// Commit to one characteristic — unsubscribe all others and route its values
// into the global bioframe stream under the user-chosen friendly name.
// parserType: 'heart_rate' | 'int16' | 'uint16' | 'float32' | 'raw' | 'ai'
// When parserType is 'ai', customDecoder must be a JS function string that
// takes a Uint8Array and returns an array of numbers.
export async function commitCharacteristic(characteristic, friendlyName, parserType = 'int16', customDecoder = null) {
  const targetChar = characteristic._char;

  // Detach browse-mode listeners; keep only the target's notification flowing.
  for (const { char, listener } of subscribedChars) {
    char.removeEventListener('characteristicvaluechanged', listener);
    if (char !== targetChar) {
      try { await char.stopNotifications(); } catch { /* best-effort */ }
    }
  }
  subscribedChars = [];
  browseListeners.clear();

  const name = friendlyName || 'sensor';
  let parser = PARSERS[parserType] || PARSERS.int16;
  if (parserType === 'ai' && customDecoder) {
    parser = buildAIParser(customDecoder);
  }

  const commitListener = (e) => {
    const dv = e.target.value;
    let values;
    try { values = parser(dv); } catch (err) { values = []; console.warn('decoder error', err); }
    setFrame(buildFrame(name, values, dv, parserType));
  };
  targetChar.addEventListener('characteristicvaluechanged', commitListener);

  // Ensure notifications are still running on the target (they should be, from browse).
  try { await targetChar.startNotifications(); } catch { /* already notifying */ }

  activeCommitted = {
    char: targetChar,
    listener: commitListener,
    friendlyName: name,
    parserType,
    serviceUUID: characteristic.serviceUUID,
    charUUID: characteristic.charUUID,
  };
}

// Build a parser from an AI-produced JS snippet. The snippet should be a
// function expression or a function body that returns an array of numbers.
// We wrap it so `bytes` (Uint8Array) and `dv` (DataView) are both in scope.
export function buildAIParser(decoderJS) {
  // Accept either a full function expression or a body.
  let fn;
  try {
    fn = new Function('bytes', 'dv', `
      "use strict";
      const decoder = ${decoderJS};
      if (typeof decoder === 'function') return decoder(bytes, dv);
      return decoder;
    `);
  } catch (err) {
    console.warn('AI decoder failed to compile', err);
    return PARSERS.int16;
  }
  return (dv) => {
    const bytes = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
    const out = fn(bytes, dv);
    return Array.isArray(out) ? out : (out == null ? [] : [Number(out)]);
  };
}

const PARSERS = {
  int16: (dv) => {
    const out = [];
    for (let i = 0; i + 1 < dv.byteLength; i += 2) out.push(dv.getInt16(i, true));
    return out;
  },
  uint16: (dv) => {
    const out = [];
    for (let i = 0; i + 1 < dv.byteLength; i += 2) out.push(dv.getUint16(i, true));
    return out;
  },
  float32: (dv) => {
    const out = [];
    for (let i = 0; i + 3 < dv.byteLength; i += 4) out.push(dv.getFloat32(i, true));
    return out;
  },
  raw: (dv) => {
    const out = [];
    for (let i = 0; i < dv.byteLength; i++) out.push(dv.getUint8(i));
    return out;
  },
  // BLE Heart Rate Measurement characteristic (0x2A37):
  // byte 0 = flags; bit 0 decides whether HR is uint8 (byte 1) or uint16 (bytes 1-2).
  heart_rate: (dv) => {
    if (dv.byteLength < 2) return [];
    const flags = dv.getUint8(0);
    const hr = (flags & 0x01) ? dv.getUint16(1, true) : dv.getUint8(1);
    return [hr];
  },
};

function buildFrame(name, values, dv, parserType) {
  const bytes = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
  return {
    type: 'bioframe',
    source: 'bluetooth',
    timestamp: Date.now(),
    sensorName: name,
    joints: values.length >= 3 && parserType !== 'heart_rate'
      ? { [name]: { x: values[0] / 1000, y: values[1] / 1000, z: values[2] / 1000, confidence: 1 } }
      : {},
    raw: {
      values,
      bytes: Array.from(bytes),
      name,
      parserType,
    },
  };
}

export async function stopBluetooth() {
  for (const { char, listener } of subscribedChars) {
    char.removeEventListener('characteristicvaluechanged', listener);
    try { await char.stopNotifications(); } catch {}
  }
  subscribedChars = [];
  browseListeners.clear();

  if (activeCommitted) {
    activeCommitted.char.removeEventListener('characteristicvaluechanged', activeCommitted.listener);
    try { await activeCommitted.char.stopNotifications(); } catch {}
    activeCommitted = null;
  }

  if (device?.gatt?.connected) {
    device.gatt.disconnect();
  }
  device = null;
}

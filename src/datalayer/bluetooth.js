import { setFrame } from './broadcast.js';

let device = null;
let characteristic = null;
let running = false;

// Generic BLE sensor handler. Reads raw bytes and normalizes to bioframe.
// Modify the parse function for your specific sensor.
function parseValue(dataView) {
  // Default: read all values as 16-bit signed integers
  const values = [];
  for (let i = 0; i < dataView.byteLength; i += 2) {
    if (i + 1 < dataView.byteLength) {
      values.push(dataView.getInt16(i, true));
    }
  }
  return values;
}

function valuesToFrame(values) {
  // Map raw sensor values into a simple joints-like structure
  const joints = {};
  if (values.length >= 3) {
    joints['sensor'] = {
      x: values[0] / 1000,
      y: values[1] / 1000,
      z: values[2] / 1000,
      confidence: 1,
    };
  }
  return {
    type: 'bioframe',
    source: 'bluetooth',
    timestamp: Date.now(),
    joints,
    raw: { values },
  };
}

export async function startBluetooth() {
  running = true;
  try {
    device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: ['battery_service', 'heart_rate', 'generic_access'],
    });

    const server = await device.gatt.connect();
    const services = await server.getPrimaryServices();

    // Try to find a readable characteristic
    for (const service of services) {
      const chars = await service.getCharacteristics();
      for (const ch of chars) {
        if (ch.properties.notify) {
          characteristic = ch;
          ch.addEventListener('characteristicvaluechanged', (e) => {
            if (!running) return;
            const parsed = parseValue(e.target.value);
            setFrame(valuesToFrame(parsed));
          });
          await ch.startNotifications();
          return;
        }
      }
    }
    console.warn('No notify characteristic found on BLE device');
  } catch (e) {
    console.error('Bluetooth error:', e);
    throw e;
  }
}

export async function stopBluetooth() {
  running = false;
  if (characteristic) {
    try { await characteristic.stopNotifications(); } catch {}
    characteristic = null;
  }
  if (device?.gatt?.connected) {
    device.gatt.disconnect();
  }
  device = null;
}

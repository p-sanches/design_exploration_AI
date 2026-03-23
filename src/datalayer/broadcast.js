// Broadcasts bioframe data to all node iframes via postMessage.
// Iframes are identified by class 'node-iframe' on the DOM.

let intervalId = null;
let currentFrame = null;
let onFrameCallback = null;

export function setFrame(frame) {
  currentFrame = frame;
}

export function startBroadcast(onFrame) {
  onFrameCallback = onFrame;
  if (intervalId) return;
  intervalId = setInterval(() => {
    if (!currentFrame) return;
    const iframes = document.querySelectorAll('.node-iframe');
    iframes.forEach(iframe => {
      try {
        iframe.contentWindow.postMessage(currentFrame, '*');
      } catch { /* sandboxed iframe may reject */ }
    });
    if (onFrameCallback) onFrameCallback();
  }, 100);
}

export function stopBroadcast() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  currentFrame = null;
  onFrameCallback = null;
}

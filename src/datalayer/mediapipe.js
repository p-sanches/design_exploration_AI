import { setFrame } from './broadcast.js';

// MediaPipe Pose landmark names (33-point model)
const LANDMARK_NAMES = [
  'nose','left_eye_inner','left_eye','left_eye_outer','right_eye_inner','right_eye',
  'right_eye_outer','left_ear','right_ear','mouth_left','mouth_right','left_shoulder',
  'right_shoulder','left_elbow','right_elbow','left_wrist','right_wrist','left_pinky',
  'right_pinky','left_index','right_index','left_thumb','right_thumb','left_hip',
  'right_hip','left_knee','right_knee','left_ankle','right_ankle','left_heel',
  'right_heel','left_foot_index','right_foot_index',
];

let videoEl = null;
let pose = null;
let running = false;
let frameLoopId = null;

function landmarksToFrame(landmarks) {
  const joints = {};
  landmarks.forEach((lm, i) => {
    joints[LANDMARK_NAMES[i] || `point_${i}`] = {
      x: 1 - lm.x,  // Mirror x-axis so movement matches the user's perspective
      y: lm.y,
      z: lm.z,
      confidence: lm.visibility ?? 1,
    };
  });
  return {
    type: 'bioframe',
    source: 'mediapipe',
    timestamp: Date.now(),
    joints,
    raw: { landmarkCount: landmarks.length },
  };
}

export async function startMediaPipe(videoElement) {
  videoEl = videoElement;
  running = true;

  // Dynamically load MediaPipe scripts if not loaded
  if (!window.Pose) {
    await loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/pose.js');
  }

  pose = new window.Pose({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/${file}`,
  });
  pose.setOptions({
    modelComplexity: 1,
    smoothLandmarks: true,
    minDetectionConfidence: 0.3,
    minTrackingConfidence: 0.3,
  });
  pose.onResults((results) => {
    if (!running) return;
    if (results.poseLandmarks) {
      setFrame(landmarksToFrame(results.poseLandmarks));
    }
  });

  // Get the webcam stream directly (more reliable than Camera utility)
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480, facingMode: 'user' },
  });
  videoEl.srcObject = stream;
  await videoEl.play();

  // Run our own frame loop — resilient to pose.send() errors
  let processing = false;
  function tick() {
    if (!running) return;
    frameLoopId = requestAnimationFrame(tick);
    if (processing || !pose || videoEl.readyState < 2) return;
    processing = true;
    pose.send({ image: videoEl }).catch(() => {
      // MediaPipe lost tracking momentarily — this is normal, just skip this frame
    }).finally(() => {
      processing = false;
    });
  }
  frameLoopId = requestAnimationFrame(tick);
}

export function stopMediaPipe() {
  running = false;
  if (frameLoopId) {
    cancelAnimationFrame(frameLoopId);
    frameLoopId = null;
  }
  if (pose) {
    try { pose.close(); } catch {}
    pose = null;
  }
  if (videoEl?.srcObject) {
    videoEl.srcObject.getTracks().forEach(t => t.stop());
    videoEl.srcObject = null;
  }
}

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

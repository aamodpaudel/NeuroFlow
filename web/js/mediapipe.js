/**
 * mediapipe.js
 * NeuroFlow — Live Face Landmarker companion.
 * Monitors browDownLeft + browDownRight blendshapes.
 * If 3-second rolling average > BROW_THRESHOLD → triggers Focus Mode.
 */

const BROW_THRESHOLD      = 0.7;    // 0–1; higher = more furrowed
const TRIGGER_DURATION_MS = 3000;   // ms held above threshold before Focus Mode
const SAMPLE_INTERVAL_MS  = 200;    // how often we sample (matches draw loop ~5fps)
const RECOVERY_THRESHOLD  = 0.35;   // drop below this to exit Focus Mode

const MEDIAPIPE_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm';

let faceLandmarker = null;
let lastVideoTime  = -1;
let highLoadStart  = null;  // timestamp when brow first exceeded threshold
let focusModeOn    = false;

// AU04 proxy = (browDownLeft + browDownRight) / 2
function computeBrowDown(blendshapes) {
  const shapes = blendshapes?.[0]?.categories ?? [];
  const get = (name) => shapes.find(c => c.categoryName === name)?.score ?? 0;
  return (get('browDownLeft') + get('browDownRight')) / 2;
}

function applyFocusMode() {
  if (focusModeOn) return;
  focusModeOn = true;
  document.body.classList.add('high-load-mode');
  dispatchNeuroEvent('focus-mode-on', { message: 'High cognitive load detected. Entering Focus Mode.' });
  console.log('[NeuroFlow] 🧠 Focus Mode ON');
}

function removeFocusMode() {
  if (!focusModeOn) return;
  focusModeOn = false;
  document.body.classList.remove('high-load-mode');
  dispatchNeuroEvent('focus-mode-off', { message: 'Stress reduced. Exiting Focus Mode.' });
  console.log('[NeuroFlow] ✅ Focus Mode OFF');
}

function dispatchNeuroEvent(type, detail) {
  document.dispatchEvent(new CustomEvent('neuroflow:' + type, { detail }));
}

async function initFaceLandmarker() {
  const { FaceLandmarker, FilesetResolver } = await import(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/vision_bundle.mjs'
  );

  const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_CDN);

  faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
      delegate: 'GPU',
    },
    outputFaceBlendshapes: true,
    runningMode: 'VIDEO',
    numFaces: 1,
  });
  console.log('[NeuroFlow] 🟢 Face Landmarker initialized');
  return faceLandmarker;
}

async function startWebcam(videoEl) {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
  videoEl.srcObject = stream;
  await new Promise(res => videoEl.addEventListener('loadeddata', res, { once: true }));
  videoEl.play();
  return stream;
}

function runDetectionLoop(videoEl, onResult) {
  function detect() {
    if (videoEl.currentTime !== lastVideoTime && faceLandmarker) {
      lastVideoTime = videoEl.currentTime;
      const result = faceLandmarker.detectForVideo(videoEl, performance.now());
      const browDown = computeBrowDown(result.faceBlendshapes);

      // Threshold logic
      if (browDown > BROW_THRESHOLD) {
        if (!highLoadStart) highLoadStart = Date.now();
        if (Date.now() - highLoadStart >= TRIGGER_DURATION_MS) applyFocusMode();
      } else {
        highLoadStart = null;
        if (browDown < RECOVERY_THRESHOLD) removeFocusMode();
      }

      if (typeof onResult === 'function') onResult({ browDown, focusModeOn });
    }
    requestAnimationFrame(detect);
  }
  requestAnimationFrame(detect);
}

/**
 * Public API — call this once to set everything up.
 * @param {HTMLVideoElement} videoEl  — hidden or visible video element
 * @param {Function}         onResult — optional callback({ browDown, focusModeOn })
 */
export async function startNeuroFlow(videoEl, onResult) {
  try {
    await initFaceLandmarker();
    await startWebcam(videoEl);
    runDetectionLoop(videoEl, onResult);
    console.log('[NeuroFlow] 🚀 Detection running');
  } catch (err) {
    console.warn('[NeuroFlow] Webcam/MediaPipe unavailable:', err.message);
    dispatchNeuroEvent('error', { message: err.message });
  }
}

/**
 * Manually trigger / release Focus Mode (for demo button)
 */
export function triggerFocusMode()  { applyFocusMode(); }
export function releaseFocusMode()  { removeFocusMode(); }
export function isFocusModeActive() { return focusModeOn; }

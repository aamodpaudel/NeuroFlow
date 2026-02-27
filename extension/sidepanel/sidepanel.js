/**
 * sidepanel.js — NeuroFlow Side Panel
 * MediaPipe Face Landmarker + Chart.js + Chrome messaging
 */

const BROW_THRESHOLD = 0.65;
const TRIGGER_SEC = 3;
const SAMPLE_MS = 200;
const AU04_WEIGHT = 0.7;
const AU45_WEIGHT = 0.3;
const CHART_POINTS = 60; // 2 minutes at 2fps

/* ── State ─────────────────────────────────────────────────── */
let faceLandmarker = null;
let lastVideoTime = -1;
let highLoadStart = null;
let enabled = true;
let currentMode = 'neuroshield';
let sessionStart = Date.now();
let peakCLS = 0;
let clsHistory = [];
let interventions = 0;
let simMode = null; // 'stress' | 'calm' | null
let simT = 0;
let chart = null;
const labels = [];
const au04Data = [];
const au45Data = [];
const clsData = [];

/* ── Mode colours ───────────────────────────────────────────── */
const MODE_COLORS = {
    neuroshield: '#7C3AED',
    devcompass: '#00D4FF',
    zenflow: '#22C55E',
    focuslens: '#F59E0B',
};

/* ── Load settings from storage ─────────────────────────────── */
chrome.storage.local.get('nf_settings', (data) => {
    const s = data?.nf_settings;
    if (s) {
        enabled = s.enabled ?? true;
        currentMode = s.mode ?? 'neuroshield';
    }
    document.getElementById('sp-enabled').checked = enabled;
    setActiveMode(currentMode, false);
});

/* ── Enable/disable toggle ──────────────────────────────────── */
document.getElementById('sp-enabled').addEventListener('change', (e) => {
    enabled = e.target.checked;
    chrome.runtime.sendMessage({ type: 'SET_ENABLED', enabled });
});

/* ── Mode cards ─────────────────────────────────────────────── */
document.querySelectorAll('.sp-mode-card').forEach(card => {
    card.addEventListener('click', () => {
        const mode = card.dataset.mode;
        setActiveMode(mode, true);
    });
});

function setActiveMode(mode, notify = true) {
    currentMode = mode;
    document.querySelectorAll('.sp-mode-card').forEach(c => c.classList.remove('active'));
    document.getElementById(`mc-${mode}`)?.classList.add('active');
    if (notify) chrome.runtime.sendMessage({ type: 'SET_MODE', mode });
}

/* ── Chart init ─────────────────────────────────────────────── */
function initChart() {
    const ctx = document.getElementById('sp-chart').getContext('2d');
    chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                { label: 'AU04', data: au04Data, borderColor: '#F43F5E', borderWidth: 1.5, pointRadius: 0, tension: 0.4, fill: false },
                { label: 'AU45', data: au45Data, borderColor: '#00D4FF', borderWidth: 1.5, pointRadius: 0, tension: 0.4, fill: false },
                { label: 'CLS', data: clsData, borderColor: '#A855F7', borderWidth: 2, pointRadius: 0, tension: 0.3, fill: false },
            ],
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            animation: { duration: 200 },
            plugins: { legend: { display: false } },
            scales: {
                x: { display: false },
                y: { min: 0, max: 1, ticks: { color: '#475569', stepSize: 0.5, font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
            },
        },
    });
}
initChart();

/* ── MediaPipe — Local MV3 bundle loader ────────────────────── */
async function initMediaPipe() {
    // Use extension's local copies to bypass remote fetching and blob URLs
    const wasmLoader = chrome.runtime.getURL('lib/wasm_local/vision_wasm_internal.js');
    const wasmBinary = chrome.runtime.getURL('lib/wasm_local/vision_wasm_internal.wasm');
    const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

    // Import the locally bundled version to satisfy MV3 script-src
    const { FaceLandmarker } = await import('../lib/vision_bundle.mjs');

    faceLandmarker = await FaceLandmarker.createFromOptions(
        {
            wasmLoaderPath: wasmLoader,
            wasmBinaryPath: wasmBinary,
        },
        {
            baseOptions: {
                modelAssetPath: MODEL_URL,
                delegate: 'GPU',
            },
            outputFaceBlendshapes: true,
            runningMode: 'VIDEO',
            numFaces: 1,
        }
    );
}

function getBrowDown(blendshapes) {
    const cats = blendshapes?.[0]?.categories ?? [];
    const get = (n) => cats.find(c => c.categoryName === n)?.score ?? 0;
    return (get('browDownLeft') + get('browDownRight')) / 2;
}

function getEyeBlink(blendshapes) {
    const cats = blendshapes?.[0]?.categories ?? [];
    const get = (n) => cats.find(c => c.categoryName === n)?.score ?? 0;
    return (get('eyeBlinkLeft') + get('eyeBlinkRight')) / 2;
}

/* ── Start webcam ───────────────────────────────────────────── */
document.getElementById('sp-start-btn').addEventListener('click', async () => {
    const btn = document.getElementById('sp-start-btn');
    btn.disabled = true;
    btn.textContent = '⏳ Initialising MediaPipe…';

    const video = document.getElementById('sp-video');
    const dot = document.getElementById('sp-cam-dot');
    const statusT = document.getElementById('sp-cam-status-text');

    try {
        await initMediaPipe();
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
        video.srcObject = stream;
        await new Promise(r => video.addEventListener('loadeddata', r, { once: true }));
        video.play();
        dot.classList.add('active');
        statusT.textContent = 'Webcam active — MediaPipe running';
        btn.textContent = '✅ Detection Active';
        runDetectionLoop(video);
    } catch (err) {
        statusT.textContent = `Error: ${err.message}`;
        btn.disabled = false;
        btn.textContent = '▶ Retry Webcam';
    }
});

/* ── Detection loop ─────────────────────────────────────────── */
function runDetectionLoop(video) {
    function detect() {
        if (video.currentTime !== lastVideoTime && faceLandmarker) {
            lastVideoTime = video.currentTime;
            const result = faceLandmarker.detectForVideo(video, performance.now());
            const au04 = getBrowDown(result.faceBlendshapes);
            const au45 = getEyeBlink(result.faceBlendshapes);
            const cls = au04 * AU04_WEIGHT + au45 * AU45_WEIGHT;
            processScores(au04, au45, cls);
        }
        requestAnimationFrame(detect);
    }
    requestAnimationFrame(detect);
}

/* ── Process + dispatch scores ──────────────────────────────── */
function processScores(au04, au45, cls) {
    // Apply simulation override
    if (simMode === 'stress') {
        simT += 0.08;
        au04 = Math.min(1, 0.65 + 0.2 * Math.sin(simT) + 0.05 * Math.random());
        au45 = Math.max(0, 0.3 - 0.1 * Math.cos(simT));
        cls = au04 * AU04_WEIGHT + au45 * AU45_WEIGHT;
    } else if (simMode === 'calm') {
        simT += 0.05;
        au04 = Math.max(0, 0.1 + 0.05 * Math.sin(simT) + 0.02 * Math.random());
        au45 = Math.min(1, 0.6 + 0.1 * Math.cos(simT));
        cls = au04 * AU04_WEIGHT + au45 * AU45_WEIGHT;
    }

    updateUI(au04, au45, cls);
    pushChart(au04, au45, cls);
    updateSessionStats(cls);

    if (enabled) {
        // Send to active tab's content script
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, {
                    type: 'AU_UPDATE',
                    au04: +au04.toFixed(4),
                    au45: +au45.toFixed(4),
                    cls: +cls.toFixed(4),
                }).catch(() => { });
            }
        });
        // Store score
        chrome.runtime.sendMessage({ type: 'STORE_SCORE', payload: { au04, au45, cls } });
    }
}

/* ── UI update ──────────────────────────────────────────────── */
function updateUI(au04, au45, cls) {
    // Ring gauge
    const ringFill = document.getElementById('sp-ring-fill');
    const clsVal = document.getElementById('sp-cls-val');
    const circumf = 2 * Math.PI * 30;
    const offset = circumf * (1 - cls);
    if (ringFill) {
        ringFill.style.strokeDashoffset = offset;
        ringFill.style.stroke = cls > 0.65 ? '#F43F5E' : cls > 0.4 ? '#F59E0B' : '#22C55E';
        ringFill.classList.toggle('danger', cls > 0.65);
    }
    if (clsVal) clsVal.textContent = cls.toFixed(2);

    // Bars
    setBar('sp-bar-au04', 'sp-val-au04', au04, 'var(--rose)');
    setBar('sp-bar-au45', 'sp-val-au45', au45, 'var(--cyan)');
    setBar('sp-bar-cls', 'sp-val-cls', cls, MODE_COLORS[currentMode] || 'var(--violet-l)');
}

function setBar(barId, valId, value, color) {
    const bar = document.getElementById(barId);
    const val = document.getElementById(valId);
    if (bar) { bar.style.width = `${(value * 100).toFixed(1)}%`; bar.style.background = color; }
    if (val) val.textContent = value.toFixed(2);
}

/* ── Chart update ───────────────────────────────────────────── */
function pushChart(au04, au45, cls) {
    const now = new Date().toLocaleTimeString('en-US', { hour12: false });
    labels.push(now);
    au04Data.push(+au04.toFixed(4));
    au45Data.push(+au45.toFixed(4));
    clsData.push(+cls.toFixed(4));
    if (labels.length > CHART_POINTS) labels.shift();
    if (au04Data.length > CHART_POINTS) au04Data.shift();
    if (au45Data.length > CHART_POINTS) au45Data.shift();
    if (clsData.length > CHART_POINTS) clsData.shift();
    chart?.update('none');
}

/* ── Session stats ──────────────────────────────────────────── */
function updateSessionStats(cls) {
    if (cls > peakCLS) { peakCLS = cls; document.getElementById('sp-peak-cls').textContent = cls.toFixed(2); }
    clsHistory.push(cls);
    if (clsHistory.length > 500) clsHistory.shift();
    const avg = clsHistory.reduce((a, b) => a + b, 0) / clsHistory.length;
    document.getElementById('sp-avg-cls').textContent = avg.toFixed(2);
}

// Session clock
setInterval(() => {
    const elapsed = Math.floor((Date.now() - sessionStart) / 1000);
    const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const s = String(elapsed % 60).padStart(2, '0');
    document.getElementById('sp-session-time').textContent = `${m}:${s}`;
}, 1000);

// Simulation loop (runs even without real webcam for demo purposes)
setInterval(() => {
    if (simMode) {
        processScores(0, 0, 0); // values overridden inside
    }
}, SAMPLE_MS);

/* ── Sim buttons ────────────────────────────────────────────── */
document.getElementById('sp-sim-stress').addEventListener('click', () => {
    simMode = simMode === 'stress' ? null : 'stress';
    document.getElementById('sp-sim-stress').style.color = simMode === 'stress' ? '#F43F5E' : '';
    document.getElementById('sp-sim-calm').style.color = '';
    if (!simMode) document.getElementById('sp-cam-dot').classList.remove('active');
    else document.getElementById('sp-cam-dot').classList.add('active');
});

document.getElementById('sp-sim-calm').addEventListener('click', () => {
    simMode = simMode === 'calm' ? null : 'calm';
    document.getElementById('sp-sim-calm').style.color = simMode === 'calm' ? '#22C55E' : '';
    document.getElementById('sp-sim-stress').style.color = '';
    if (!simMode) document.getElementById('sp-cam-dot').classList.remove('active');
    else document.getElementById('sp-cam-dot').classList.add('active');
});

document.getElementById('sp-trigger-intervention').addEventListener('click', () => {
    interventions++;
    document.getElementById('sp-interventions').textContent = interventions;
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, {
                type: 'INTERVENTION_ON',
                mode: currentMode,
                severity: 0.85,
            }).catch(() => { });
        }
    });
});

/* ── Options link (opens in new tab from extension) ─────────── */
document.getElementById('sp-options-link').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
});

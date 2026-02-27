/**
 * dashboard.js
 * NeuroFlow — Hackathon Demo Dashboard
 * - Draws live Chart.js AU04 + AU45 line chart
 * - Polls /live from Flask every 500ms (falls back to simulation)
 * - Drives stress-bar UI and iframe swap
 */

const FLASK_URL = 'http://localhost:5000/live';
const POLL_MS = 500;
const MAX_POINTS = 40;    // data points shown on chart
const AU04_DANGER = 0.6;   // red zone threshold

let chart = null;
let isNeuroMode = false;
let useSimulation = false;
let simT = 0;

// ────────────────────────────────────────────
// Data buffers
// ────────────────────────────────────────────
const labels = [];
const au04Buf = [];
const au45Buf = [];
const clsBuf = [];   // Cognitive Load Score

function pushData(au04, au45, cls) {
    const now = new Date().toLocaleTimeString('en-US', { hour12: false });
    labels.push(now);
    au04Buf.push(au04);
    au45Buf.push(au45);
    clsBuf.push(cls);
    if (labels.length > MAX_POINTS) { labels.shift(); }
    if (au04Buf.length > MAX_POINTS) { au04Buf.shift(); }
    if (au45Buf.length > MAX_POINTS) { au45Buf.shift(); }
    if (clsBuf.length > MAX_POINTS) { clsBuf.shift(); }
}

// ────────────────────────────────────────────
// Chart.js Setup
// ────────────────────────────────────────────
function initChart(canvasId) {
    const ctx = document.getElementById(canvasId).getContext('2d');
    chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'AU04 — Brow Furrow (Stress)',
                    data: au04Buf,
                    borderColor: '#F43F5E',
                    backgroundColor: 'rgba(244,63,94,0.08)',
                    pointRadius: 0,
                    borderWidth: 2.5,
                    tension: 0.4,
                    fill: true,
                },
                {
                    label: 'AU45 — Blink Rate',
                    data: au45Buf,
                    borderColor: '#00D4FF',
                    backgroundColor: 'rgba(0,212,255,0.05)',
                    pointRadius: 0,
                    borderWidth: 2,
                    tension: 0.4,
                    fill: true,
                },
                {
                    label: 'Cognitive Load Score',
                    data: clsBuf,
                    borderColor: '#A855F7',
                    backgroundColor: 'rgba(168,85,247,0.06)',
                    pointRadius: 2,
                    pointBackgroundColor: '#A855F7',
                    borderWidth: 2,
                    tension: 0.3,
                    fill: false,
                    borderDash: [4, 3],
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 300 },
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    labels: { color: '#94A3B8', font: { family: 'Inter', size: 12 }, boxWidth: 14 }
                },
                tooltip: {
                    backgroundColor: '#0D1117',
                    borderColor: 'rgba(255,255,255,0.08)',
                    borderWidth: 1,
                    titleColor: '#F1F5F9',
                    bodyColor: '#94A3B8',
                    callbacks: {
                        label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(3)}`,
                    }
                },
                // Danger zone plugin
                annotation: undefined,
            },
            scales: {
                x: {
                    ticks: { color: '#475569', maxTicksLimit: 6, font: { size: 11 } },
                    grid: { color: 'rgba(255,255,255,0.04)' },
                },
                y: {
                    min: 0, max: 1,
                    ticks: { color: '#475569', stepSize: 0.2 },
                    grid: { color: 'rgba(255,255,255,0.05)' },
                },
            },
        },
    });

    // Draw danger-zone annotation manually via afterDraw plugin
    Chart.register({
        id: 'dangerZone',
        afterDraw(chartInstance) {
            const { ctx: c, scales: { y, x } } = chartInstance;
            const yPx = y.getPixelForValue(AU04_DANGER);
            c.save();
            c.setLineDash([6, 4]);
            c.strokeStyle = 'rgba(244,63,94,0.5)';
            c.lineWidth = 1.5;
            c.beginPath();
            c.moveTo(x.left, yPx);
            c.lineTo(x.right, yPx);
            c.stroke();
            c.fillStyle = 'rgba(244,63,94,0.6)';
            c.font = '10px Inter';
            c.fillText('⚠ Danger Threshold', x.right - 120, yPx - 4);
            c.restore();
        },
    });
}

// ────────────────────────────────────────────
// Simulation fallback (when Flask is offline)
// ────────────────────────────────────────────
function simulateData() {
    simT += 0.12;
    const chaos = isNeuroMode ? 0 : 1;
    const au04 = Math.max(0, Math.min(1, 0.18 + chaos * (0.45 + 0.25 * Math.sin(simT) + 0.1 * Math.random())));
    const au45 = Math.max(0, Math.min(1, 0.3 + chaos * (0.15 * Math.cos(simT * 0.7) + 0.05 * Math.random())));
    const cls = (au04 * 0.7) + (au45 * 0.3);
    return { au04: +au04.toFixed(4), au45: +au45.toFixed(4), cognitive_load_score: +cls.toFixed(4) };
}

// ────────────────────────────────────────────
// Polling loop
// ────────────────────────────────────────────
async function fetchAUData() {
    if (useSimulation) return simulateData();
    try {
        const res = await fetch(FLASK_URL, { signal: AbortSignal.timeout(400) });
        const data = await res.json();
        return data;
    } catch {
        console.warn('[Dashboard] Flask offline → switching to simulation mode');
        useSimulation = true;
        document.getElementById('data-source-badge')?.classList.add('sim');
        return simulateData();
    }
}

function updateUI(data) {
    if (!chart) return;
    pushData(data.au04, data.au45, data.cognitive_load_score);
    chart.data.labels = [...labels];
    chart.data.datasets[0].data = [...au04Buf];
    chart.data.datasets[1].data = [...au45Buf];
    chart.data.datasets[2].data = [...clsBuf];
    chart.update('none');

    // Stress bars
    setBar('bar-au04', data.au04);
    setBar('bar-au45', data.au45);
    setBar('bar-cls', data.cognitive_load_score);

    // Score readout
    setReadout('val-au04', data.au04);
    setReadout('val-au45', data.au45);
    setReadout('val-cls', data.cognitive_load_score);

    // Alert banner
    const alert = document.getElementById('stress-alert');
    if (alert) {
        if (data.au04 > AU04_DANGER && !isNeuroMode) {
            alert.style.display = 'flex';
        } else {
            alert.style.display = 'none';
        }
    }
}

function setBar(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.width = (value * 100).toFixed(1) + '%';
    el.style.background = value > AU04_DANGER
        ? 'linear-gradient(90deg,#F43F5E,#E11D48)'
        : value > 0.4
            ? 'linear-gradient(90deg,#F59E0B,#D97706)'
            : 'linear-gradient(90deg,#22C55E,#16A34A)';
}

function setReadout(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value.toFixed(3);
}

// ────────────────────────────────────────────
// UI Mode Toggle
// ────────────────────────────────────────────
function switchToNeuroMode() {
    isNeuroMode = true;
    const frame = document.getElementById('demo-iframe');
    if (frame) frame.src = 'neuro.html';

    const btn = document.getElementById('mode-toggle-btn');
    if (btn) {
        btn.textContent = '🧠 Switch Back to Chaos';
        btn.classList.remove('btn-success');
        btn.classList.add('btn-danger');
        btn.onclick = switchToChaosMode;
    }

    document.getElementById('mode-label')?.textContent && (document.getElementById('mode-label').textContent = 'NEURO-INCLUSIVE MODE');
    document.getElementById('mode-badge')?.classList.replace('badge-rose', 'badge-green');

    const v = document.getElementById('mode-verdict');
    if (v) {
        v.textContent = '🎉 Cognitive load dropped. UI simplified.';
        v.style.color = '#22C55E';
    }
}

function switchToChaosMode() {
    isNeuroMode = false;
    const frame = document.getElementById('demo-iframe');
    if (frame) frame.src = 'chaos.html';

    const btn = document.getElementById('mode-toggle-btn');
    if (btn) {
        btn.textContent = '✨ Switch to Neuro-Inclusive Mode';
        btn.classList.remove('btn-danger');
        btn.classList.add('btn-success');
        btn.onclick = switchToNeuroMode;
    }

    document.getElementById('mode-label')?.textContent && (document.getElementById('mode-label').textContent = 'CHAOS UI ACTIVE');
    document.getElementById('mode-badge')?.classList.replace('badge-green', 'badge-rose');

    const v = document.getElementById('mode-verdict');
    if (v) {
        v.textContent = '⚠ Cognitive overload detected. Click to intervene!';
        v.style.color = '#F43F5E';
    }
}

// ────────────────────────────────────────────
// Init
// ────────────────────────────────────────────
async function startPolling() {
    const data = await fetchAUData();
    updateUI(data);
    setTimeout(startPolling, POLL_MS);
}

export function initDashboard(chartCanvasId) {
    initChart(chartCanvasId);
    startPolling();

    // Bind mode toggle button
    document.getElementById('mode-toggle-btn')?.addEventListener('click', switchToNeuroMode);
}

export { switchToNeuroMode, switchToChaosMode };

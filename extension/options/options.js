/**
 * options.js — NeuroFlow Settings Page
 * Handles: tab navigation, settings persistence, session history chart, CSV export.
 */

/* ── Tab navigation ─────────────────────────────────────────── */
const sections = ['general', 'modes', 'domains', 'history'];

document.querySelectorAll('.opt-nav-link').forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        const sec = link.dataset.section;
        document.querySelectorAll('.opt-nav-link').forEach(l => l.classList.remove('active'));
        link.classList.add('active');
        sections.forEach(s => {
            document.getElementById(`sec-${s}`)?.classList.toggle('hidden', s !== sec);
        });
        if (sec === 'history') loadHistory();
    });
});

/* ── Load settings ───────────────────────────────────────────── */
chrome.storage.local.get('nf_settings', (data) => {
    const s = data?.nf_settings ?? {};
    const threshold = s.threshold ?? 0.65;
    const delay = s.triggerDelaySec ?? 3;
    const breakInt = s.breakIntervalMin ?? 45;

    setSlider('opt-threshold', 'threshold-hint', threshold, v => v.toFixed(2));
    setSlider('opt-delay', 'delay-hint', delay, v => `${v}s`);
    setSlider('opt-break', 'break-hint', breakInt, v => `${v} min`);
    setSlider('opt-pomo', 'pomo-hint', 25, v => `${v} min`);

    // Whitelist / Blacklist
    if (s.domainWhitelist) document.getElementById('opt-whitelist').value = s.domainWhitelist.join('\n');
    if (s.domainBlacklist) document.getElementById('opt-blacklist').value = s.domainBlacklist.join('\n');
});

function setSlider(sliderId, hintId, value, format) {
    const slider = document.getElementById(sliderId);
    const hint = document.getElementById(hintId);
    if (!slider) return;
    slider.value = value;
    if (hint) hint.textContent = format(+value);
    slider.addEventListener('input', () => {
        if (hint) hint.textContent = format(+slider.value);
    });
}

/* ── Save settings ───────────────────────────────────────────── */
document.getElementById('opt-save').addEventListener('click', () => {
    const threshold = +document.getElementById('opt-threshold').value;
    const delay = +document.getElementById('opt-delay').value;
    const breakInt = +document.getElementById('opt-break').value;
    const whitelist = document.getElementById('opt-whitelist').value.split('\n').map(s => s.trim()).filter(Boolean);
    const blacklist = document.getElementById('opt-blacklist').value.split('\n').map(s => s.trim()).filter(Boolean);

    chrome.storage.local.get('nf_settings', (data) => {
        const settings = data?.nf_settings ?? {};
        settings.threshold = threshold;
        settings.triggerDelaySec = delay;
        settings.breakIntervalMin = breakInt;
        settings.domainWhitelist = whitelist;
        settings.domainBlacklist = blacklist;
        chrome.storage.local.set({ nf_settings: settings }, () => {
            const btn = document.getElementById('opt-save');
            btn.textContent = '✅ Saved!';
            btn.classList.add('saved');
            setTimeout(() => { btn.textContent = 'Save Settings'; btn.classList.remove('saved'); }, 2000);
        });
    });
});

/* ── Session history ─────────────────────────────────────────── */
let historyChart = null;

function loadHistory() {
    chrome.storage.local.get('nf_session', (data) => {
        const sess = data?.nf_session ?? {};
        const scores = sess.scores ?? [];

        // Stats
        const elapsed = Math.floor((Date.now() - (sess.startTime ?? Date.now())) / 1000);
        const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
        const sec = String(elapsed % 60).padStart(2, '0');
        setText('h-session', `${m}:${sec}`);
        setText('h-peak', (sess.peakCLS ?? 0).toFixed(3));
        setText('h-total', scores.length);

        const avg = scores.length > 0
            ? scores.reduce((a, b) => a + (b.cls ?? 0), 0) / scores.length
            : 0;
        setText('h-avg', avg.toFixed(3));

        // Chart — sample every N points for readability
        const N = Math.max(1, Math.floor(scores.length / 120));
        const sampled = scores.filter((_, i) => i % N === 0);
        const clsVals = sampled.map(s => +(s.cls ?? 0).toFixed(4));
        const au04Vals = sampled.map(s => +(s.au04 ?? 0).toFixed(4));
        const timeLabels = sampled.map(s => {
            const d = new Date(s.t ?? Date.now());
            return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
        });

        if (historyChart) { historyChart.destroy(); historyChart = null; }
        const ctx = document.getElementById('opt-history-chart').getContext('2d');
        historyChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: timeLabels,
                datasets: [
                    { label: 'CLS', data: clsVals, borderColor: '#A855F7', borderWidth: 2, pointRadius: 0, tension: 0.4, fill: { target: 'origin', above: 'rgba(168,85,247,0.05)' } },
                    { label: 'AU04', data: au04Vals, borderColor: '#F43F5E', borderWidth: 1.5, pointRadius: 0, tension: 0.4, fill: false },
                ],
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                animation: false,
                plugins: {
                    legend: { labels: { color: '#94A3B8', font: { size: 11 }, boxWidth: 12 } },
                    tooltip: { backgroundColor: '#0D1117', borderColor: 'rgba(255,255,255,0.08)', borderWidth: 1, titleColor: '#F1F5F9', bodyColor: '#94A3B8' },
                },
                scales: {
                    x: { ticks: { color: '#475569', maxTicksLimit: 8, font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
                    y: { min: 0, max: 1, ticks: { color: '#475569', stepSize: 0.25, font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.06)' } },
                },
            },
        });
    });
}

/* ── Export CSV ──────────────────────────────────────────────── */
document.getElementById('h-export').addEventListener('click', () => {
    chrome.storage.local.get('nf_session', (data) => {
        const scores = data?.nf_session?.scores ?? [];
        if (!scores.length) { alert('No session data to export yet.'); return; }
        const rows = ['timestamp,au04,au45,cls'];
        scores.forEach(s => {
            rows.push(`${new Date(s.t).toISOString()},${s.au04},${s.au45},${s.cls}`);
        });
        const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `neuroflow_session_${Date.now()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    });
});

/* ── Clear session ───────────────────────────────────────────── */
document.getElementById('h-clear').addEventListener('click', () => {
    if (!confirm('Clear all session data? This cannot be undone.')) return;
    chrome.storage.local.set({
        nf_session: { startTime: Date.now(), scores: [], peakCLS: 0, interventions: 0 }
    }, () => loadHistory());
});

/* ── Util ──────────────────────────────────────────────────────*/
function setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }

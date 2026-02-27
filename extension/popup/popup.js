/**
 * popup.js — NeuroFlow Toolbar Popup
 * Reads live data from chrome.storage, shows quick stats + mode switcher.
 */

const MODE_LABELS = {
    neuroshield: '🛡 NeuroShield',
    devcompass: '💻 DevCompass',
    zenflow: '🌿 ZenFlow',
    focuslens: '🎓 FocusLens',
};

let currentMode = 'neuroshield';

/* ── Load state from storage ─────────────────────────────── */
chrome.storage.local.get(['nf_settings', 'nf_session'], (data) => {
    const s = data?.nf_settings;
    const sess = data?.nf_session;

    if (s) {
        currentMode = s.mode ?? 'neuroshield';
        document.getElementById('pp-enabled').checked = s.enabled ?? true;
        setActiveMode(currentMode);
        const dot = document.getElementById('pp-dot');
        if (s.enabled) dot.classList.add('on');
        document.getElementById('pp-status-text').textContent =
            s.enabled ? `Active · ${MODE_LABELS[currentMode]}` : 'Extension disabled';
    }

    if (sess) {
        const elapsed = Math.floor((Date.now() - (sess.startTime ?? Date.now())) / 1000);
        const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
        const sec = String(elapsed % 60).padStart(2, '0');
        document.getElementById('pp-session').textContent = `${m}:${sec}`;

        // Last score from session
        const scores = sess.scores ?? [];
        if (scores.length > 0) {
            const last = scores[scores.length - 1];
            updateScoreDisplay(last.au04 ?? 0, last.au45 ?? 0, last.cls ?? 0);
        }
    } else {
        document.getElementById('pp-cls-val').textContent = '–';
        document.getElementById('pp-status-text').textContent = 'Open side panel to start detection';
    }
});

/* ── Live storage listener ───────────────────────────────── */
chrome.storage.onChanged.addListener((changes) => {
    if (changes.nf_session?.newValue) {
        const scores = changes.nf_session.newValue.scores ?? [];
        if (scores.length > 0) {
            const last = scores[scores.length - 1];
            updateScoreDisplay(last.au04 ?? 0, last.au45 ?? 0, last.cls ?? 0);
        }
    }
});

/* ── Score display ───────────────────────────────────────── */
function updateScoreDisplay(au04, au45, cls) {
    const ringFill = document.getElementById('pp-ring-fill');
    const circumf = 2 * Math.PI * 22;
    const offset = circumf * (1 - cls);
    if (ringFill) {
        ringFill.style.strokeDashoffset = offset;
        ringFill.style.stroke = cls > 0.65 ? '#F43F5E' : cls > 0.4 ? '#F59E0B' : '#22C55E';
    }
    setText('pp-cls-val', cls.toFixed(2));
    setMetaVal('pp-au04-val', au04, 0.65);
    setMetaVal('pp-au45-val', au45, 0.4);
}

function setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }

function setMetaVal(id, val, threshold) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = val.toFixed(2);
    el.className = 'pp-meta-val ' + (val > threshold ? 'bad' : val > threshold * 0.6 ? 'warn' : 'ok');
}

/* ── Mode switcher ───────────────────────────────────────── */
document.querySelectorAll('.pp-mode').forEach(el => {
    el.addEventListener('click', () => {
        const mode = el.dataset.mode;
        setActiveMode(mode);
        chrome.runtime.sendMessage({ type: 'SET_MODE', mode });
        document.getElementById('pp-mode-val').textContent = MODE_LABELS[mode];
        document.getElementById('pp-status-text').textContent = `Switched to ${MODE_LABELS[mode]}`;
    });
});

function setActiveMode(mode) {
    document.querySelectorAll('.pp-mode').forEach(c => c.classList.remove('active'));
    document.getElementById(`pp-mc-${mode}`)?.classList.add('active');
    currentMode = mode;
    document.getElementById('pp-mode-val').textContent = MODE_LABELS[mode];
}

/* ── Toggle ──────────────────────────────────────────────── */
document.getElementById('pp-enabled').addEventListener('change', (e) => {
    const enabled = e.target.checked;
    chrome.runtime.sendMessage({ type: 'SET_ENABLED', enabled });
    const dot = document.getElementById('pp-dot');
    if (enabled) dot.classList.add('on');
    else dot.classList.remove('on');
    document.getElementById('pp-status-text').textContent =
        enabled ? `Active · ${MODE_LABELS[currentMode]}` : 'Extension disabled';
});

/* ── Action buttons ──────────────────────────────────────── */
document.getElementById('pp-open-panel').addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) chrome.sidePanel.open({ tabId: tabs[0].id });
    });
    window.close();
});

document.getElementById('pp-open-options').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
});

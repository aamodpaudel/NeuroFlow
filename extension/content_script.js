/**
 * content_script.js — NeuroFlow
 * Injected into every page. Manages floating pill,
 * applies mode CSS classes, and injects mode-specific overlays.
 */

/* ── State ─────────────────────────────────────────────────── */
let currentMode = 'neuroshield';
let isEnabled = true;
let currentCLS = 0;
let sessionStart = Date.now();
let pomodoroTimer = null;
let studyTimer = null;
let breathingShown = false;
let checkShown = false;

const MODES = {
    neuroshield: { icon: '🛡', label: 'NeuroShield', cls: 'nf-neuroshield' },
    devcompass: { icon: '💻', label: 'DevCompass', cls: 'nf-devcompass' },
    zenflow: { icon: '🌿', label: 'ZenFlow', cls: 'nf-zenflow' },
    focuslens: { icon: '🎓', label: 'FocusLens', cls: 'nf-focuslens' },
};

/* ── Init — load settings from storage ─────────────────────── */
if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.local.get('nf_settings', (data) => {
        const s = data?.nf_settings;
        if (s) {
            currentMode = s.mode ?? 'neuroshield';
            isEnabled = s.enabled ?? true;
        }
        if (isEnabled) {
            applyMode(currentMode);
            injectPill();
        }
    });
}

/* ── Message listener ───────────────────────────────────────── */
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg.type) {
        case 'AU_UPDATE':
            handleAUUpdate(msg.au04, msg.au45, msg.cls);
            sendResponse({ ok: true });
            break;
        case 'MODE_CHANGE':
            currentMode = msg.mode;
            applyMode(msg.mode);
            sendResponse({ ok: true });
            break;
        case 'SET_ENABLED':
            isEnabled = msg.enabled;
            if (!isEnabled) removeAllModes();
            else { applyMode(currentMode); injectPill(); }
            sendResponse({ ok: true });
            break;
        case 'INTERVENTION_ON':
            triggerIntervention(msg.mode ?? currentMode, msg.severity ?? 0.8);
            sendResponse({ ok: true });
            break;
        case 'INTERVENTION_OFF':
            removeIntervention();
            sendResponse({ ok: true });
            break;
        case 'BREAK_REMINDER':
            showBreakOverlay();
            sendResponse({ ok: true });
            break;
        case 'HEARTBEAT':
            if (isEnabled && msg.mode) { currentMode = msg.mode; applyMode(msg.mode); }
            sendResponse({ ok: true });
            break;
    }
});

/* ── Apply mode ─────────────────────────────────────────────── */
function applyMode(mode) {
    removeAllModes();
    if (!isEnabled || !MODES[mode]) return;
    document.body.classList.add(MODES[mode].cls);

    // Mode-specific init
    switch (mode) {
        case 'devcompass': initPomodoro(); break;
        case 'focuslens': initStudyTimer(); break;
        case 'zenflow':    /* passive — triggered by AU spike */ break;
        default: break;
    }
    updatePill();
}

function removeAllModes() {
    Object.values(MODES).forEach(m => document.body.classList.remove(m.cls));
    document.body.classList.remove('nf-high-load');
    removePill();
    removePomodoro();
    removeStudyTimer();
    removeBreathing();
    removeStepAway();
    removeFocusCheck();
}

/* ── AU update handler ──────────────────────────────────────── */
function handleAUUpdate(au04, au45, cls) {
    currentCLS = cls;
    updatePill();

    // NeuroShield: apply greyscale when high load
    if (currentMode === 'neuroshield') {
        if (au04 > 0.65) document.body.classList.add('nf-high-load');
        else document.body.classList.remove('nf-high-load');
    }

    // ZenFlow: show breathing overlay on AU04 spike
    if (currentMode === 'zenflow' && au04 > 0.72 && !breathingShown) {
        breathingShown = true;
        setTimeout(() => showBreathing(), 800);
    }

    // FocusLens: show focus check on very low blink rate (fatigue)
    if (currentMode === 'focuslens' && au45 < 0.15 && !checkShown) {
        checkShown = true;
        showFocusCheck();
    }
}

/* ── Floating Pill ──────────────────────────────────────────── */
function injectPill() {
    if (document.getElementById('nf-pill')) return;
    const pill = document.createElement('div');
    pill.id = 'nf-pill';
    pill.innerHTML = `
    <span class="nf-pill-dot" id="nf-pill-dot"></span>
    <span class="nf-pill-icon nf-pill-text" id="nf-pill-icon">🛡</span>
    <span class="nf-pill-text" id="nf-pill-label">NeuroShield</span>
    <span class="nf-pill-score nf-pill-text" id="nf-pill-score">CLS: –</span>
  `;
    pill.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'OPEN_SIDEPANEL' });
    });
    document.body.appendChild(pill);
    updatePill();
}

function updatePill() {
    const pill = document.getElementById('nf-pill');
    if (!pill) { if (isEnabled) injectPill(); return; }

    const mode = MODES[currentMode] ?? MODES['neuroshield'];
    const dot = document.getElementById('nf-pill-dot');
    const icon = document.getElementById('nf-pill-icon');
    const label = document.getElementById('nf-pill-label');
    const score = document.getElementById('nf-pill-score');

    if (icon) icon.textContent = mode.icon;
    if (label) label.textContent = mode.label;
    if (score) score.textContent = `CLS: ${(currentCLS).toFixed(2)}`;

    // Colour the dot by CLS risk
    if (dot) {
        dot.className = 'nf-pill-dot';
        if (currentCLS > 0.65) dot.classList.add('alert');
        else if (currentCLS > 0.4) dot.classList.add('warn');
    }
}

function removePill() {
    document.getElementById('nf-pill')?.remove();
}

/* ── Pomodoro (DevCompass) ──────────────────────────────────── */
const POMODORO_WORK_SEC = 25 * 60;
const POMODORO_BREAK_SEC = 5 * 60;

function initPomodoro() {
    if (document.getElementById('nf-pomodoro')) return;
    const el = document.createElement('div');
    el.id = 'nf-pomodoro';
    el.innerHTML = `
    <span class="nf-pm-label">DevCompass · Pomodoro</span>
    <span class="nf-pm-time" id="nf-pm-time">25:00</span>
    <span class="nf-pm-phase" id="nf-pm-phase">🔥 Focus session</span>
    <div class="nf-pm-bar-bg"><div class="nf-pm-bar-fill" id="nf-pm-bar"></div></div>
  `;
    document.body.appendChild(el);
    startPomodoroCycle();
}

function startPomodoroCycle(phase = 'work') {
    const total = phase === 'work' ? POMODORO_WORK_SEC : POMODORO_BREAK_SEC;
    let remaining = total;

    pomodoroTimer && clearInterval(pomodoroTimer);
    pomodoroTimer = setInterval(() => {
        remaining--;
        const m = String(Math.floor(remaining / 60)).padStart(2, '0');
        const s = String(remaining % 60).padStart(2, '0');
        const timeEl = document.getElementById('nf-pm-time');
        const barEl = document.getElementById('nf-pm-bar');
        const phaseEl = document.getElementById('nf-pm-phase');
        if (timeEl) timeEl.textContent = `${m}:${s}`;
        if (barEl) barEl.style.width = `${((total - remaining) / total) * 100}%`;
        if (phaseEl) phaseEl.textContent = phase === 'work' ? '🔥 Focus session' : '☕ Break time';

        if (remaining <= 0) {
            clearInterval(pomodoroTimer);
            if (phase === 'work') { showBreakOverlay(); startPomodoroCycle('break'); }
            else { startPomodoroCycle('work'); }
        }
    }, 1000);
}

function removePomodoro() {
    pomodoroTimer && clearInterval(pomodoroTimer);
    document.getElementById('nf-pomodoro')?.remove();
}

/* ── Break overlay (DevCompass) ─────────────────────────────── */
function showBreakOverlay() {
    if (document.getElementById('nf-break-overlay')) return;
    const el = document.createElement('div');
    el.id = 'nf-break-overlay';
    el.innerHTML = `
    <div style="font-size:3rem">☕</div>
    <h2>Pomodoro Break!</h2>
    <p>You've been focused for 25 minutes. Your brain is requesting a 5-minute rest. Step away from the screen.</p>
    <button id="nf-break-dismiss">I'm back — Resume Focus →</button>
  `;
    document.body.appendChild(el);
    document.getElementById('nf-break-dismiss')?.addEventListener('click', () => {
        document.getElementById('nf-break-overlay')?.remove();
    });
}

/* ── Breathing overlay (ZenFlow) ────────────────────────────── */
function showBreathing() {
    if (document.getElementById('nf-breathing')) return;
    const el = document.createElement('div');
    el.id = 'nf-breathing';
    let phase = 'Breathe in…';
    let cycle = 0;
    el.innerHTML = `
    <div style="font-size:0.85rem;color:#7C3AED;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;font-family:Inter,sans-serif;">ZenFlow · Stress Spike Detected</div>
    <div class="nf-breath-ring"><div class="nf-breath-inner"></div></div>
    <div class="nf-breath-label" id="nf-breath-label">${phase}</div>
    <div class="nf-breath-sub">Follow the circle. 4 seconds in, 4 seconds out.</div>
    <button id="nf-breath-dismiss">I feel better · Close ✕</button>
  `;
    document.body.appendChild(el);

    const labelEl = document.getElementById('nf-breath-label');
    const breathInterval = setInterval(() => {
        cycle++;
        phase = cycle % 2 === 0 ? 'Breathe in…' : 'Breathe out…';
        if (labelEl) labelEl.textContent = phase;
        if (cycle >= 8) { clearInterval(breathInterval); } // 4 cycles
    }, 4000);

    document.getElementById('nf-breath-dismiss')?.addEventListener('click', () => {
        clearInterval(breathInterval);
        removeBreathing();
        breathingShown = false;
        showStepAway();
    });
}

function removeBreathing() { document.getElementById('nf-breathing')?.remove(); }

/* ── Step-away prompt (ZenFlow) ─────────────────────────────── */
function showStepAway() {
    if (document.getElementById('nf-stepaway')) return;
    const el = document.createElement('div');
    el.id = 'nf-stepaway';
    el.innerHTML = `
    <button class="nf-sa-close" id="nf-sa-close">✕</button>
    <strong>🌿 Feeling better?</strong>
    High stress was detected. Consider stepping away for a few minutes. Your cognitive score will be logged.
  `;
    document.body.appendChild(el);
    document.getElementById('nf-sa-close')?.addEventListener('click', removeStepAway);
    setTimeout(removeStepAway, 12000);
}

function removeStepAway() { document.getElementById('nf-stepaway')?.remove(); }

/* ── Study timer (FocusLens) ────────────────────────────────── */
function initStudyTimer() {
    if (document.getElementById('nf-studytimer')) return;
    const el = document.createElement('div');
    el.id = 'nf-studytimer';
    el.innerHTML = `
    <span class="nf-st-icon">🎓</span>
    <span>Study session:</span>
    <span class="nf-st-time" id="nf-st-elapsed">00:00</span>
    <span class="nf-st-sep">|</span>
    <span>Load:</span>
    <span class="nf-st-cls" id="nf-st-cls">–</span>
  `;
    document.body.appendChild(el);

    studyTimer = setInterval(() => {
        const elapsed = Math.floor((Date.now() - sessionStart) / 1000);
        const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
        const s = String(elapsed % 60).padStart(2, '0');
        const timeEl = document.getElementById('nf-st-elapsed');
        const clsEl = document.getElementById('nf-st-cls');
        if (timeEl) timeEl.textContent = `${m}:${s}`;
        if (clsEl) clsEl.textContent = currentCLS.toFixed(2);
    }, 1000);
}

function removeStudyTimer() {
    studyTimer && clearInterval(studyTimer);
    document.getElementById('nf-studytimer')?.remove();
}

/* ── Focus check prompt (FocusLens) ─────────────────────────── */
function showFocusCheck() {
    if (document.getElementById('nf-focuscheck')) return;
    const el = document.createElement('div');
    el.id = 'nf-focuscheck';
    el.innerHTML = `
    <strong>👁 Fatigue detected</strong>
    Your blink rate is low — a sign of eye strain. Take 20 seconds to look at something 20 feet away.
    <br/>
    <button id="nf-fc-ok">Got it ✓</button>
  `;
    document.body.appendChild(el);
    document.getElementById('nf-fc-ok')?.addEventListener('click', () => {
        removeFocusCheck();
        checkShown = false;
    });
    setTimeout(() => { removeFocusCheck(); checkShown = false; }, 15000);
}

function removeFocusCheck() { document.getElementById('nf-focuscheck')?.remove(); }

/* ── Trigger intervention (catch-all) ───────────────────────── */
function triggerIntervention(mode, severity) {
    if (mode === 'zenflow') showBreathing();
    if (mode === 'devcompass' && severity > 0.75) showBreakOverlay();
}

function removeIntervention() {
    removeBreathing();
    removeStepAway();
    removeFocusCheck();
}

/* ── SPA re-apply via MutationObserver ──────────────────────── */
let reapplyDebounce = null;
new MutationObserver(() => {
    clearTimeout(reapplyDebounce);
    reapplyDebounce = setTimeout(() => {
        if (!isEnabled) return;
        // Re-inject pill if SPA nuked the DOM
        if (!document.getElementById('nf-pill')) injectPill();
        // Re-apply mode class if lost
        const mc = MODES[currentMode]?.cls;
        if (mc && !document.body.classList.contains(mc)) document.body.classList.add(mc);
    }, 600);
}).observe(document.body, { childList: true, subtree: false });

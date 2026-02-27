/**
 * background.js — NeuroFlow Service Worker
 * Handles: side panel toggle, message routing, alarms, session storage
 */

// ── Open side panel on toolbar icon click ────────────────────
chrome.action.onClicked.addListener((tab) => {
    chrome.sidePanel.open({ tabId: tab.id });
});

// ── Set side panel behaviour ──────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

    // Default settings
    chrome.storage.local.get('nf_settings', (data) => {
        if (!data.nf_settings) {
            chrome.storage.local.set({
                nf_settings: {
                    mode: 'neuroshield',   // active mode
                    enabled: true,
                    threshold: 0.65,            // AU04 trigger threshold
                    triggerDelaySec: 3,               // seconds above threshold before intervention
                    breakIntervalMin: 45,              // DevCompass break reminder
                    domainWhitelist: [],
                    domainBlacklist: [],
                },
                nf_session: {
                    startTime: Date.now(),
                    scores: [],
                    peakCLS: 0,
                    interventions: 0,
                }
            });
        }
    });

    // Set up DevCompass break alarm
    chrome.alarms.create('devcompass_break', { periodInMinutes: 45 });
    chrome.alarms.create('session_persist', { periodInMinutes: 1 });
});

// ── Message router ────────────────────────────────────────────
// Routes messages between sidepanel ↔ content scripts ↔ popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

    // Content script → background → relay to side panel (not needed; side panel polls storage)
    if (msg.type === 'CONTENT_READY') {
        sendResponse({ ok: true });
        return;
    }

    // Side panel tells background to forward to active tab's content script
    if (msg.type === 'TO_CONTENT') {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, msg.payload).catch(() => { });
            }
        });
        sendResponse({ ok: true });
        return;
    }

    // Store session score
    if (msg.type === 'STORE_SCORE') {
        chrome.storage.local.get('nf_session', (data) => {
            const session = data.nf_session || { scores: [], peakCLS: 0, interventions: 0 };
            session.scores.push({ t: Date.now(), ...msg.payload });
            if (msg.payload.cls > session.peakCLS) session.peakCLS = msg.payload.cls;
            if (session.scores.length > 1000) session.scores.shift(); // cap at 1000 pts
            chrome.storage.local.set({ nf_session: session });
        });
        sendResponse({ ok: true });
        return;
    }

    // Mode change — update settings + notify active tab
    if (msg.type === 'SET_MODE') {
        chrome.storage.local.get('nf_settings', (data) => {
            const settings = data.nf_settings || {};
            settings.mode = msg.mode;
            chrome.storage.local.set({ nf_settings: settings });
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs[0]) {
                    chrome.tabs.sendMessage(tabs[0].id, { type: 'MODE_CHANGE', mode: msg.mode }).catch(() => { });
                }
            });
        });
        sendResponse({ ok: true });
        return;
    }

    // Toggle extension on/off
    if (msg.type === 'SET_ENABLED') {
        chrome.storage.local.get('nf_settings', (data) => {
            const settings = data.nf_settings || {};
            settings.enabled = msg.enabled;
            chrome.storage.local.set({ nf_settings: settings });
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs[0]) {
                    chrome.tabs.sendMessage(tabs[0].id, { type: 'SET_ENABLED', enabled: msg.enabled }).catch(() => { });
                }
            });
        });
        sendResponse({ ok: true });
        return;
    }
});

// ── Alarms ────────────────────────────────────────────────────
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'devcompass_break') {
        chrome.storage.local.get('nf_settings', (data) => {
            if (data.nf_settings?.mode === 'devcompass' && data.nf_settings?.enabled) {
                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    if (tabs[0]) {
                        chrome.tabs.sendMessage(tabs[0].id, { type: 'BREAK_REMINDER' }).catch(() => { });
                    }
                });
                chrome.notifications.create('break_reminder', {
                    type: 'basic',
                    iconUrl: 'icons/icon48.png',
                    title: 'NeuroFlow — Time for a Break',
                    message: "You've been coding for 45 minutes. Your AU04 says your brain agrees. Take 5. 🧠",
                });
            }
        });
    }

    if (alarm.name === 'session_persist') {
        // Ping all content scripts to stay alive / re-apply mode
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
                chrome.storage.local.get('nf_settings', (data) => {
                    if (data.nf_settings?.enabled) {
                        chrome.tabs.sendMessage(tabs[0].id, {
                            type: 'HEARTBEAT',
                            mode: data.nf_settings.mode,
                        }).catch(() => { });
                    }
                });
            }
        });
    }
});

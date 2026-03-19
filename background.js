// ============================================================
// background.js — Manifest V3 Service Worker
// Handles all Supabase API communication.
// ============================================================

const SUPABASE_URL      = "https://uxcwmzmktamtlyvwzsua.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4Y3dtem1rdGFtdGx5dnd6c3VhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0MDg4NTUsImV4cCI6MjA4Nzk4NDg1NX0.A3ws0EGQqBWbR9ufnkytxIaaZNMm4Oa12gbIkL6cl_g";

const TABLE_NAME    = "UNcomfirmed_Table";
const REST_ENDPOINT = `${SUPABASE_URL}/rest/v1/${TABLE_NAME}`;

// ── Supabase POST ─────────────────────────────────────────────

/**
 * Column mapping:
 *   "User"       ← "LocalUser"
 *   "Question"   ← data.question   (extracted question text)
 *   "Image"      ← data.imageId    (UUID from figure image, or null)
 *   "Answer"     ← data.answer     (student's entered answer, or null)
 *   "Confirmed?" ← false
 */
async function postToSupabase(data) {
    const row = {
        "User":       "LocalUser",
        "Question":   data.question,
        "Image":      data.imageId ?? null,
        "Answer":     data.answer  ?? null,
        "Confirmed?": false,
    };

    try {
        const response = await fetch(REST_ENDPOINT, {
            method: "POST",
            headers: {
                "Content-Type":  "application/json",
                "apikey":        SUPABASE_ANON_KEY,
                "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
                "Prefer":        "return=representation",
            },
            body: JSON.stringify(row),
        });

        if (!response.ok) {
            const errorBody = await response.json().catch(() => ({}));
            const message   = errorBody.message || errorBody.error || `HTTP ${response.status}`;
            console.error("[SparxLess] Supabase POST failed:", message, errorBody);
            return { success: false, error: message };
        }

        const inserted = await response.json();
        console.log("[SparxLess] Row inserted:", inserted);
        return { success: true, data: inserted };

    } catch (err) {
        console.error("[SparxLess] Network error:", err);
        return { success: false, error: `Network error: ${err.message}` };
    }
}

// ── Message Router ────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {

    // Content script sends extracted payload → POST to Supabase
    if (message.action === "POST_TO_SUPABASE") {
        postToSupabase(message.payload).then(sendResponse);
        return true;
    }

    // Popup requests a save → ask active tab's content script to extract first
    if (message.action === "SAVE_QUESTION") {
        chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
            const tabId = tabs[0]?.id;
            if (!tabId) {
                sendResponse({ success: false, error: "No active tab." });
                return;
            }
            try {
                const res = await chrome.tabs.sendMessage(tabId, { action: "SAVE_QUESTION" });
                sendResponse(res);
            } catch {
                sendResponse({
                    success: false,
                    error: "Content script unreachable. Are you on a Sparx question page?",
                });
            }
        });
        return true;
    }
});

chrome.runtime.onInstalled.addListener(() => {
    console.log("[SparxLess] Service worker ready.");
});
// ============================================================
// background.js — Manifest V3 Service Worker
// Handles all Supabase API communication.
// ============================================================

const SUPABASE_URL      = "https://uxcwmzmktamtlyvwzsua.supabase.co";
const SUPABASE_ANON_KEY    = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4Y3dtem1rdGFtdGx5dnd6c3VhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0MDg4NTUsImV4cCI6MjA4Nzk4NDg1NX0.A3ws0EGQqBWbR9ufnkytxIaaZNMm4Oa12gbIkL6cl_g";


const UNCONFIRMED_TABLE   = "UNcomfirmed_Table";
const CONFIRMED_TABLE     = "Con_Table";
const UNCONFIRMED_ENDPOINT = `${SUPABASE_URL}/rest/v1/${UNCONFIRMED_TABLE}`;
const CONFIRMED_ENDPOINT   = `${SUPABASE_URL}/rest/v1/${CONFIRMED_TABLE}`;

const SUPABASE_HEADERS = {
    "Content-Type":  "application/json",
    "apikey":        SUPABASE_ANON_KEY,
    "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
};


// ── Supabase POST ─────────────────────────────────────────────

async function postToSupabase(data) {
    const question    = data.question;
    const imageId     = data.imageId    ?? null;
    const answer      = data.answer     ?? "Unknown";
    const studentName = data.studentName ?? "Unknown";

    try {
        // Check if a row with this Question already exists
        const checkUrl = `${UNCONFIRMED_ENDPOINT}?Question=eq.${encodeURIComponent(question)}&limit=1`;
        const checkRes = await fetch(checkUrl, { headers: SUPABASE_HEADERS });
        const existing = checkRes.ok ? await checkRes.json() : [];

        if (Array.isArray(existing) && existing.length > 0) {
            // Row already exists — PATCH it with the latest answer/user instead of duplicating
            const patchUrl = `${UNCONFIRMED_ENDPOINT}?Question=eq.${encodeURIComponent(question)}`;
            const patchRes = await fetch(patchUrl, {
                method: "PATCH",
                headers: { ...SUPABASE_HEADERS, "Prefer": "return=minimal" },
                body: JSON.stringify({ "Answer": answer, "User": studentName, "Image": imageId }),
            });
            if (!patchRes.ok) {
                const err = await patchRes.json().catch(() => ({}));
                const msg = err.message || err.error || `HTTP ${patchRes.status}`;
                console.error("[SparxLess] PATCH existing row failed:", msg);
                return { success: false, error: msg };
            }
            console.log("[SparxLess] Updated existing row for question.");
            return { success: true };
        }

        // No existing row — INSERT fresh
        const row = {
            "User":       studentName,
            "Question":   question,
            "Image":      imageId,
            "Answer":     answer,
            "Confirmed?": false,
        };
        const insertRes = await fetch(UNCONFIRMED_ENDPOINT, {
            method: "POST",
            headers: { ...SUPABASE_HEADERS, "Prefer": "return=minimal" },
            body: JSON.stringify(row),
        });
        if (!insertRes.ok) {
            const err = await insertRes.json().catch(() => ({}));
            const msg = err.message || err.error || `HTTP ${insertRes.status}`;
            console.error("[SparxLess] INSERT failed:", msg);
            return { success: false, error: msg };
        }
        console.log("[SparxLess] Row inserted.");
        return { success: true };

    } catch (err) {
        console.error("[SparxLess] Network error:", err);
        return { success: false, error: `Network error: ${err.message}` };
    }
}

// ── Supabase LOOKUP ───────────────────────────────────────────
// Checks Con_Table first (confirmed answers), then UNcomfirmed_Table.
// Matches on Question text. If imageId is also provided, requires that too.
// Returns: { found: true, answer, confirmed: true/false }
//      or: { found: false }

async function lookupInSupabase({ question, imageId }) {
    if (!question) return { found: false };

    async function queryTable(endpoint) {
        try {
            // Build filter: always match on Question, optionally also on Image
            let url = `${endpoint}?Question=eq.${encodeURIComponent(question)}&Answer=not.is.null&limit=1`;
            if (imageId) url += `&Image=eq.${encodeURIComponent(imageId)}`;

            const res = await fetch(url, { headers: SUPABASE_HEADERS });
            if (!res.ok) return null;
            const rows = await res.json();
            return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
        } catch {
            return null;
        }
    }

    // 1. Try confirmed table first
    const confirmedRow = await queryTable(CONFIRMED_ENDPOINT);
    if (confirmedRow?.Answer) {
        return { found: true, answer: confirmedRow.Answer, confirmed: true };
    }

    // 2. Fall back to unconfirmed table
    const unconfirmedRow = await queryTable(`${SUPABASE_URL}/rest/v1/${UNCONFIRMED_TABLE}`);
    if (unconfirmedRow?.Answer) {
        return { found: true, answer: unconfirmedRow.Answer, confirmed: false };
    }

    return { found: false };
}

// ── Supabase CONFIRM ─────────────────────────────────────────
// Sets "Confirmed?" = true on any row in UNcomfirmed_Table that matches
// the given question text and (optionally) imageId.

async function confirmInSupabase({ question, imageId }) {
    if (!question) return { success: false, error: "No question provided." };

    try {
        // Step 1: Read back the row so we can see exactly what's stored
        const readUrl = `${UNCONFIRMED_ENDPOINT}?Question=eq.${encodeURIComponent(question)}&limit=5`;
        const readRes = await fetch(readUrl, { headers: SUPABASE_HEADERS });
        const rows = readRes.ok ? await readRes.json() : [];
        console.log("[SparxLess] Confirm — rows found in DB:", JSON.stringify(rows));

        if (!Array.isArray(rows) || rows.length === 0) {
            console.warn("[SparxLess] Confirm — no matching rows found, cannot confirm.");
            return { success: false, error: "No matching row found." };
        }

        // Step 2: PATCH using the row's actual id to be 100% precise
        const rowId = rows[0].id;
        const patchUrl = `${UNCONFIRMED_ENDPOINT}?id=eq.${rowId}`;
        console.log("[SparxLess] Confirm — PATCHing row id:", rowId, "at:", patchUrl);

        const response = await fetch(patchUrl, {
            method: "PATCH",
            headers: { ...SUPABASE_HEADERS, "Prefer": "return=representation" },
            body: JSON.stringify({ "Confirmed?": true }),
        });

        const responseText = await response.text();
        console.log("[SparxLess] Confirm PATCH status:", response.status, "body:", responseText);

        if (!response.ok) {
            const errorBody = JSON.parse(responseText || "{}");
            const message = errorBody.message || errorBody.error || `HTTP ${response.status}`;
            console.error("[SparxLess] Confirm PATCH failed:", message);
            return { success: false, error: message };
        }

        console.log("[SparxLess] Confirmed? set to true for row id:", rowId);
        return { success: true };

    } catch (err) {
        console.error("[SparxLess] Confirm PATCH error:", err.message);
        return { success: false, error: err.message };
    }
}

// ── Supabase DELETE (wrong answer) ───────────────────────────
// Removes rows from UNcomfirmed_Table where the answer was wrong,
// matched by Question + Image (if available).

async function deleteFromSupabase({ question, imageId }) {
    if (!question) return { success: false, error: "No question provided." };

    async function del(url) {
        const response = await fetch(url, {
            method: "DELETE",
            headers: { ...SUPABASE_HEADERS, "Prefer": "return=minimal" },
        });
        if (!response.ok) {
            const errorBody = await response.json().catch(() => ({}));
            throw new Error(errorBody.message || errorBody.error || `HTTP ${response.status}`);
        }
        const deleted = await response.json().catch(() => []);
        return Array.isArray(deleted) ? deleted.length : 0;
    }

    try {
        let matched = 0;

        if (imageId) {
            const urlWithImage = `${UNCONFIRMED_ENDPOINT}?Question=eq.${encodeURIComponent(question)}&Image=eq.${encodeURIComponent(imageId)}`;
            matched = await del(urlWithImage);
            console.log(`[SparxLess] Delete (Q+Image): ${matched} row(s) removed`);
        }

        if (matched === 0) {
            const urlQOnly = `${UNCONFIRMED_ENDPOINT}?Question=eq.${encodeURIComponent(question)}`;
            matched = await del(urlQOnly);
            console.log(`[SparxLess] Delete (Q only): ${matched} row(s) removed`);
        }

        return { success: true, matched };

    } catch (err) {
        console.error("[SparxLess] DELETE error:", err.message);
        return { success: false, error: err.message };
    }
}

// ── Message Router ────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {

    if (message.action === "POST_TO_SUPABASE") {
        postToSupabase(message.payload).then(sendResponse);
        return true;
    }

    if (message.action === "LOOKUP_SUPABASE") {
        lookupInSupabase(message.payload).then(sendResponse);
        return true;
    }

    if (message.action === "DELETE_FROM_SUPABASE") {
        deleteFromSupabase(message.payload).then(sendResponse);
        return true;
    }

    if (message.action === "CONFIRM_IN_SUPABASE") {
        confirmInSupabase(message.payload).then(sendResponse);
        return true;
    }

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
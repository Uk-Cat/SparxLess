const LOGO_URL = "https://static.sparx-learning.com/maths/49f67c3f6d3820553ea268777b7794e6f449e1fd/assets/sparx_maths_logo-BRwQ1-wz.svg";

// ─── STORAGE KEYS ────────────────────────────────────────────────────────────
const BOOKWORK_STORAGE_KEY = "SparxLessBookwork";
const PENDING_STORAGE_KEY  = "SparxLessPending"; // persists until overwritten by next interaction

function getBookworkStore() {
    return new Promise(resolve => {
        chrome.storage.local.get([BOOKWORK_STORAGE_KEY], result => {
            resolve(result[BOOKWORK_STORAGE_KEY] || {});
        });
    });
}

function setBookworkStore(store) {
    return new Promise(resolve => {
        chrome.storage.local.set({ [BOOKWORK_STORAGE_KEY]: store }, resolve);
    });
}

// ─── NOISE FILTER ────────────────────────────────────────────────────────────

function isNoise(text) {
    return ["Question Preview", "Bookwork code", "To pick up a draggable"].some(p => text.startsWith(p));
}

// ─── LATEX-AWARE TEXT EXTRACTION ─────────────────────────────────────────────

function extractTextNodes(node) {
    if (node.classList && node.classList.contains('katex')) {
        const annotation = node.querySelector('annotation[encoding="application/x-tex"]');
        return annotation ? ` ${annotation.textContent} ` : node.innerText;
    }
    if (node.classList && (node.classList.contains('katex-html') || node.classList.contains('katex-mathml'))) {
        return '';
    }
    if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent;
    }
    let text = '';
    for (let child of node.childNodes) {
        text += extractTextNodes(child);
    }
    return text;
}

function findAndExtractAll() {
    const containers = document.querySelectorAll('[class*="_TextElement_"], [class*="_QuestionContainer_"]');
    let results = [];
    containers.forEach(container => {
        const cleaned = extractTextNodes(container).replace(/\s+/g, ' ').trim();
        if (cleaned && !isNoise(cleaned) && !results.includes(cleaned)) {
            results.push(cleaned);
        }
    });
    return results.join('\n\n');
}

// ─── QUESTION TEXT ────────────────────────────────────────────────────────────

function getCurrentQuestionText() {
    const containers = document.querySelectorAll('[class*="_TextElement_"], [class*="_QuestionContainer_"]');
    for (const container of containers) {
        const cleaned = extractTextNodes(container).replace(/\s+/g, ' ').trim();
        if (cleaned && !isNoise(cleaned)) return cleaned;
    }
    return null;
}

// ─── IMAGE ID EXTRACTION ──────────────────────────────────────────────────────

function getCurrentImageId() {
    const imgs = document.querySelectorAll('img');
    const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    for (const img of imgs) {
        const src = img.src || '';
        if (src === LOGO_URL) continue;
        if (!src.includes('sparx-learning.com') && !src.includes('sparxmaths')) continue;
        const match = src.match(uuidRegex);
        if (match) return match[0];
    }
    return null;
}

// ─── ANSWER EXTRACTION ───────────────────────────────────────────────────────

function getCurrentAnswer() {
    const values = [];

    // Numeric/text inputs — covers data-ref="BQB", data-ref="BIP", and plain number fields
    document.querySelectorAll('input[type="text"], input[type="number"], input[inputmode="decimal"], input[inputmode="numeric"]').forEach(input => {
        const val = input.value?.trim();
        if (val) values.push(val);
    });

    // Filled drag-drop card slots
    document.querySelectorAll('[class*="_CardContent_"]:not([class*="_CardContentEmpty_"])').forEach(card => {
        const text = card.innerText?.trim();
        if (text) values.push(text);
    });

    // Selected multiple-choice tiles
    document.querySelectorAll('[class*="_Tile_"][class*="_selected_"], [class*="_Tile_"][aria-pressed="true"]').forEach(tile => {
        const annotation = tile.querySelector('annotation[encoding="application/x-tex"]');
        const text = annotation ? annotation.textContent.trim() : tile.innerText?.trim();
        if (text) values.push(text);
    });

    // Generic selected choices
    document.querySelectorAll('[class*="_Choice_"][class*="_selected_"], [class*="_Option_"][aria-selected="true"]').forEach(choice => {
        const text = choice.innerText?.trim();
        if (text) values.push(text);
    });

    return [...new Set(values)].join(', ') || null;
}

// ─── PENDING TEMP STORE ───────────────────────────────────────────────────────

/**
 * Snapshot the current question + imageId + answer into chrome.storage.local.
 * This persists across popup opens and is only overwritten when called again
 * (i.e. on every interaction, and once on page load).
 * The SAVE_QUESTION handler always reads from here first.
 */
function savePending() {
    const question = getCurrentQuestionText();
    const imageId  = getCurrentImageId();
    const answer   = getCurrentAnswer();

    // Only write if we have at least a question — don't blank out a previous entry
    if (!question) return;

    chrome.storage.local.set({
        [PENDING_STORAGE_KEY]: { question, imageId: imageId ?? null, answer: answer ?? null }
    });
}

// ─── BOOKWORK SAVING ──────────────────────────────────────────────────────────

function getCurrentBookworkCode() {
    const codeEl = document.querySelector('[class*="_BookworkCode_"], [class*="_Bookwork_"]');
    if (codeEl) {
        const text  = codeEl.innerText || codeEl.textContent;
        const match = text.match(/Bookwork code[:\s]+([A-Z0-9]+)/i);
        if (match) return match[1].trim();
        const fallback = text.trim().replace(/\s+/g, '');
        if (/^[A-Z0-9]{1,4}$/i.test(fallback)) return fallback;
    }
    return null;
}

function extractCurrentAnswers() {
    const answers = [];

    document.querySelectorAll('input[type="text"], input[type="number"], input[inputmode="decimal"], input[inputmode="numeric"]').forEach(input => {
        const val = input.value?.trim();
        if (val) answers.push(val);
    });

    document.querySelectorAll('[class*="_CardContent_"]:not([class*="_CardContentEmpty_"])').forEach(card => {
        const text = card.innerText?.trim();
        if (text) answers.push(text);
    });

    document.querySelectorAll('[class*="_Tile_"][class*="_selected_"], [class*="_Tile_"][aria-pressed="true"]').forEach(tile => {
        const annotation = tile.querySelector('annotation[encoding="application/x-tex"]');
        const text = annotation ? annotation.textContent.trim() : tile.innerText?.trim();
        if (text) answers.push(text);
    });

    document.querySelectorAll('[class*="_Choice_"][class*="_selected_"], [class*="_Option_"][aria-selected="true"]').forEach(choice => {
        const text = choice.innerText?.trim();
        if (text && !answers.includes(text)) answers.push(text);
    });

    return [...new Set(answers)];
}

async function saveCurrentAnswer() {
    const code         = getCurrentBookworkCode();
    const questionText = getCurrentQuestionText();
    const answers      = extractCurrentAnswers();

    if (!code || !questionText || answers.length === 0) return;

    const normalise = str => str.replace(/\$.*?\$/g, '').replace(/ +/g, ' ').trim();
    const store     = await getBookworkStore();
    const existing  = Array.isArray(store[code]) ? store[code] : [];
    const filtered  = existing.filter(entry => normalise(entry.id) !== normalise(questionText));
    filtered.unshift({ id: questionText, answers, date: Date.now() });
    store[code] = filtered;
    await setBookworkStore(store);
}

// ─── INTERACTION HANDLER ──────────────────────────────────────────────────────

function onInteraction() {
    saveCurrentAnswer(); // bookwork local store
    savePending();       // overwrite pending with latest state
}

function initAnswerSaving() {
    document.addEventListener('pointerdown', onInteraction, { capture: true });
    document.addEventListener('keydown',     onInteraction, { capture: true });

    // 'input' fires on every keystroke so decimals like 61.9 are captured
    // as the user finishes typing rather than snapshotting mid-number.
    document.addEventListener('input', onInteraction, { capture: true });

    // Write pending immediately on page load so there's always something stored
    // even if the user opens the popup before interacting with the question.
    savePending();
}

initAnswerSaving();

// ─── AUTO-SOLVE FILL ──────────────────────────────────────────────────────────

async function performAutoSolve(answer) {
    const slots = document.querySelectorAll('[class*="_CardContentEmpty_"]');
    for (let s of slots) { s.click(); await new Promise(r => setTimeout(r, 200)); }

    const tiles = document.querySelectorAll('[class*="_Tile_"], [class*="_CardContent_"]');
    tiles.forEach(t => {
        const val = t.innerText + (t.querySelector('annotation')?.textContent || "");
        if (answer.includes(val.trim())) t.click();
    });

    const input = document.querySelector('input[data-ref="BIP"], input[type="text"]');
    if (input) {
        const match = answer.match(/-?[0-9]+(\.[0-9]+)?/);
        if (match) {
            input.value = match[0];
            input.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }
}

// ─── MESSAGE LISTENER ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

    if (request.action === 'extractAll') {
        sendResponse({
            text:    findAndExtractAll(),
            imageId: getCurrentImageId(),
            answer:  getCurrentAnswer(),
            images:  Array.from(document.querySelectorAll('img'))
                         .map(i => i.src)
                         .filter(s => s && s !== LOGO_URL && s.includes('sparx-learning.com'))
        });

    } else if (request.action === 'autoSolve') {
        performAutoSolve(request.answer);

    } else if (request.action === 'getBookworkAnswers') {
        getBookworkStore().then(store => {
            sendResponse({ answers: store[request.code] || [] });
        });
        return true;

    } else if (request.action === 'getAllBookwork') {
        getBookworkStore().then(store => sendResponse({ store }));
        return true;

    } else if (request.action === 'SAVE_QUESTION') {
        chrome.storage.local.get([PENDING_STORAGE_KEY], (result) => {
            const pending = result[PENDING_STORAGE_KEY];

            // Prefer the stored pending snapshot; fall back to live DOM
            const question = pending?.question ?? getCurrentQuestionText();
            const imageId  = pending?.imageId  ?? getCurrentImageId();
            const answer   = pending?.answer   ?? getCurrentAnswer();

            // ── Debug output ─────────────────────────────────────────────────
            console.log('[SparxLess] ── Submitting to Unconfirmed ──────────────');
            console.log('[SparxLess] Question :', question);
            console.log('[SparxLess] Image ID :', imageId);
            console.log('[SparxLess] Answer   :', answer);
            console.log('[SparxLess] ─────────────────────────────────────────');

            if (!question) {
                sendResponse({ success: false, error: 'No question text found on page.' });
                return;
            }

            chrome.runtime.sendMessage(
                { action: 'POST_TO_SUPABASE', payload: { question, imageId, answer } },
                result => sendResponse(result)
            );
        });
        return true;
    }

    return true;
});
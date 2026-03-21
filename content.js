// Matches any Sparx logo regardless of content-hash or subject (maths/science)
function isSparxLogo(src) {
    return src.includes("sparx_maths_logo") || src.includes("sparx_science_logo") || src.includes("sparx_logo");
}

// ─── CONTEXT VALIDITY GUARD ───────────────────────────────────────────────────
// When the extension is reloaded while a content script is still running,
// all chrome.* API calls throw "Extension context invalidated".
// These helpers silently no-op in that case so errors stop appearing.

function isContextValid() {
    try { return !!chrome.runtime?.id; } catch { return false; }
}
function safeStorageGet(keys, cb) {
    if (!isContextValid()) return;
    try { chrome.storage.local.get(keys, cb); } catch { /* context gone */ }
}
function safeStorageSet(obj, cb) {
    if (!isContextValid()) return;
    try { chrome.storage.local.set(obj, cb); } catch { /* context gone */ }
}
function safeStorageRemove(keys, cb) {
    if (!isContextValid()) return;
    try { chrome.storage.local.remove(keys, cb); } catch { /* context gone */ }
}
function safeRuntimeSendMessage(msg, cb) {
    if (!isContextValid()) return;
    try { chrome.runtime.sendMessage(msg, cb); } catch { /* context gone */ }
}

// ─── STORAGE KEYS ────────────────────────────────────────────────────────────
const BOOKWORK_STORAGE_KEY = "SparxLessBookwork";
const PENDING_STORAGE_KEY  = "SparxLessPending";
const DISPLAY_STORAGE_KEY  = "SparxLessDisplay"; // persists question text + image URL for popup display

// Declared here so savePending (below) can reference them before the lock
// functions are defined further down in the file.
let _displayLocked = false;
let _lastUrl       = location.href;

function getBookworkStore() {
    return new Promise(resolve => {
        if (!isContextValid()) return resolve({});
        try {
            chrome.storage.local.get([BOOKWORK_STORAGE_KEY], result => {
                resolve(result[BOOKWORK_STORAGE_KEY] || {});
            });
        } catch { resolve({}); }
    });
}

function setBookworkStore(store) {
    return new Promise(resolve => {
        safeStorageSet({ [BOOKWORK_STORAGE_KEY]: store }, resolve);
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
    // Try scoped extraction: grab _TextElement_ nodes that sit inside a _Question_ wrapper
    const questionWrappers = document.querySelectorAll('[class*="_Question_"]');
    let results = [];

    if (questionWrappers.length > 0) {
        questionWrappers.forEach(wrapper => {
            wrapper.querySelectorAll('[class*="_TextElement_"]').forEach(el => {
                const cleaned = extractTextNodes(el).replace(/\s+/g, ' ').trim();
                if (cleaned && !isNoise(cleaned) && !results.includes(cleaned)) {
                    results.push(cleaned);
                }
            });
        });
    }

    // Fallback: any _TextElement_ or _QuestionContainer_ anywhere on the page
    if (results.length === 0) {
        document.querySelectorAll('[class*="_TextElement_"], [class*="_QuestionContainer_"]').forEach(container => {
            const cleaned = extractTextNodes(container).replace(/\s+/g, ' ').trim();
            if (cleaned && !isNoise(cleaned) && !results.includes(cleaned)) {
                results.push(cleaned);
            }
        });
    }

    return results.join('\n\n');
}

// ─── STUDENT NAME EXTRACTION ──────────────────────────────────────────────────
function getCurrentStudentName() {
    const el = document.querySelector('[class*="_StudentName_"]');
    if (el) {
        const name = el.innerText?.trim();
        if (name) return name;
    }
    return null;
}

// ─── QUESTION TEXT ────────────────────────────────────────────────────────────

function getCurrentQuestionText() {
    // Prefer _TextElement_ scoped inside a _Question_ wrapper
    const questionWrappers = document.querySelectorAll('[class*="_Question_"]');
    for (const wrapper of questionWrappers) {
        for (const el of wrapper.querySelectorAll('[class*="_TextElement_"]')) {
            const cleaned = extractTextNodes(el).replace(/\s+/g, ' ').trim();
            if (cleaned && !isNoise(cleaned)) return cleaned;
        }
    }
    // Fallback: any _TextElement_ or _QuestionContainer_
    const containers = document.querySelectorAll('[class*="_TextElement_"], [class*="_QuestionContainer_"]');
    for (const container of containers) {
        const cleaned = extractTextNodes(container).replace(/\s+/g, ' ').trim();
        if (cleaned && !isNoise(cleaned)) return cleaned;
    }
    return null;
}

// ─── IMAGE ID EXTRACTION ──────────────────────────────────────────────────────

function getCurrentImageId() {
    const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

    // Prefer images with the _Image_ class inside a _Question_ wrapper (most specific)
    for (const img of document.querySelectorAll('[class*="_Question_"] [class*="_Image_"], [class*="_ImageContainer_"] img')) {
        const src = img.src || '';
        if (isSparxLogo(src)) continue;
        const match = src.match(uuidRegex);
        if (match) return match[0];
    }

    // Fallback: any img whose src contains a UUID and looks like a Sparx asset
    for (const img of document.querySelectorAll('img')) {
        const src = img.src || '';
        if (isSparxLogo(src)) continue;
        if (!src.includes('sparx-learning.com') && !src.includes('sparxmaths') && !src.includes('cdn.sparx')) continue;
        const match = src.match(uuidRegex);
        if (match) return match[0];
    }
    return null;
}

// Extracts the UUID from an image URL, or returns null if none found.
function extractImageId(url) {
    if (!url) return null;
    const match = url.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    return match ? match[0] : null;
}

// ─── ANSWER EXTRACTION ───────────────────────────────────────────────────────

function getCurrentAnswer() {
    const values = [];

    document.querySelectorAll('input[type="text"], input[type="number"], input[inputmode="decimal"], input[inputmode="numeric"]').forEach(input => {
        const val = input.value?.trim();
        if (val) values.push(val);
    });

    document.querySelectorAll('[class*="_CardContent_"]:not([class*="_CardContentEmpty_"])').forEach(card => {
        const text = card.innerText?.trim();
        if (text) values.push(text);
    });

    document.querySelectorAll('[class*="_Tile_"][class*="_selected_"], [class*="_Tile_"][aria-pressed="true"]').forEach(tile => {
        const annotation = tile.querySelector('annotation[encoding="application/x-tex"]');
        const text = annotation ? annotation.textContent.trim() : tile.innerText?.trim();
        if (text) values.push(text);
    });

    document.querySelectorAll('[class*="_Choice_"][class*="_selected_"], [class*="_Option_"][aria-selected="true"]').forEach(choice => {
        const text = choice.innerText?.trim();
        if (text) values.push(text);
    });

    return [...new Set(values)].join(', ') || null;
}

// ─── PENDING TEMP STORE ───────────────────────────────────────────────────────

// Reads bookwork code from the chip element or React fiber (used outside of saveCurrentAnswer)
function getCurrentBookworkCode() {
    // Try React fiber first
    const questionInfo = document.querySelector('[class*="_QuestionInfo_"]');
    if (questionInfo) {
        try {
            const fiber = getReactFiber(questionInfo);
            if (fiber?.memoizedProps?.bookworkCode) return fiber.memoizedProps.bookworkCode;
        } catch { /* fall through */ }
    }
    return getBookworkCodeFromDOM();
}

function savePending() {
    if (_displayLocked) return;

    const question     = getCurrentQuestionText();
    const imageId      = getCurrentImageId();
    const answer       = getCurrentAnswer();
    const studentName  = getCurrentStudentName();
    const bookworkCode = getCurrentBookworkCode();

    if (!question) return;

    safeStorageSet({
        [PENDING_STORAGE_KEY]: { question, imageId: imageId ?? null, answer: answer ?? null, studentName: studentName ?? null, bookworkCode: bookworkCode ?? null }
    });
}

// ─── REACT FIBER HELPERS ─────────────────────────────────────────────────────

function getReactFiber(el) {
    if (!el) return null;
    const key = Object.keys(el).find(k =>
        k.startsWith('__reactFiber$') ||
        k.startsWith('__reactInternalInstance$') ||
        k.startsWith('__reactContainer$')
    );
    return key ? el[key] : null;
}

function findInReactTree(node, predicate, walkable = ['props', 'children'], maxDepth = 150) {
    if (!node || maxDepth <= 0) return null;
    try { if (predicate(node)) return node; } catch { /* skip */ }
    const queue = [node];
    while (queue.length) {
        const cur = queue.shift();
        if (!cur || typeof cur !== 'object') continue;
        try { if (predicate(cur)) return cur; } catch { /* skip */ }
        if (Array.isArray(cur)) { queue.push(...cur); continue; }
        for (const key of walkable) {
            if (cur[key] != null) queue.push(cur[key]);
        }
    }
    return null;
}

// ─── BOOKWORK SAVING ─────────────────────────────────────────────────────────

function extractAnswersFromReactInput(inputObj) {
    if (!inputObj) return [];
    const answers = [];
    const isEmpty = o => !o || Object.keys(o).length === 0;

    if (!isEmpty(inputObj.number_fields)) {
        Object.values(inputObj.number_fields).forEach(f => {
            if (f.value != null && String(f.value).trim()) answers.push(String(f.value).trim());
        });
    }
    if (!isEmpty(inputObj.cards)) {
        Object.values(inputObj.cards).forEach(c => {
            if (c.slot_ref && c.content?.[0]?.text) answers.push(c.content[0].text);
        });
    }
    if (!isEmpty(inputObj.choices)) {
        Object.values(inputObj.choices).forEach(c => {
            if (c.selected && c.content?.[0]?.text) answers.push(c.content[0].text);
        });
    }
    return answers;
}

function getBookworkDataFromReact() {
    const questionWrapper = document.querySelector('[class*="_QuestionWrapper_"]');
    const questionInfo    = document.querySelector('[class*="_QuestionInfo_"]');
    if (!questionWrapper || !questionInfo) return null;

    try {
        const wrapperFiber = getReactFiber(questionWrapper);
        const infoFiber    = getReactFiber(questionInfo);
        if (!wrapperFiber || !infoFiber) return null;

        const questionNode = findInReactTree(
            wrapperFiber.memoizedProps?.children,
            n => n && n.layout && n.input
        );
        if (!questionNode) return null;

        const textNode = findInReactTree(
            questionNode.layout,
            n => n && n.element === 'text',
            ['content']
        );
        const questionText = textNode?.text || null;
        const code = infoFiber.memoizedProps?.bookworkCode || null;
        const answers = extractAnswersFromReactInput(questionNode.input);

        return { code, questionText, answers };
    } catch (e) {
        return null;
    }
}

function getBookworkCodeFromDOM() {
    // Matches any chip/element with text like:
    //   "Bookwork 4A"           (WAC dialog chip)
    //   "Bookwork code: 4A"     (question page chip)
    //   "Bookwork code 4A"
    const BOOKWORK_RE = /Bookwork(?:\s+code)?[:\s]+([A-Z0-9]+)/i;

    // Primary: any _Chip_ element on the page
    const chips = document.querySelectorAll('[class*="_Chip_"]');
    for (const chip of chips) {
        const text  = (chip.innerText || chip.textContent).trim();
        const match = text.match(BOOKWORK_RE);
        if (match) return match[1].trim();
    }
    // Fallback: dedicated bookwork code elements
    const codeEl = document.querySelector('[class*="_BookworkCode_"], [class*="_Bookwork_"]');
    if (codeEl) {
        const text  = codeEl.innerText || codeEl.textContent;
        const match = text.match(BOOKWORK_RE);
        if (match) return match[1].trim();
        const fallback = text.trim().replace(/\s+/g, '');
        if (/^[A-Z0-9]{1,4}$/i.test(fallback)) return fallback;
    }
    return null;
}

function getBookworkDataFromDOM() {
    const code = getBookworkCodeFromDOM();

    const questionText = getCurrentQuestionText();

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

    return { code, questionText, answers: [...new Set(answers)] };
}

async function saveCurrentAnswer() {
    const reactData    = getBookworkDataFromReact();
    const domData      = getBookworkDataFromDOM();
    const code         = reactData?.code        || domData?.code        || getBookworkCodeFromDOM();
    const questionText = reactData?.questionText || domData?.questionText;
    const answers      = (reactData?.answers?.length ? reactData.answers : domData?.answers) || [];

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
    saveCurrentAnswer();
    savePending();
}

function initAnswerSaving() {
    document.addEventListener('pointerdown', onInteraction, { capture: true });
    document.addEventListener('keydown',     onInteraction, { capture: true });
    document.addEventListener('input',       onInteraction, { capture: true });
    savePending();
}

initAnswerSaving();

// ─── PROACTIVE DISPLAY LOCK ───────────────────────────────────────────────────

function tryLockDisplay() {
    if (_displayLocked) return;
    let text = findAndExtractAll();
    // Hard fallback: grab raw innerText of the _Question_ wrapper if structured extraction found nothing
    if (!text) {
        const qEl = document.querySelector('[class*="_Question_"]');
        if (qEl) text = qEl.innerText?.replace(/\s+/g, ' ').trim() || '';
    }

    // Pick the first question image: prefer _Image_ class, fall back to any Sparx CDN img
    const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    let imageUrl = null;

    for (const img of document.querySelectorAll('[class*="_Question_"] [class*="_Image_"], [class*="_ImageContainer_"] img')) {
        const src = img.src || '';
        if (!isSparxLogo(src) && uuidRegex.test(src)) { imageUrl = src; break; }
    }
    if (!imageUrl) {
        for (const img of document.querySelectorAll('img')) {
            const src = img.src || '';
            if (!isSparxLogo(src) && (src.includes('sparx-learning.com') || src.includes('cdn.sparx') || src.includes('sparxmaths')) && uuidRegex.test(src)) {
                imageUrl = src; break;
            }
        }
    }

    lockDisplay(text, imageUrl);
}

tryLockDisplay();

let _lockDebounce = null;
const lockObserver = new MutationObserver(() => {
    if (_displayLocked) return;
    clearTimeout(_lockDebounce);
    _lockDebounce = setTimeout(tryLockDisplay, 150);
});
lockObserver.observe(document.body, { childList: true, subtree: true });

// ─── BOOKWORK CHECK AUTO-FILL ────────────────────────────────────────────────
// Pure DOM approach — reads the bookwork code from the _Chip_ inside the WAC
// container, reads each option's visible text from .answer-block spans, then
// clicks the one that matches the saved answer for that code.

let _wacLastCode = null;

// Extracts the bookwork code from the WAC dialog chip.
// The chip reads e.g. "Bookwork 4A" or "Bookwork code: 4A"
function getWacCode(wacEl) {
    const chip = wacEl.querySelector('[class*="_Chip_"]');
    if (!chip) return null;
    const text = (chip.innerText || chip.textContent).trim();
    // Match "Bookwork 4A", "Bookwork code 4A", "Bookwork code: 4A" etc.
    const match = text.match(/Bookwork(?:\s+code)?[:\s]+([A-Z0-9]+)/i);
    return match ? match[1].trim() : null;
}

// Returns the visible answer text of a WAC option element.
// Reads .answer-block spans and katex annotations, joining them.
function getWacOptionText(optionEl) {
    const parts = [];
    // Numeric/text blocks
    optionEl.querySelectorAll('.answer-block').forEach(el => {
        const t = el.innerText?.trim();
        if (t) parts.push(t);
    });
    // LaTeX via annotation
    optionEl.querySelectorAll('annotation[encoding="application/x-tex"]').forEach(el => {
        const t = el.textContent?.trim();
        if (t) parts.push(t);
    });
    return parts.join(' ').trim();
}

// Normalise answer strings for comparison: strip LaTeX delimiters, collapse spaces
function normaliseAnswer(s) {
    return String(s)
        .replace(/\\[a-zA-Z]+/g, '')   // strip LaTeX commands like \degree
        .replace(/[{}$°]/g, '')           // strip braces, dollar signs, degree symbols
        .replace(/\s+/g, ' ')
        .trim();
}

function runBookworkCheck() {
    const wacEl = document.querySelector('[class*="_WACContainer_"]');
    if (!wacEl) return;

    const code = getWacCode(wacEl);
    if (!code) {
        console.log('[SparxLess] WAC visible but could not read bookwork code');
        return;
    }
    if (code === _wacLastCode) return;
    _wacLastCode = code;

    console.log('[SparxLess] Bookwork check detected, code:', code);

    getBookworkStore().then(store => {
        const entries = Array.isArray(store[code])
            ? store[code].filter(e => Array.isArray(e.answers) && e.answers.length > 0)
            : [];

        if (entries.length === 0) {
            console.log('[SparxLess] No saved answers for bookwork code:', code);
            return;
        }

        // Build a flat set of normalised saved answers (most recent entry first)
        const savedAnswers = [];
        for (const entry of entries) {
            for (const ans of entry.answers) {
                const n = normaliseAnswer(ans);
                if (n && !savedAnswers.includes(n)) savedAnswers.push(n);
            }
        }
        console.log('[SparxLess] Saved answers to match:', savedAnswers);

        // Find all clickable option elements
        const optionEls = wacEl.querySelectorAll('[class*="_WACOption_"]');
        let matched = false;

        optionEls.forEach(optEl => {
            if (matched) return;
            const optText = normaliseAnswer(getWacOptionText(optEl));
            console.log('[SparxLess] WAC option text:', optText);

            if (savedAnswers.some(ans => ans === optText || optText.includes(ans) || ans.includes(optText))) {
                console.log('[SparxLess] Clicking matching option:', optText);
                optEl.click();
                matched = true;
            }
        });

        if (!matched) {
            console.log('[SparxLess] No WAC option matched saved answers');
        }
    });
}

let _wacDebounce = null;
const wacObserver = new MutationObserver(() => {
    const wacEl = document.querySelector('[class*="_WACContainer_"]');
    if (!wacEl) {
        _wacLastCode = null; // reset so next WAC fires fresh
        return;
    }
    clearTimeout(_wacDebounce);
    _wacDebounce = setTimeout(runBookworkCheck, 400);
});
wacObserver.observe(document.body, { childList: true, subtree: true });

// ─── AUTO-SUBMIT ON CORRECT ───────────────────────────────────────────────────

let lastAutoSubmitKey = null;

function autoSubmitCorrectAnswer() {
    safeStorageGet([DISPLAY_STORAGE_KEY, PENDING_STORAGE_KEY], (result) => {
        const display = result[DISPLAY_STORAGE_KEY];
        const pending = result[PENDING_STORAGE_KEY];

        const question    = display?.text        ?? getCurrentQuestionText();
        const imageId     = extractImageId(display?.imageUrl) ?? getCurrentImageId();
        const answer      = pending?.answer      ?? getCurrentAnswer();
        const studentName = pending?.studentName ?? getCurrentStudentName();

        if (!question) return;
        if (question === lastAutoSubmitKey) return;
        lastAutoSubmitKey = question;

        console.log('[SparxLess] Correct detected — auto-submitting...');
        console.log('[SparxLess] Student  :', studentName);
        console.log('[SparxLess] Question :', question);
        console.log('[SparxLess] Image ID :', imageId);
        console.log('[SparxLess] Answer   :', answer);

        // Submit the answer — Confirmed? stays false until a second user agrees
        safeRuntimeSendMessage({
            action: 'POST_TO_SUPABASE',
            payload: { question, imageId, answer, studentName }
        }, (res) => {
            if (res?.success) {
                console.log('[SparxLess] Auto-submit succeeded.');
            } else {
                console.warn('[SparxLess] Auto-submit failed:', res?.error);
            }
        });
    });
}

let correctDebounceTimer = null;

// Wrong-answer messages Sparx shows — any of these triggers a delete
const WRONG_ANSWER_MESSAGES = [
    'Finding this one tricky?',
    'Not quite',
    'Incorrect',
];

function autoDeleteWrongAnswer() {
    safeStorageGet([DISPLAY_STORAGE_KEY, PENDING_STORAGE_KEY], (result) => {
        const display = result[DISPLAY_STORAGE_KEY];
        const question = display?.text ?? getCurrentQuestionText();
        const imageId  = extractImageId(display?.imageUrl) ?? getCurrentImageId();

        if (!question) return;

        console.log('[SparxLess] Wrong answer detected — deleting from DB...');
        safeRuntimeSendMessage({
            action: 'DELETE_FROM_SUPABASE',
            payload: { question, imageId }
        }, (res) => {
            if (res?.success) {
                console.log('[SparxLess] Row(s) deleted after wrong answer.');
            } else {
                console.warn('[SparxLess] Delete failed:', res?.error);
            }
        });
    });
}

const correctObserver = new MutationObserver(() => {
    const resultEl = document.querySelector('[class*="_ResultMessage_"]');
    if (!resultEl) return;
    const msg = resultEl.innerText?.trim();
    if (msg === 'Correct!') {
        clearTimeout(correctDebounceTimer);
        correctDebounceTimer = setTimeout(autoSubmitCorrectAnswer, 300);
    } else if (WRONG_ANSWER_MESSAGES.some(w => msg?.includes(w))) {
        clearTimeout(correctDebounceTimer);
        correctDebounceTimer = setTimeout(autoDeleteWrongAnswer, 300);
    }
});

correctObserver.observe(document.body, { childList: true, subtree: true });

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

// ─── DISPLAY CACHE — LOCK ON FIRST VALID QUESTION, CLEAR ON NAVIGATION ───────

function lockDisplay(text, imageUrl) {
    if (_displayLocked) return;
    if (!text && !imageUrl) return;
    _displayLocked = true;
    safeStorageSet({
        [DISPLAY_STORAGE_KEY]: { text: text || null, imageUrl: imageUrl || null, url: location.href }
    });
    // Kick off a database lookup now that we have a locked question
    triggerDatabaseLookup(text, imageUrl);
}

function unlockDisplay() {
    _displayLocked = false;
    _lastLookupQuestion = null;
    document.getElementById('sparxless-banner')?.remove();
    safeStorageRemove([DISPLAY_STORAGE_KEY]);
}

// ─── DATABASE LOOKUP + ANSWER BANNER ─────────────────────────────────────────

let _lastLookupQuestion = null;

function triggerDatabaseLookup(text, imageUrl) {
    if (!text) return;
    if (text === _lastLookupQuestion) return;
    _lastLookupQuestion = text;

    const imageId = extractImageId(imageUrl);

    // Respect the user's "show DB answers" preference
    try {
        chrome.storage.sync.get(['dbAnswersEnabled'], (pref) => {
            if (pref.dbAnswersEnabled === false) {
                document.getElementById('sparxless-banner')?.remove();
                return;
            }
            safeRuntimeSendMessage(
                { action: 'LOOKUP_SUPABASE', payload: { question: text, imageId } },
                (result) => {
                    if (!result?.found) return;
                    showAnswerBanner(result.answer, result.confirmed);
                }
            );
        });
    } catch { /* context invalidated */ }
}

function showAnswerBanner(answer, confirmed) {
    document.getElementById('sparxless-banner')?.remove();

    const banner = document.createElement('div');
    banner.id = 'sparxless-banner';

    const isConfirmed = confirmed === true;
    const bgColor     = isConfirmed ? '#f0fdf4' : '#fffbeb';
    const borderColor = isConfirmed ? '#22c55e' : '#f59e0b';
    const textColor   = isConfirmed ? '#14532d' : '#78350f';
    const accentColor = isConfirmed ? '#22c55e' : '#f59e0b';
    const label       = isConfirmed
        ? '\u2705 The answer is'
        : '\u26a0\ufe0f The answer might be';

    banner.style.cssText = [
        'position:fixed',
        'top:16px',
        'right:16px',
        'z-index:999999',
        'background:' + bgColor,
        'border:3px solid ' + borderColor,
        'border-radius:16px',
        'padding:20px 24px 24px 24px',
        'width:360px',
        'box-shadow:0 8px 32px rgba(0,0,0,0.18)',
        "font-family:'Nunito','Segoe UI',system-ui,sans-serif",
        'color:' + textColor,
        'line-height:1.4',
    ].join(';');

    // Top row: brand tag + close button
    const topRow = document.createElement('div');
    topRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;';

    const tag = document.createElement('div');
    tag.style.cssText = 'font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:1.5px;color:' + accentColor + ';';
    tag.textContent = 'SparxLess';

    const close = document.createElement('button');
    close.textContent = '\u2715';
    close.style.cssText = 'background:none;border:none;cursor:pointer;font-size:16px;color:' + textColor + ';opacity:0.4;padding:0;line-height:1;';
    close.addEventListener('click', () => banner.remove());

    topRow.appendChild(tag);
    topRow.appendChild(close);

    // Label
    const labelEl = document.createElement('div');
    labelEl.style.cssText = 'font-size:15px;font-weight:700;margin-bottom:10px;opacity:0.8;';
    labelEl.textContent = label;

    // Answer — big and prominent
    const answerEl = document.createElement('div');
    answerEl.style.cssText = [
        'font-size:42px',
        'font-weight:900',
        'letter-spacing:-1px',
        'line-height:1.1',
        'color:' + textColor,
        'word-break:break-word',
    ].join(';');
    answerEl.textContent = String(answer);

    // Divider
    const divider = document.createElement('div');
    divider.style.cssText = 'height:2px;background:' + borderColor + ';opacity:0.3;margin:14px 0 10px;border-radius:2px;';

    // Footer hint
    const footer = document.createElement('div');
    footer.style.cssText = 'font-size:11px;opacity:0.5;font-weight:600;';
    footer.textContent = 'Auto-dismisses in 15s';

    banner.appendChild(topRow);
    banner.appendChild(labelEl);
    banner.appendChild(answerEl);
    banner.appendChild(divider);
    banner.appendChild(footer);
    document.body.appendChild(banner);

    setTimeout(() => banner.remove(), 15000);
}

// Poll for URL change (Sparx is a SPA — no real page reload between questions)
// Clears itself if the extension context is invalidated (e.g. after a reload)
const _urlPollInterval = setInterval(() => {
    if (!isContextValid()) {
        clearInterval(_urlPollInterval);
        return;
    }
    if (location.href !== _lastUrl) {
        _lastUrl = location.href;
        unlockDisplay();
    }
}, 500);

window.addEventListener('beforeunload', unlockDisplay);

// ─── WATCH FOR DB SETTING CHANGES ────────────────────────────────────────────
// When the user toggles "show DB answers" in the popup, re-trigger or hide immediately

try {
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'sync' || !('dbAnswersEnabled' in changes)) return;
        const enabled = changes.dbAnswersEnabled.newValue !== false;

        if (!enabled) {
            // Turned off — remove any visible banner
            document.getElementById('sparxless-banner')?.remove();
        } else {
            // Turned on — re-run lookup for the current question
            _lastLookupQuestion = null; // reset dedup so it fires again
            const display = null; // read from storage
            safeStorageGet([DISPLAY_STORAGE_KEY], (stored) => {
                const d = stored[DISPLAY_STORAGE_KEY];
                if (d?.text) triggerDatabaseLookup(d.text, d.imageUrl);
            });
        }
    });
} catch { /* context invalidated */ }

// ─── MESSAGE LISTENER ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

    if (request.action === 'extractAll') {
        const uuidRe = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

        // Text: use structured extractor, fall back to raw innerText of _Question_ wrapper
        let extractedText = findAndExtractAll();
        if (!extractedText) {
            const qEl = document.querySelector('[class*="_Question_"]');
            if (qEl) {
                extractedText = qEl.innerText?.replace(/\s+/g, ' ').trim() || '';
            }
        }

        // Images: prefer _Image_ inside question, then any Sparx CDN img with UUID
        const extractedImages = [
            ...document.querySelectorAll('[class*="_Question_"] [class*="_Image_"], [class*="_ImageContainer_"] img'),
            ...document.querySelectorAll('img')
        ]
            .map(i => i.src)
            .filter((s, idx, arr) => arr.indexOf(s) === idx)
            .filter(s => s && !isSparxLogo(s) && uuidRe.test(s) &&
                (s.includes('sparx-learning.com') || s.includes('cdn.sparx') || s.includes('sparxmaths')));

        lockDisplay(extractedText, extractedImages[0] || null);

        console.log('[SparxLess] extractAll → text:', extractedText?.slice(0,80), '| images:', extractedImages.length);

        sendResponse({
            text:        extractedText,
            imageId:     getCurrentImageId(),
            answer:      getCurrentAnswer(),
            studentName: getCurrentStudentName(),
            images:      extractedImages
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
        safeStorageGet([DISPLAY_STORAGE_KEY, PENDING_STORAGE_KEY], (result) => {
            const display = result[DISPLAY_STORAGE_KEY];
            const pending = result[PENDING_STORAGE_KEY];

            const question    = display?.text        ?? getCurrentQuestionText();
            const imageId     = extractImageId(display?.imageUrl) ?? getCurrentImageId();
            const answer      = pending?.answer      ?? getCurrentAnswer();
            const studentName = pending?.studentName ?? getCurrentStudentName();

            console.log('[SparxLess] ── Submitting to Unconfirmed ──────────────');
            console.log('[SparxLess] Student  :', studentName);
            console.log('[SparxLess] Question :', question);
            console.log('[SparxLess] Image ID :', imageId);
            console.log('[SparxLess] Answer   :', answer);
            console.log('[SparxLess] ─────────────────────────────────────────');

            if (!question) {
                sendResponse({ success: false, error: 'No question text found on page.' });
                return;
            }

            safeRuntimeSendMessage(
                { action: 'POST_TO_SUPABASE', payload: { question, imageId, answer, studentName } },
                result => sendResponse(result)
            );
        });
        return true;
    }

    return true;
});
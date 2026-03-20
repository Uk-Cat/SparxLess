// Matches any Sparx logo regardless of content-hash or subject (maths/science)
function isSparxLogo(src) {
    return src.includes("sparx_maths_logo") || src.includes("sparx_science_logo") || src.includes("sparx_logo");
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

// ─── STUDENT NAME EXTRACTION ──────────────────────────────────────────────────
// FIX: Added — reads the student name from the _StudentName_ element.
// Sparx uses BEM-style hashed class names so we match on the stable
// semantic fragment "_StudentName_" rather than the full hashed string.

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
        if (isSparxLogo(src)) continue;
        if (!src.includes('sparx-learning.com') && !src.includes('sparxmaths')) continue;
        const match = src.match(uuidRegex);
        if (match) return match[0];
    }
    return null;
}

// Extracts the UUID from an image URL, or returns null if none found.
// Used so we always store the ID not the full URL in the database.
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

function savePending() {
    // Only snapshot during the answer-input phase — use the display lock as the
    // signal: if the display is already locked we're past the question phase.
    if (_displayLocked) return;

    const question    = getCurrentQuestionText();
    const imageId     = getCurrentImageId();
    const answer      = getCurrentAnswer();
    const studentName = getCurrentStudentName();

    if (!question) return;

    chrome.storage.local.set({
        [PENDING_STORAGE_KEY]: { question, imageId: imageId ?? null, answer: answer ?? null, studentName: studentName ?? null }
    });
}

// ─── REACT FIBER HELPERS (copied from SparxSolver) ──────────────────────────
// Gets the React fiber attached to a DOM node.

function getReactFiber(el) {
    if (!el) return null;
    const key = Object.keys(el).find(k =>
        k.startsWith('__reactFiber$') ||
        k.startsWith('__reactInternalInstance$') ||
        k.startsWith('__reactContainer$')
    );
    return key ? el[key] : null;
}

// Walks a React tree looking for a node that satisfies the predicate.
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

// ─── BOOKWORK SAVING (React-fiber approach from SparxSolver) ─────────────────
// Reads bookworkCode and answers directly from React's internal state so it
// works regardless of CSS class-name hash changes.

function extractAnswersFromReactInput(inputObj) {
    if (!inputObj) return [];
    const answers = [];
    const isEmpty = o => !o || Object.keys(o).length === 0;

    // Numeric / text input fields
    if (!isEmpty(inputObj.number_fields)) {
        Object.values(inputObj.number_fields).forEach(f => {
            if (f.value != null && String(f.value).trim()) answers.push(String(f.value).trim());
        });
    }
    // Drag-and-drop card slots
    if (!isEmpty(inputObj.cards)) {
        Object.values(inputObj.cards).forEach(c => {
            if (c.slot_ref && c.content?.[0]?.text) answers.push(c.content[0].text);
        });
    }
    // Multiple-choice tiles
    if (!isEmpty(inputObj.choices)) {
        Object.values(inputObj.choices).forEach(c => {
            if (c.selected && c.content?.[0]?.text) answers.push(c.content[0].text);
        });
    }
    return answers;
}

function getBookworkDataFromReact() {
    // Primary: read from React fiber on the QuestionWrapper / QuestionInfo elements
    const questionWrapper = document.querySelector('[class*="_QuestionWrapper_"]');
    const questionInfo    = document.querySelector('[class*="_QuestionInfo_"]');
    if (!questionWrapper || !questionInfo) return null;

    try {
        const wrapperFiber = getReactFiber(questionWrapper);
        const infoFiber    = getReactFiber(questionInfo);
        if (!wrapperFiber || !infoFiber) return null;

        // Find the node that has both layout + input props (the question state)
        const questionNode = findInReactTree(
            wrapperFiber.memoizedProps?.children,
            n => n && n.layout && n.input
        );
        if (!questionNode) return null;

        // Extract the question text from layout
        const textNode = findInReactTree(
            questionNode.layout,
            n => n && n.element === 'text',
            ['content']
        );
        const questionText = textNode?.text || null;

        // Bookwork code lives on the QuestionInfo fiber
        const code = infoFiber.memoizedProps?.bookworkCode || null;

        // Answers from structured input object
        const answers = extractAnswersFromReactInput(questionNode.input);

        return { code, questionText, answers };
    } catch (e) {
        return null;
    }
}

// Falls back to DOM-based extraction when React fiber isn't available
function getBookworkDataFromDOM() {
    // Code
    const codeEl = document.querySelector('[class*="_BookworkCode_"], [class*="_Bookwork_"]');
    let code = null;
    if (codeEl) {
        const text  = codeEl.innerText || codeEl.textContent;
        const match = text.match(/Bookwork code[:\s]+([A-Z0-9]+)/i);
        if (match) code = match[1].trim();
        else {
            const fallback = text.trim().replace(/\s+/g, '');
            if (/^[A-Z0-9]{1,4}$/i.test(fallback)) code = fallback;
        }
    }

    const questionText = getCurrentQuestionText();

    // Answers
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
    // Try React fiber first (more reliable), fall back to DOM scraping
    const data = getBookworkDataFromReact() || getBookworkDataFromDOM();
    const { code, questionText, answers } = data || {};

    if (!code || !questionText || !answers || answers.length === 0) return;

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
// Calls lockDisplay() automatically whenever the DOM changes — no popup needed.
// This means the question+image are captured and frozen as soon as the student
// lands on a question, even if they never open the extension.

function tryLockDisplay() {
    if (_displayLocked) return; // already locked, skip the DOM work entirely
    const text     = findAndExtractAll();
    const imageUrl = (Array.from(document.querySelectorAll('img'))
        .map(i => i.src)
        .filter(s => s && !isSparxLogo(s) && s.includes('sparx-learning.com')))[0] || null;
    lockDisplay(text, imageUrl);
}

// Run once immediately on script load
tryLockDisplay();

// Then watch for DOM changes so it fires as soon as Sparx renders the question
let _lockDebounce = null;
const lockObserver = new MutationObserver(() => {
    if (_displayLocked) return;
    clearTimeout(_lockDebounce);
    _lockDebounce = setTimeout(tryLockDisplay, 150);
});
lockObserver.observe(document.body, { childList: true, subtree: true });

// ─── BOOKWORK CHECK AUTO-FILL ────────────────────────────────────────────────
// When Sparx shows a bookwork check (WAC = "What Answers Checked"), we:
//  1. Read the bookwork code from the React fiber on the WAC container
//  2. Look up our saved answers for that code
//  3. Compare each multiple-choice option against saved answers and click the match
//
// This mirrors SparxSolver's Fs() + Hs() functions, adapted for a content script
// (no React render patching — we use MutationObserver + React fiber reads instead).

// Walk up the React fiber tree to find a component whose memoizedProps contain
// a bookworkCode field (lives on the parent question-info component).
function getWacBookworkCode(fiber) {
    let node = fiber;
    for (let i = 0; i < 30 && node; i++) {
        const code = node.memoizedProps?.bookworkCode
                  || node.pendingProps?.bookworkCode;
        if (code) return code;
        node = node.return;
    }
    return null;
}

// Walk the React props tree to find the choices array (multiple-choice options).
// SparxSolver looks for b.props.choices && b.props.option
function getWacChoices(fiber) {
    const props = fiber?.memoizedProps;
    if (!props) return null;

    // Direct hit — this fiber IS the choice picker
    if (props.choices && props.option !== undefined) return props;

    // Walk children props recursively (BFS, shallow)
    const queue = [props];
    for (let i = 0; i < 200 && queue.length; i++) {
        const cur = queue.shift();
        if (!cur || typeof cur !== 'object') continue;
        if (cur.choices && cur.option !== undefined) return cur;
        for (const val of Object.values(cur)) {
            if (val && typeof val === 'object' && !Array.isArray(val)) queue.push(val);
            if (Array.isArray(val)) val.forEach(v => v && typeof v === 'object' && queue.push(v));
        }
    }
    return null;
}

// Get the WAC choice picker fiber by walking fiber siblings/children
function findChoiceFiber(rootFiber) {
    const queue = [rootFiber];
    for (let i = 0; i < 500 && queue.length; i++) {
        const f = queue.shift();
        if (!f) continue;
        const p = f.memoizedProps;
        if (p && p.choices && p.option !== undefined) return f;
        if (f.child)   queue.push(f.child);
        if (f.sibling) queue.push(f.sibling);
    }
    return null;
}

let _wacLastCode = null; // debounce: don't re-run for the same WAC code

function runBookworkCheck() {
    const wacEl = document.querySelector('[class*="_WACContainer_"]');
    if (!wacEl) return;

    const fiber = getReactFiber(wacEl);
    if (!fiber) return;

    // 1. Get the bookwork code
    const code = getWacBookworkCode(fiber);
    if (!code || code === _wacLastCode) return;
    _wacLastCode = code;

    console.log('[SparxLess] Bookwork check detected, code:', code);

    // 2. Look up saved answers for this code
    getBookworkStore().then(store => {
        const entries = Array.isArray(store[code])
            ? store[code].filter(e => Array.isArray(e.answers))
            : [];

        if (entries.length === 0) {
            console.log('[SparxLess] No saved answers for bookwork code:', code);
            return;
        }

        // 3. Find the choice picker fiber
        const choiceFiber = findChoiceFiber(fiber);
        if (!choiceFiber) {
            console.log('[SparxLess] Could not find choice picker fiber');
            return;
        }

        const choiceProps = choiceFiber.memoizedProps;
        if (!choiceProps?.choices) return;

        // 4. For each choice option, strip HTML/LaTeX delimiters and compare
        //    against saved answers (most recent first)
        const strip = s => s.replace(/<[^>]+>/g, '').replace(/^\$|\$$/g, '').trim();

        choiceProps.choices.forEach(({ element, onSelect }) => {
            const markup = element?.props?.markup || element?.props?.children || '';
            const cleaned = strip(String(markup));

            // Check against all saved entries (most recent first)
            for (const entry of entries) {
                const savedJoined = strip(entry.answers.join(''));
                if (savedJoined === cleaned) {
                    console.log('[SparxLess] Auto-selecting bookwork answer:', cleaned);
                    onSelect?.();
                    return;
                }
                // Also try matching any individual answer
                for (const ans of entry.answers) {
                    if (strip(String(ans)) === cleaned) {
                        console.log('[SparxLess] Auto-selecting bookwork answer:', cleaned);
                        onSelect?.();
                        return;
                    }
                }
            }
        });
    });
}

// Watch for the WAC container appearing in the DOM
let _wacDebounce = null;
const wacObserver = new MutationObserver(() => {
    const wacEl = document.querySelector('[class*="_WACContainer_"]');
    if (!wacEl) {
        _wacLastCode = null; // reset when WAC disappears so next one fires
        return;
    }
    clearTimeout(_wacDebounce);
    _wacDebounce = setTimeout(runBookworkCheck, 300);
});
wacObserver.observe(document.body, { childList: true, subtree: true });

// ─── AUTO-SUBMIT ON CORRECT ───────────────────────────────────────────────────
// Watches the DOM for _ResultMessage_ containing "Correct!" and automatically
// posts the current question/imageId/answer/studentName to Supabase.
// A debounce prevents double-firing if Sparx re-renders the element.

let lastAutoSubmitKey = null; // tracks last submitted question to avoid duplicates

function autoSubmitCorrectAnswer() {
    // Read question+imageId from the LOCKED display cache — this is always the
    // original question, never the post-answer DOM content.
    // Read answer from the PENDING snapshot — captured on last interaction before submit.
    chrome.storage.local.get([DISPLAY_STORAGE_KEY, PENDING_STORAGE_KEY], (result) => {
        const display = result[DISPLAY_STORAGE_KEY];
        const pending = result[PENDING_STORAGE_KEY];

        const question    = display?.text        ?? getCurrentQuestionText();
        const imageId     = extractImageId(display?.imageUrl) ?? getCurrentImageId();
        const answer      = pending?.answer      ?? getCurrentAnswer();
        const studentName = pending?.studentName ?? getCurrentStudentName();

        if (!question) return;

        // Deduplicate: don't resubmit the same question twice in a row
        if (question === lastAutoSubmitKey) return;
        lastAutoSubmitKey = question;

        console.log('[SparxLess] Correct detected — auto-submitting...');
        console.log('[SparxLess] Student  :', studentName);
        console.log('[SparxLess] Question :', question);
        console.log('[SparxLess] Image ID :', imageId);
        console.log('[SparxLess] Answer   :', answer);

        chrome.runtime.sendMessage({
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

const correctObserver = new MutationObserver(() => {
    const resultEl = document.querySelector('[class*="_ResultMessage_"]');
    if (resultEl && resultEl.innerText?.trim() === 'Correct!') {
        clearTimeout(correctDebounceTimer);
        correctDebounceTimer = setTimeout(autoSubmitCorrectAnswer, 300);
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

// ─── DISPLAY CACHE — LOCK ON FIRST VALID QUESTION, CLEAR ON NAVIGATION ─────────
// Strategy: once we have a valid question+image, lock the display cache and
// refuse all further writes until the URL changes (next question/page).
// This is more robust than checking for the Answer button, which may remain
// hidden-but-present in the DOM after the student submits.

function lockDisplay(text, imageUrl) {
    if (_displayLocked) return;          // already locked — ignore all further calls
    if (!text && !imageUrl) return;      // nothing worth locking yet
    _displayLocked = true;
    chrome.storage.local.set({
        [DISPLAY_STORAGE_KEY]: { text: text || null, imageUrl: imageUrl || null, url: location.href }
    });
}

function unlockDisplay() {
    _displayLocked = false;
    chrome.storage.local.remove([DISPLAY_STORAGE_KEY]);
}

// Poll for URL change (Sparx is a SPA — no real page reload between questions)
setInterval(() => {
    if (location.href !== _lastUrl) {
        _lastUrl = location.href;
        unlockDisplay();
    }
}, 500);

window.addEventListener('beforeunload', unlockDisplay);

// ─── MESSAGE LISTENER ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

    if (request.action === 'extractAll') {
        const extractedText   = findAndExtractAll();
        const extractedImages = Array.from(document.querySelectorAll('img'))
                                     .map(i => i.src)
                                     .filter(s => s && !isSparxLogo(s) && s.includes('sparx-learning.com'));

        // Lock the display cache on the first valid extraction.
        // Subsequent extractAll calls (e.g. popup reopen mid-answer) are ignored
        // by lockDisplay() — the cache stays frozen until the URL changes.
        lockDisplay(extractedText, extractedImages[0] || null);

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
        chrome.storage.local.get([DISPLAY_STORAGE_KEY, PENDING_STORAGE_KEY], (result) => {
            const display = result[DISPLAY_STORAGE_KEY];
            const pending = result[PENDING_STORAGE_KEY];

            // question + imageId always come from the locked display cache
            // answer + studentName come from the pending interaction snapshot
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

            chrome.runtime.sendMessage(
                { action: 'POST_TO_SUPABASE', payload: { question, imageId, answer, studentName } },
                result => sendResponse(result)
            );
        });
        return true;
    }

    return true;
});
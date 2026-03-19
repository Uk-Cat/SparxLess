const LOGO_URL = "https://static.sparx-learning.com/maths/49f67c3f6d3820553ea268777b7794e6f449e1fd/assets/sparx_maths_logo-BRwQ1-wz.svg";

// ─── BOOKWORK STORAGE KEY ────────────────────────────────────────────────────
const BOOKWORK_STORAGE_KEY = "SparxLessBookwork";

/**
 * Read the full bookwork answer store from chrome.storage.local.
 * Returns a promise that resolves to an object: { [bookworkCode]: [...entries] }
 */
function getBookworkStore() {
    return new Promise(resolve => {
        chrome.storage.local.get([BOOKWORK_STORAGE_KEY], result => {
            resolve(result[BOOKWORK_STORAGE_KEY] || {});
        });
    });
}

/**
 * Write the full bookwork store back to chrome.storage.local.
 */
function setBookworkStore(store) {
    return new Promise(resolve => {
        chrome.storage.local.set({ [BOOKWORK_STORAGE_KEY]: store }, resolve);
    });
}

// ─── ANSWER EXTRACTION ───────────────────────────────────────────────────────

/**
 * Filter out instructions and metadata
 */
function isNoise(text) {
    return ["Question Preview", "Bookwork code", "To pick up a draggable"].some(p => text.startsWith(p));
}

/**
 * LaTeX Walker: Prevents double-reading numbers
 */
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

// ─── BOOKWORK SAVING (ported from SparxSolver main.js) ───────────────────────

/**
 * Extract the current bookwork code from the page.
 * Looks for the bookwork code element that Sparx renders.
 */
function getCurrentBookworkCode() {
    // Sparx renders bookwork code in an element with class containing "_BookworkCode_" or similar
    const codeEl = document.querySelector('[class*="_BookworkCode_"], [class*="_Bookwork_"]');
    if (codeEl) {
        // The code is usually the last text content, e.g. "Bookwork code: 3B" → extract "3B"
        const text = codeEl.innerText || codeEl.textContent;
        const match = text.match(/Bookwork code[:\s]+([A-Z0-9]+)/i);
        if (match) return match[1].trim();
        // Fallback: return any short alphanumeric code directly
        const fallback = text.trim().replace(/\s+/g, '');
        if (/^[A-Z0-9]{1,4}$/i.test(fallback)) return fallback;
    }
    return null;
}

/**
 * Extract answers currently entered by the student.
 * Ported from SparxSolver's Ds() function — covers number inputs, card slots, and multiple-choice.
 */
function extractCurrentAnswers() {
    const answers = [];

    // Number / text input fields (e.g. BIP inputs)
    document.querySelectorAll('input[data-ref="BIP"], input[type="text"], input[type="number"]').forEach(input => {
        if (input.value && input.value.trim()) {
            answers.push(input.value.trim());
        }
    });

    // Card drag-and-drop slots — filled cards have text content
    document.querySelectorAll('[class*="_CardContent_"]:not([class*="_CardContentEmpty_"])').forEach(card => {
        const text = card.innerText?.trim();
        if (text) answers.push(text);
    });

    // Multiple-choice tiles that are selected
    document.querySelectorAll('[class*="_Tile_"][class*="_selected_"], [class*="_Tile_"][aria-pressed="true"]').forEach(tile => {
        const annotation = tile.querySelector('annotation[encoding="application/x-tex"]');
        const text = annotation ? annotation.textContent.trim() : tile.innerText?.trim();
        if (text) answers.push(text);
    });

    // Generic selected/checked choices
    document.querySelectorAll('[class*="_Choice_"][class*="_selected_"], [class*="_Option_"][aria-selected="true"]').forEach(choice => {
        const text = choice.innerText?.trim();
        if (text && !answers.includes(text)) answers.push(text);
    });

    return [...new Set(answers)]; // deduplicate
}

/**
 * Extract the current question text (the unique question identifier).
 * Ported from SparxSolver's yt() — uses the first TextElement as the question ID.
 */
function getCurrentQuestionText() {
    const containers = document.querySelectorAll('[class*="_TextElement_"], [class*="_QuestionContainer_"]');
    for (const container of containers) {
        const cleaned = extractTextNodes(container).replace(/\s+/g, ' ').trim();
        if (cleaned && !isNoise(cleaned)) return cleaned;
    }
    return null;
}

/**
 * Save the current question + answers to chrome.storage.local under the bookwork code.
 * Ported from SparxSolver's yt() function.
 */
async function saveCurrentAnswer() {
    const code = getCurrentBookworkCode();
    const questionText = getCurrentQuestionText();
    const answers = extractCurrentAnswers();

    if (!code || !questionText || answers.length === 0) return;

    // Strip LaTeX delimiters from question text for comparison (like SparxSolver's p() helper)
    const normalise = str => str.replace(/\$.*?\$/g, '').replace(/ +/g, ' ').trim();

    const store = await getBookworkStore();
    const existing = Array.isArray(store[code]) ? store[code] : [];

    // Replace any existing entry for this exact question, then prepend the new one
    const filtered = existing.filter(entry => normalise(entry.id) !== normalise(questionText));
    filtered.unshift({ id: questionText, answers, date: Date.now() });

    store[code] = filtered;
    await setBookworkStore(store);
}

/**
 * Set up event listeners to trigger saving whenever the student interacts
 * with the question (mirrors SparxSolver's Ns() function).
 */
function initAnswerSaving() {
    const handler = () => saveCurrentAnswer();
    document.addEventListener('pointerdown', handler, { capture: true });
    document.addEventListener('keydown', handler, { capture: true });
}

// Initialise answer saving when the content script loads
initAnswerSaving();

// ─── AUTO-SOLVE FILL ─────────────────────────────────────────────────────────

async function performAutoSolve(answer) {
    // Reveal hidden slots
    const slots = document.querySelectorAll('[class*="_CardContentEmpty_"]');
    for (let s of slots) { s.click(); await new Promise(r => setTimeout(r, 200)); }

    // Click matching tiles
    const tiles = document.querySelectorAll('[class*="_Tile_"], [class*="_CardContent_"]');
    tiles.forEach(t => {
        const val = t.innerText + (t.querySelector('annotation')?.textContent || "");
        if (answer.includes(val.trim())) t.click();
    });

    // Fill inputs
    const input = document.querySelector('input[data-ref="BIP"], input[type="text"]');
    if (input) {
        const match = answer.match(/\d+/);
        if (match) {
            input.value = match[0];
            input.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }
}

// ─── MESSAGE LISTENER ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'extractAll') {
        sendResponse({
            text: findAndExtractAll(),
            images: Array.from(document.querySelectorAll('img'))
                .map(i => i.src)
                .filter(s => s && s !== LOGO_URL && s.includes('sparx-learning.com'))
        });

    } else if (request.action === 'autoSolve') {
        performAutoSolve(request.answer);

    } else if (request.action === 'getBookworkAnswers') {
        // Popup asks for saved answers for a given bookwork code
        getBookworkStore().then(store => {
            const code = request.code;
            sendResponse({ answers: store[code] || [] });
        });
        return true; // async

    } else if (request.action === 'getAllBookwork') {
        getBookworkStore().then(store => {
            sendResponse({ store });
        });
        return true; // async
    }

    return true;
});
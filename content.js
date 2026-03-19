// ============================================================
// content.js — Sparx Maths Auto-Submit to Supabase
// Extraction based on confirmed React fiber structure.
// ============================================================

// ── 1. React Fiber Helpers ───────────────────────────────────

function findReact(dom) {
  for (const key in dom) {
    if (key.startsWith("__reactFiber$") || key.startsWith("__reactInternalInstance$")) {
      return dom[key];
    }
  }
  return null;
}

/**
 * BFS through a React props/children tree.
 * maxProperties raised to 300 to handle deeply nested Sparx layouts.
 */
function findInReactTree(node, predicate, maxProperties = 300) {
  let count = 0;
  const stack = [node];
  while (stack.length && count < maxProperties) {
    const cur = stack.shift();
    try {
      if (predicate(cur)) return cur;
    } catch {}
    if (Array.isArray(cur)) {
      stack.push(...cur);
    } else if (cur && typeof cur === "object") {
      for (const k in cur) {
        try { stack.push(cur[k]); } catch {}
      }
    }
    count++;
  }
  return null;
}

/**
 * BFS through a plain data tree, optionally limited to specific keys.
 */
function findInTree(node, predicate, options = {}) {
  const { walkable = [], maxProperties = 300 } = options;
  let count = 0;
  const stack = [node];
  while (stack.length && count < maxProperties) {
    const cur = stack.shift();
    try {
      if (predicate(cur)) return cur;
    } catch {}
    if (Array.isArray(cur)) {
      stack.push(...cur);
    } else if (cur && typeof cur === "object") {
      const keys = walkable.length ? walkable : Object.keys(cur);
      for (const k of keys) {
        try { if (k in cur) stack.push(cur[k]); } catch {}
      }
    }
    count++;
  }
  return null;
}

// ── 2. Answer Extraction ─────────────────────────────────────

function extractAnswers(inputProps) {
  const answers = [];

  if (inputProps.number_fields && Object.keys(inputProps.number_fields).length > 0) {
    Object.values(inputProps.number_fields).forEach(f => {
      if (f.value !== undefined && f.value !== "") answers.push(String(f.value));
    });
  }
  if (inputProps.text_fields && Object.keys(inputProps.text_fields).length > 0) {
    Object.values(inputProps.text_fields).forEach(f => {
      if (f.value) answers.push(f.value);
    });
  }
  if (inputProps.cards && Object.keys(inputProps.cards).length > 0) {
    Object.values(inputProps.cards).forEach(c => {
      if (c.slot_ref && c.content?.[0]?.text) answers.push(c.content[0].text);
    });
  }
  if (inputProps.choices && Object.keys(inputProps.choices).length > 0) {
    Object.values(inputProps.choices).forEach(c => {
      if (c.selected && c.content?.[0]?.text) answers.push(c.content[0].text);
    });
  }

  return answers;
}

// ── 3. Main Extraction ───────────────────────────────────────

/**
 * Confirmed fiber structure (from diagnostic output):
 *
 * inputSection.layout = {
 *   element: "group",
 *   type: ["multi-part", ...],
 *   content: [
 *     {
 *       element: "group",
 *       type: ["question"],
 *       content: [
 *         {
 *           element: "group",
 *           type: ["question-text"],       ← we want this node's content
 *           content: [
 *             { element: "text", text: "Calculate the size of angle $y$..." }
 *           ]
 *         },
 *         {
 *           element: "figure-ref",
 *           type: ["question-image"],
 *           figure: { image: "2734b91f-fadc-4520-a6ae-fc16381e241a", ... }
 *         }
 *       ]
 *     },
 *     ...
 *   ]
 * }
 *
 * bookworkCode lives inside QuestionInfo's children array, not as a direct prop.
 */
function extractQuestionData() {
  const questionWrapper = document.querySelector('[class*="_QuestionWrapper_"]');
  const questionInfo    = document.querySelector('[class*="_QuestionInfo_"]');

  if (!questionWrapper || !questionInfo) {
    return { error: "DOM elements not found — are you on a Sparx question page?" };
  }

  const questionFiber = findReact(questionWrapper);
  const infoFiber     = findReact(questionInfo);

  if (!questionFiber || !infoFiber) {
    return { error: "React fiber not found — page may still be loading." };
  }

  try {
    // ── 3a. Find the layout+input section ───────────────────
    // The direct children prop of QuestionWrapper holds the layout
    const inputSection = findInReactTree(
      questionFiber.memoizedProps.children,
      n => n && n.layout && n.input
    );

    if (!inputSection) {
      return { error: "Could not find inputSection in React tree." };
    }

    const layout = inputSection.layout;

    // ── 3b. Extract question text ────────────────────────────
    // Find the group node whose type array includes "question-text"
    const questionTextGroup = findInTree(
      layout,
      n => n && Array.isArray(n.type) && n.type.includes("question-text"),
      { walkable: ["content"] }
    );

    // Inside that group, find the first text element
    const questionText = findInTree(
      questionTextGroup,
      n => n && n.element === "text" && typeof n.text === "string",
      { walkable: ["content"] }
    )?.text?.trim() ?? "";

    // ── 3c. Extract image ID from fiber (not DOM) ────────────
    // Find the figure-ref node with type "question-image"
    // Its figure.image field is the UUID we want
    const figureRef = findInTree(
      layout,
      n => n && n.element === "figure-ref" && n.figure?.image,
      { walkable: ["content"] }
    );

    const imageId = figureRef?.figure?.image ?? null;
    // e.g. "2734b91f-fadc-4520-a6ae-fc16381e241a"

    // ── 3d. Extract bookwork code ────────────────────────────
    // QuestionInfo memoizedProps = { className, children: Array(3) }
    // The bookwork code text is somewhere inside that children array.
    // We BFS the entire infoFiber subtree looking for a string that
    // matches the typical bookwork code pattern (letter + number, e.g. "B4")
    let bookworkCode = null;

    // First try: walk the React fiber tree upward from QuestionInfo
    // looking for a bookworkCode prop (some Sparx versions have it)
    let fiberNode = infoFiber;
    for (let i = 0; i < 20; i++) {
      if (fiberNode?.memoizedProps?.bookworkCode) {
        bookworkCode = fiberNode.memoizedProps.bookworkCode;
        break;
      }
      fiberNode = fiberNode?.return;
    }

    // Second try: scan the rendered children text nodes for a bookwork pattern
    if (!bookworkCode) {
      const allText = questionInfo.innerText || "";
      const match   = allText.match(/\b([A-Z]\d+)\b/);
      if (match) bookworkCode = match[1];
    }

    // Fallback
    if (!bookworkCode) bookworkCode = `unknown-${Date.now()}`;

    // ── 3e. Extract answers ──────────────────────────────────
    const answers = extractAnswers(inputSection.input);

    return {
      question:     questionText,
      bookworkCode: bookworkCode,
      imageId:      imageId,     // UUID string or null
      answers:      answers,
    };

  } catch (err) {
    return { error: `Extraction error: ${err.message}\n${err.stack}` };
  }
}

// ── 4. Auto-Submit ───────────────────────────────────────────

let lastSubmittedQuestion = null;

function autoSubmit() {
  const data = extractQuestionData();

  if (data?.error) {
    console.warn("[Sparx Ext] Skipped — extraction error:", data.error);
    return;
  }
  if (!data.question) {
    console.warn("[Sparx Ext] Skipped — question text was empty.");
    return;
  }
  // Dedupe: don't re-submit the same question twice
  if (data.question === lastSubmittedQuestion) {
    console.log("[Sparx Ext] Skipped — already submitted this question.");
    return;
  }
  lastSubmittedQuestion = data.question;

  chrome.runtime.sendMessage({ action: "POST_TO_SUPABASE", payload: data }, (response) => {
    if (response?.success) {
      console.log("[Sparx Ext] ✅ Saved to Supabase");
      console.log("[Sparx Ext] 📝 Question :", data.question);
      console.log("[Sparx Ext] 🖼️  Image ID :", data.imageId ?? "(no image)");
      console.log("[Sparx Ext] 📖 Bookwork :", data.bookworkCode);
      console.log("[Sparx Ext] 💬 Answers  :", data.answers);
    } else {
      console.error("[Sparx Ext] ❌ Save failed:", response?.error ?? "Unknown error");
    }
  });
}

// ── 5. Submit Button Detection ───────────────────────────────

/**
 * Sparx submit buttons say "Check", "Done", or show an arrow-right icon.
 * We walk up to 4 parent levels from the click target to find the button.
 */
function isSubmitButton(el) {
  let node = el;
  for (let i = 0; i < 4; i++) {
    if (!node) break;
    if (node.tagName === "BUTTON") {
      const text  = (node.innerText || "").toLowerCase().trim();
      const label = (node.getAttribute("aria-label") || "").toLowerCase();
      if (
        text  === "check"  ||
        text  === "done"   ||
        text  === "next"   ||
        label.includes("check") ||
        label.includes("next")  ||
        node.querySelector('[data-icon="arrow-right"]') ||
        node.querySelector('[data-icon="check"]')
      ) return true;
    }
    node = node.parentElement;
  }
  return false;
}

document.addEventListener("click", (e) => {
  if (!isSubmitButton(e.target)) return;
  // Wait 300 ms for React to flush any final answer state before we read it
  setTimeout(autoSubmit, 300);
}, true); // capture phase — fires before React's own handlers

// ── 6. Manual Trigger (popup) ────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action !== "SAVE_QUESTION") return;

  const data = extractQuestionData();

  if (data?.error) {
    sendResponse({ success: false, error: data.error });
    return true;
  }
  if (!data.question) {
    sendResponse({ success: false, error: "Question text was empty." });
    return true;
  }

  chrome.runtime.sendMessage(
    { action: "POST_TO_SUPABASE", payload: data },
    res => sendResponse(res)
  );
  return true;
});

// ── 7. URL-change Guard ──────────────────────────────────────

// Reset the dedupe guard when Sparx navigates to a new question
let lastUrl = location.href;
new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    lastSubmittedQuestion = null;
  }
}).observe(document.body, { childList: true, subtree: true });
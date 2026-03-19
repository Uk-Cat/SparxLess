// ============================================================
// content.js - Sparx Maths Auto-Submit to Supabase
// ============================================================

console.log("[Sparx Ext] content.js loaded on:", location.href);

// -- 1. React Fiber Helpers ----------------------------------

function findReact(dom) {
  for (var key in dom) {
    if (key.startsWith("__reactFiber$") || key.startsWith("__reactInternalInstance$")) {
      return dom[key];
    }
  }
  return null;
}

function findInReactTree(node, predicate, maxProperties) {
  maxProperties = maxProperties || 300;
  var count = 0;
  var stack = [node];
  while (stack.length && count < maxProperties) {
    var cur = stack.shift();
    try { if (predicate(cur)) return cur; } catch (e) {}
    if (Array.isArray(cur)) {
      stack.push.apply(stack, cur);
    } else if (cur && typeof cur === "object") {
      for (var k in cur) { try { stack.push(cur[k]); } catch (e) {} }
    }
    count++;
  }
  return null;
}

function findInTree(node, predicate, walkable, maxProperties) {
  walkable = walkable || [];
  maxProperties = maxProperties || 300;
  var count = 0;
  var stack = [node];
  while (stack.length && count < maxProperties) {
    var cur = stack.shift();
    try { if (predicate(cur)) return cur; } catch (e) {}
    if (Array.isArray(cur)) {
      stack.push.apply(stack, cur);
    } else if (cur && typeof cur === "object") {
      var keys = walkable.length ? walkable : Object.keys(cur);
      for (var i = 0; i < keys.length; i++) {
        try { if (keys[i] in cur) stack.push(cur[keys[i]]); } catch (e) {}
      }
    }
    count++;
  }
  return null;
}

// -- 2. DOM Text Extraction (handles KaTeX) ------------------

/**
 * Walks DOM nodes and extracts readable text.
 * For KaTeX nodes: reads the LaTeX source from the <annotation> tag
 * so we get "$y$" instead of garbled HTML.
 * Skips katex-html and katex-mathml subtrees to avoid double-reading.
 */
function extractTextNodes(node) {
  // KaTeX root: grab the raw LaTeX annotation
  if (node.classList && node.classList.contains("katex")) {
    var annotation = node.querySelector('annotation[encoding="application/x-tex"]');
    return annotation ? " " + annotation.textContent + " " : (node.innerText || "");
  }
  // Skip the duplicate HTML/MathML renders inside katex
  if (node.classList && (
    node.classList.contains("katex-html") ||
    node.classList.contains("katex-mathml")
  )) {
    return "";
  }
  // Plain text node
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent;
  }
  // Recurse into children
  var text = "";
  for (var i = 0; i < node.childNodes.length; i++) {
    text += extractTextNodes(node.childNodes[i]);
  }
  return text;
}

/**
 * Reads question text directly from the DOM.
 * Targets _TextElement_ spans inside the question area.
 */
function extractQuestionTextFromDOM() {
  // Collect all _TextElement_ nodes inside the question wrapper
  var wrapper = document.querySelector('[class*="_QuestionWrapper_"]');
  if (!wrapper) return "";

  var textElements = wrapper.querySelectorAll('[class*="_TextElement_"]');
  if (!textElements.length) return "";

  var parts = [];
  textElements.forEach(function(el) {
    var text = extractTextNodes(el).replace(/\s+/g, " ").trim();
    if (text && parts.indexOf(text) === -1) {
      parts.push(text);
    }
  });

  return parts.join(" ").trim();
}

// -- 3. Image ID Extraction ----------------------------------

/**
 * Reads image UUID from the React fiber's figure-ref node.
 * e.g. figure.image = "2734b91f-fadc-4520-a6ae-fc16381e241a"
 * Falls back to scraping the CDN <img> src from the DOM.
 */
function extractImageId(layout) {
  // Try fiber first (most reliable)
  if (layout) {
    var figureRef = findInTree(
      layout,
      function(n) { return n && n.element === "figure-ref" && n.figure && n.figure.image; },
      ["content"]
    );
    if (figureRef) return figureRef.figure.image;
  }

  // DOM fallback: find <img> inside _ImageContainer_
  var container = document.querySelector('[class*="_ImageContainer_"]');
  if (container) {
    var img = container.querySelector("img");
    if (img && img.src) {
      var parts = img.src.split("/");
      var last = parts[parts.length - 1];
      if (last && last.length > 8) return last;
    }
  }

  return null;
}

/**
 * Extracts the full image URL from the DOM.
 * Returns the <img> src attribute if available.
 */
function extractImageUrl() {
  var container = document.querySelector('[class*="_ImageContainer_"]');
  if (container) {
    var img = container.querySelector("img");
    if (img && img.src) {
      return img.src;
    }
  }
  return null;
}

// -- 4. Answer Extraction ------------------------------------

function extractAnswers(inputProps) {
  var answers = [];
  if (inputProps.number_fields) {
    Object.values(inputProps.number_fields).forEach(function(f) {
      if (f.value !== undefined && f.value !== "") answers.push(String(f.value));
    });
  }
  if (inputProps.text_fields) {
    Object.values(inputProps.text_fields).forEach(function(f) {
      if (f.value) answers.push(f.value);
    });
  }
  if (inputProps.cards) {
    Object.values(inputProps.cards).forEach(function(c) {
      if (c.slot_ref && c.content && c.content[0] && c.content[0].text) {
        answers.push(c.content[0].text);
      }
    });
  }
  if (inputProps.choices) {
    Object.values(inputProps.choices).forEach(function(c) {
      if (c.selected && c.content && c.content[0] && c.content[0].text) {
        answers.push(c.content[0].text);
      }
    });
  }
  return answers;
}

// -- 5. Main Extraction --------------------------------------

function extractQuestionData() {
  var questionWrapper = document.querySelector('[class*="_QuestionWrapper_"]');
  var questionInfo    = document.querySelector('[class*="_QuestionInfo_"]');

  if (!questionWrapper || !questionInfo) {
    var msg = "DOM elements not found";
    if (!questionWrapper) msg += " (QuestionWrapper)";
    if (!questionInfo) msg += " (QuestionInfo)";
    msg += " - are you on a Sparx question page?";
    return { error: msg };
  }

  // Question text: always read from DOM so KaTeX renders correctly
  var questionText = extractQuestionTextFromDOM();

  // For image ID and answers we still use the fiber
  var questionFiber = findReact(questionWrapper);
  var infoFiber     = findReact(questionInfo);

  var imageId      = null;
  var imageUrl     = null;
  var bookworkCode = null;
  var answers      = [];

  if (questionFiber) {
    try {
      var inputSection = findInReactTree(
        questionFiber.memoizedProps.children,
        function(n) { return n && n.layout && n.input; }
      );

      if (inputSection) {
        imageId = extractImageId(inputSection.layout);
        answers = extractAnswers(inputSection.input);
      }
    } catch (e) {
      console.warn("[Sparx Ext] Fiber extraction error:", e.message);
    }
  }

  // Image ID DOM fallback if fiber gave nothing
  if (!imageId) imageId = extractImageId(null);

  // Extract image URL (always from DOM)
  imageUrl = extractImageUrl();

  // Bookwork code: walk fiber parents, then fall back to DOM text pattern
  if (infoFiber) {
    var fiberNode = infoFiber;
    for (var i = 0; i < 20; i++) {
      if (fiberNode && fiberNode.memoizedProps && fiberNode.memoizedProps.bookworkCode) {
        bookworkCode = fiberNode.memoizedProps.bookworkCode;
        break;
      }
      fiberNode = fiberNode ? fiberNode.return : null;
    }
  }
  if (!bookworkCode) {
    var allText = questionInfo.innerText || "";
    var match = allText.match(/\b([A-Z]\d+)\b/);
    if (match) bookworkCode = match[1];
  }
  if (!bookworkCode) bookworkCode = "unknown-" + Date.now();

  if (!questionText) {
    return { error: "Question text was empty - page may still be rendering." };
  }

  return {
    question:     questionText,
    bookworkCode: bookworkCode,
    imageId:      imageId,
    imageUrl:     imageUrl,
    answers:      answers,
  };
}

// -- 6. Instant Logger (fires on question load) --------------

var lastLoggedQuestion    = null;
var lastSubmittedQuestion = null;
var lastUrl               = location.href;
var debounceTimer         = null;

function tryLogQuestion() {
  var data = extractQuestionData();
  if (!data || data.error || !data.question) return;
  if (data.question === lastLoggedQuestion) return;

  lastLoggedQuestion    = data.question;
  lastSubmittedQuestion = null;

  console.log("[Sparx Ext] ======================================");
  console.log("[Sparx Ext] NEW QUESTION DETECTED");
  console.log("[Sparx Ext] Question :", data.question);
  console.log("[Sparx Ext] Image ID :", data.imageId || "(no image on this question)");
  console.log("[Sparx Ext] Bookwork :", data.bookworkCode);
  console.log("[Sparx Ext] ======================================");

  // Send data to popup if it's open
  chrome.runtime.sendMessage({ action: 'QUESTION_DATA_DETECTED', payload: data }, function(response) {
    // Silently fail if popup isn't open - that's normal
    if (chrome.runtime.lastError) {
      // Popup not open, ignore
    }
  });
}

new MutationObserver(function() {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
  }
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(tryLogQuestion, 400);
}).observe(document.body, { childList: true, subtree: true });

// Try immediately in case question is already rendered
setTimeout(tryLogQuestion, 800);

// -- 7. Auto-Submit on Answer Submission ---------------------

function autoSubmit() {
  var data = extractQuestionData();

  if (!data || data.error) {
    console.warn("[Sparx Ext] Submit skipped:", data ? data.error : "null data");
    return;
  }
  if (!data.question) {
    console.warn("[Sparx Ext] Submit skipped - question text empty.");
    return;
  }
  if (data.question === lastSubmittedQuestion) return;
  lastSubmittedQuestion = data.question;

  console.log("[Sparx Ext] Submitting to Supabase...");

  chrome.runtime.sendMessage({ action: "POST_TO_SUPABASE", payload: data }, function(response) {
    if (response && response.success) {
      console.log("[Sparx Ext] Saved to Supabase successfully");
    } else {
      console.error("[Sparx Ext] Save failed:", response ? response.error : "no response");
    }
  });
}

// -- 8. Submit Button Detection ------------------------------

function isSubmitButton(el) {
  var node = el;
  for (var i = 0; i < 4; i++) {
    if (!node) break;
    if (node.tagName === "BUTTON") {
      var text  = (node.innerText || "").toLowerCase().trim();
      var label = (node.getAttribute("aria-label") || "").toLowerCase();
      if (
        text  === "check"  ||
        text  === "done"   ||
        text  === "next"   ||
        label.indexOf("check") !== -1 ||
        label.indexOf("next")  !== -1 ||
        node.querySelector('[data-icon="arrow-right"]') ||
        node.querySelector('[data-icon="check"]')
      ) return true;
    }
    node = node.parentElement;
  }
  return false;
}

document.addEventListener("click", function(e) {
  if (!isSubmitButton(e.target)) return;
  setTimeout(autoSubmit, 300);
}, true);

// -- 9. Manual Trigger (popup) -------------------------------

chrome.runtime.onMessage.addListener(function(message, _sender, sendResponse) {
  if (message.action !== "SAVE_QUESTION") return;

  var data = extractQuestionData();

  if (data && data.error) {
    sendResponse({ success: false, error: data.error });
    return true;
  }
  if (!data || !data.question) {
    sendResponse({ success: false, error: "Question text was empty." });
    return true;
  }

  chrome.runtime.sendMessage(
    { action: "POST_TO_SUPABASE", payload: data },
    function(res) { sendResponse(res); }
  );
  return true;
});

// -- 10. GET_QUESTION_DATA handler (for popup display) -------

chrome.runtime.onMessage.addListener(function(message, _sender, sendResponse) {
  if (message.action !== "GET_QUESTION_DATA") return;
  var data = extractQuestionData();
  if (data && data.error) {
    sendResponse({ error: data.error });
  } else {
    sendResponse(data);
  }
  return true;
});
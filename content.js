// ============================================================
// content.js - Sparx Maths Auto-Submit to Supabase
// Logs question + image ID the instant a question loads.
// Posts to Supabase when the user submits their answer.
// ============================================================

// -- 1. React Fiber Helpers ----------------------------------

function findReact(dom) {
  for (const key in dom) {
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

// -- 2. Answer Extraction ------------------------------------

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

// -- 3. Main Extraction --------------------------------------

function extractQuestionData() {
  var questionWrapper = document.querySelector('[class*="_QuestionWrapper_"]');
  var questionInfo    = document.querySelector('[class*="_QuestionInfo_"]');

  if (!questionWrapper || !questionInfo) {
    return { error: "DOM elements not found - are you on a Sparx question page?" };
  }

  var questionFiber = findReact(questionWrapper);
  var infoFiber     = findReact(questionInfo);

  if (!questionFiber || !infoFiber) {
    return { error: "React fiber not found - page may still be loading." };
  }

  try {
    // Find the section that has both layout and input
    var inputSection = findInReactTree(
      questionFiber.memoizedProps.children,
      function(n) { return n && n.layout && n.input; }
    );

    if (!inputSection) {
      return { error: "Could not find inputSection in React tree." };
    }

    var layout = inputSection.layout;

    // Extract question text
    // layout.content -> find group with type ["question-text"] -> find element:"text"
    var questionTextGroup = findInTree(
      layout,
      function(n) { return n && Array.isArray(n.type) && n.type.indexOf("question-text") !== -1; },
      ["content"]
    );

    var questionTextNode = findInTree(
      questionTextGroup,
      function(n) { return n && n.element === "text" && typeof n.text === "string"; },
      ["content"]
    );

    var questionText = questionTextNode ? questionTextNode.text.trim() : "";

    // Extract image ID from fiber (figure-ref node has figure.image UUID)
    var figureRef = findInTree(
      layout,
      function(n) { return n && n.element === "figure-ref" && n.figure && n.figure.image; },
      ["content"]
    );

    var imageId = figureRef ? figureRef.figure.image : null;

    // Extract bookwork code - walk fiber parents first
    var bookworkCode = null;
    var fiberNode = infoFiber;
    for (var i = 0; i < 20; i++) {
      if (fiberNode && fiberNode.memoizedProps && fiberNode.memoizedProps.bookworkCode) {
        bookworkCode = fiberNode.memoizedProps.bookworkCode;
        break;
      }
      fiberNode = fiberNode ? fiberNode.return : null;
    }
    // Fallback: read text from the DOM and match pattern like "B4"
    if (!bookworkCode) {
      var allText = questionInfo.innerText || "";
      var match = allText.match(/\b([A-Z]\d+)\b/);
      if (match) bookworkCode = match[1];
    }
    if (!bookworkCode) bookworkCode = "unknown-" + Date.now();

    var answers = extractAnswers(inputSection.input);

    return {
      question:     questionText,
      bookworkCode: bookworkCode,
      imageId:      imageId,
      answers:      answers,
    };

  } catch (err) {
    return { error: "Extraction error: " + err.message };
  }
}

// -- 4. Instant Logger (fires on question load) --------------

var lastLoggedQuestion    = null;
var lastSubmittedQuestion = null;
var lastUrl               = location.href;
var debounceTimer         = null;

function tryLogQuestion() {
  var data = extractQuestionData();
  if (!data || data.error || !data.question) return;
  if (data.question === lastLoggedQuestion) return; // already logged this one

  lastLoggedQuestion    = data.question;
  lastSubmittedQuestion = null; // reset submit dedupe for new question

  console.log("[Sparx Ext] ======================================");
  console.log("[Sparx Ext] NEW QUESTION DETECTED");
  console.log("[Sparx Ext] Question :", data.question);
  console.log("[Sparx Ext] Image ID :", data.imageId || "(no image on this question)");
  console.log("[Sparx Ext] Bookwork :", data.bookworkCode);
  console.log("[Sparx Ext] ======================================");
}

// Watch the whole DOM for changes - when Sparx renders a new question,
// wait 400ms for React to finish, then extract and log.
new MutationObserver(function() {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
  }
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(tryLogQuestion, 400);
}).observe(document.body, { childList: true, subtree: true });

// Also try immediately in case question is already on screen when script loads
setTimeout(tryLogQuestion, 800);

// -- 5. Auto-Submit on Answer Submission ---------------------

function autoSubmit() {
  var data = extractQuestionData();

  if (!data || data.error) {
    console.warn("[Sparx Ext] Submit skipped - extraction error:", data ? data.error : "null");
    return;
  }
  if (!data.question) {
    console.warn("[Sparx Ext] Submit skipped - question text empty.");
    return;
  }
  if (data.question === lastSubmittedQuestion) {
    return; // already submitted this question
  }
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

// -- 6. Submit Button Detection ------------------------------

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

// -- 7. Manual Trigger (popup) -------------------------------

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
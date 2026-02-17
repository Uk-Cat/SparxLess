const LOGO_URL = "https://static.sparx-learning.com/maths/49f67c3f6d3820553ea268777b7794e6f449e1fd/assets/sparx_maths_logo-BRwQ1-wz.svg";

/**
 * Filter out instructions and metadata
 */
function isNoise(text) {
  const blacklist = [
    "Question Preview", "Bookwork code", "Calculator allowed",
    "To pick up a draggable item", "While dragging", "Press space again",
    "press escape to cancel", "Simple interest" // Add more if needed
  ];
  // We only blacklist the EXACT noise phrases, not the math
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

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extractAll') {
    sendResponse({
      text: findAndExtractAll(),
      images: Array.from(document.querySelectorAll('img')).map(i => i.src).filter(s => s && s !== LOGO_URL && s.includes('sparx-learning.com'))
    });
  } else if (request.action === 'autoSolve') {
    performAutoSolve(request.answer);
  }
  return true;
});
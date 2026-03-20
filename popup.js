document.addEventListener('DOMContentLoaded', async () => {
    // ── Selectors ──────────────────────────────────────────────────────────────
    const solveBtn        = document.getElementById('solve-btn');
    const submitBtn       = document.getElementById('submit-btn');
    const submitStatus    = document.getElementById('submit-status');
    const settingsPanel   = document.getElementById('settings-panel');
    const toggleSettings  = document.getElementById('toggle-settings');
    const saveSettings    = document.getElementById('save-settings');
    const resultContainer = document.getElementById('result-container');
    const aiRes           = document.getElementById('ai-res');
    const rawContainer    = document.getElementById('raw-ai-response');
    const toggleRaw       = document.getElementById('toggle-raw');
    const previewBox      = document.getElementById('text-preview');
    const apiKeyInput     = document.getElementById('api-key-input');
    const providerSelect  = document.getElementById('provider-select');
    const modelSelect     = document.getElementById('model-select');
    const bookworkPanel   = document.getElementById('bookwork-panel');
    const toggleBookwork  = document.getElementById('toggle-bookwork');
    const bookworkContent = document.getElementById('bookwork-content');
    // Image preview elements (replaces old imageIdDisplay text)
    const imageCard       = document.getElementById('image-card');
    const imagePreview    = document.getElementById('image-preview');
    const copyImageBtn    = document.getElementById('copy-image-btn');

    // Tracks the current image URL so the copy button always has it
    let currentImageUrl = null;

    // ── Shared copy feedback helper ────────────────────────────────────────────
    function showCopied(btn, originalLabel) {
        btn.textContent = '✓ Copied!';
        btn.classList.add('copied');
        setTimeout(() => {
            btn.textContent = originalLabel;
            btn.classList.remove('copied');
        }, 2000);
    }

    // ── Question copy button ───────────────────────────────────────────────────
    const copyQuestionBtn = document.getElementById('copy-question-btn');
    copyQuestionBtn.addEventListener('click', () => {
        const text = previewBox.innerText?.trim();
        if (!text) return;
        navigator.clipboard.writeText(text)
            .then(() => showCopied(copyQuestionBtn, 'Copy'))
            .catch(() => {
                const ta = document.createElement('textarea');
                ta.value = text;
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
                showCopied(copyQuestionBtn, 'Copy');
            });
    });

    // ── Image preview helpers ──────────────────────────────────────────────────
    function showImagePreview(imageUrl) {
        if (!imageUrl) {
            imageCard.style.display = 'none';
            currentImageUrl = null;
            return;
        }
        currentImageUrl = imageUrl;
        imagePreview.src = imageUrl;
        imageCard.style.display = 'block';
    }

    // Copy Image button — fetches the image, converts to PNG blob, and writes
    // it to the clipboard as an actual image so it can be pasted directly
    // into ChatGPT, Google, etc. (not just a URL).
    copyImageBtn.addEventListener('click', async () => {
        if (!currentImageUrl) return;
        copyImageBtn.textContent = 'Copying...';
        copyImageBtn.disabled = true;
        try {
            const response = await fetch(currentImageUrl);
            const blob     = await response.blob();

            // Clipboard API only accepts image/png — convert if needed
            let pngBlob = blob;
            if (blob.type !== 'image/png') {
                pngBlob = await convertToPng(blob);
            }

            await navigator.clipboard.write([
                new ClipboardItem({ 'image/png': pngBlob })
            ]);
            showCopied(copyImageBtn, 'Copy Image');
        } catch (err) {
            console.error('[SparxLess] Image copy failed:', err);
            copyImageBtn.textContent = '✗ Failed';
            copyImageBtn.style.color = '#ef4444';
            setTimeout(() => {
                copyImageBtn.textContent = 'Copy Image';
                copyImageBtn.style.color = '';
            }, 2000);
        } finally {
            copyImageBtn.disabled = false;
        }
    });

    // Draws the image onto a canvas and returns a PNG blob
    function convertToPng(blob) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(blob);
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width  = img.naturalWidth;
                canvas.height = img.naturalHeight;
                canvas.getContext('2d').drawImage(img, 0, 0);
                URL.revokeObjectURL(url);
                canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png');
            };
            img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image load failed')); };
            img.src = url;
        });
    }

    // ── Model configurations ───────────────────────────────────────────────────
    const modelOptions = {
        google: [
            { name: "Gemma 3 27B",      id: "gemma-3-27b-it"   },
            { name: "Gemini 2.5 Flash", id: "gemini-2.5-flash" },
            { name: "Gemini 2.5 Pro",   id: "gemini-2.5-pro"   }
        ],
        openrouter: [
            { name: "DeepSeek R1 0528 (Free)",     id: "deepseek/deepseek-r1-0528:free"           },
            { name: "Qwen3 235B Thinking (Free)",   id: "qwen/qwen3-235b-a22b-thinking-2507:free"  },
            { name: "OpenAI GPT-OSS 120B (Free)",   id: "openai/gpt-oss-120b:free"                 },
            { name: "GLM 4.5 Air (Free)",           id: "z-ai/glm-4.5-air:free"                    },
            { name: "Llama 3.3 70B (Free)",         id: "meta-llama/llama-3.3-70b-instruct:free"   },
            { name: "Step 3.5 Flash (Free)",        id: "stepfun/step-3-5-flash:free"              },
            { name: "Aurora Alpha (Reasoning)",     id: "openrouter/aurora-alpha:free"             },
            { name: "Arcee Trinity Large (Free)",   id: "arcee-ai/trinity-large-preview:free"      },
            { name: "Qwen3 Coder 480B (Free)",      id: "qwen/qwen3-coder-480b-a35b:free"          },
            { name: "NVIDIA Nemotron 30B (Free)",   id: "nvidia/nemotron-3-nano-30b-a3b:free"      },
            { name: "OpenAI GPT-OSS 20B (Free)",    id: "openai/gpt-oss-20b:free"                  },
            { name: "Solar Pro 3 (Free)",           id: "upstage/solar-pro-3:free"                 },
            { name: "Trinity Mini (Free)",          id: "arcee-ai/trinity-mini:free"               }
        ]
    };

    // ── UI: Settings drawer ────────────────────────────────────────────────────
    toggleSettings.onclick = () => {
        const isOpen = settingsPanel.style.display === 'block';
        settingsPanel.style.display = isOpen ? 'none' : 'block';
        if (bookworkPanel) bookworkPanel.style.display = 'none';
    };

    // ── UI: Reasoning toggle ───────────────────────────────────────────────────
    toggleRaw.onclick = () => {
        const isHidden = rawContainer.style.display === 'none';
        rawContainer.style.display = isHidden ? 'block' : 'none';
        toggleRaw.innerText = isHidden ? "HIDE REASONING" : "SHOW REASONING";
    };

    // ── UI: Bookwork history panel toggle ──────────────────────────────────────
    if (toggleBookwork && bookworkPanel) {
        toggleBookwork.onclick = () => {
            const isHidden = bookworkPanel.style.display === 'none' || bookworkPanel.style.display === '';
            bookworkPanel.style.display = isHidden ? 'block' : 'none';
            settingsPanel.style.display = 'none';
            if (isHidden) renderBookworkHistory();
        };
    }

    // ── Model dropdown ─────────────────────────────────────────────────────────
    const updateModelDropdown = (provider, selectedModelId = null) => {
        modelSelect.innerHTML = modelOptions[provider]
            .map(m => `<option value="${m.id}" ${m.id === selectedModelId ? 'selected' : ''}>${m.name}</option>`)
            .join('');
    };

    providerSelect.onchange = () => updateModelDropdown(providerSelect.value);

    // ── Load saved settings ────────────────────────────────────────────────────
    chrome.storage.sync.get(['apiKey', 'provider', 'selectedModel'], (data) => {
        if (data.apiKey) apiKeyInput.value = data.apiKey;
        if (data.provider) {
            providerSelect.value = data.provider;
            updateModelDropdown(data.provider, data.selectedModel);
        } else {
            updateModelDropdown('google');
        }
    });

    // ── Save settings ──────────────────────────────────────────────────────────
    saveSettings.onclick = () => {
        chrome.storage.sync.set({
            apiKey:        apiKeyInput.value,
            provider:      providerSelect.value,
            selectedModel: modelSelect.value
        }, () => {
            settingsPanel.style.display = 'none';
            alert("Settings Saved!");
        });
    };

    // ── Initial page scan ──────────────────────────────────────────────────────
    // The display cache is locked by content.js on the first valid extraction
    // and only cleared when the URL changes (next question). So:
    //   - If cache exists → always use it (we may be mid-answer, live DOM is dirty)
    //   - If cache is empty → run a live scan to populate it for the first time
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    chrome.storage.local.get(['SparxLessDisplay'], (stored) => {
        const cached = stored['SparxLessDisplay'];

        if (cached?.text || cached?.imageUrl) {
            // Cache is locked — render it and do NOT overwrite with live DOM values
            if (cached.text)     previewBox.innerText = cached.text;
            if (cached.imageUrl) showImagePreview(cached.imageUrl);
        } else if (tab?.id) {
            // Cache is empty (new question, fresh page) — live scan to populate
            chrome.tabs.sendMessage(tab.id, { action: 'extractAll' }, (data) => {
                if (chrome.runtime.lastError) return;
                if (data?.text) previewBox.innerText = data.text;
                showImagePreview(data?.images?.[0] ?? null);
            });
        }
    });

    // ── Submit to Unconfirmed (Supabase) ───────────────────────────────────────
    if (submitBtn) {
        submitBtn.onclick = async () => {
            if (!tab?.id) {
                if (submitStatus) { submitStatus.style.color = '#ef4444'; submitStatus.innerText = '✗ No active Sparx tab found.'; }
                return;
            }

            submitBtn.disabled = true;
            submitBtn.innerText = "SUBMITTING...";
            if (submitStatus) { submitStatus.style.color = '#6b7280'; submitStatus.innerText = 'Reading page...'; }

            // question + imageId come from the locked display cache — never the live DOM.
            // answer + studentName come from the pending snapshot (last interaction).
            chrome.storage.local.get(['SparxLessDisplay', 'SparxLessPending'], (stored) => {
                const display = stored['SparxLessDisplay'];
                const pending = stored['SparxLessPending'];

                const question    = display?.text        || null;
                // Extract UUID from the stored image URL — don't send the full URL as the ID
                const imageId     = extractImageId(display?.imageUrl) || null;
                const answer      = pending?.answer      || null;
                const studentName = pending?.studentName || null;

                if (!question) {
                    submitBtn.disabled = false;
                    submitBtn.innerText = "SUBMIT TO UNCONFIRMED";
                    if (submitStatus) { submitStatus.style.color = '#ef4444'; submitStatus.innerText = '✗ No question detected. Open the extension on a question page first.'; }
                    return;
                }

                if (submitStatus) { submitStatus.style.color = '#6b7280'; submitStatus.innerText = 'Sending to database...'; }

                chrome.runtime.sendMessage(
                    { action: 'POST_TO_SUPABASE', payload: { question, imageId, answer, studentName } },
                    (result) => {
                        submitBtn.disabled = false;
                        submitBtn.innerText = "SUBMIT TO UNCONFIRMED";

                        if (result?.success) {
                            if (submitStatus) { submitStatus.style.color = '#10b981'; submitStatus.innerText = '✓ Submitted successfully!'; }
                        } else {
                            const msg = result?.error || 'Unknown error';
                            if (submitStatus) { submitStatus.style.color = '#ef4444'; submitStatus.innerText = `✗ Error: ${msg}`; }
                            console.error('[SparxLess] Submit failed:', msg);
                        }

                        setTimeout(() => { if (submitStatus) submitStatus.innerText = ''; }, 4000);
                    }
                );
            });
        };
    }

    // ── Bookwork history renderer ──────────────────────────────────────────────
    async function renderBookworkHistory() {
        if (!bookworkContent) return;
        bookworkContent.innerHTML = '<em style="font-size:11px;color:#6b7280;">Loading...</em>';

        const BOOKWORK_KEY = "SparxLessBookwork";
        chrome.storage.local.get([BOOKWORK_KEY], (result) => {
            const store = result[BOOKWORK_KEY] || {};
            const codes = Object.keys(store).sort();

            if (codes.length === 0) {
                bookworkContent.innerHTML =
                    '<p style="font-size:11px;color:#6b7280;text-align:center;margin:8px 0;">No saved answers yet.<br>Answers are saved automatically as you work.</p>';
                return;
            }

            bookworkContent.innerHTML = codes.map(code => {
                const entries = Array.isArray(store[code]) ? store[code] : [];
                const recent  = entries
                    .filter(e => e.answers?.length > 0)
                    .sort((a, b) => b.date - a.date)
                    .slice(0, 3);

                if (recent.length === 0) return '';

                const rows = recent.map(entry => {
                    const dateStr    = new Date(entry.date).toLocaleString('en-GB', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' });
                    const answersStr = entry.answers.join(', ');
                    return `
                        <div style="margin-bottom:6px;padding:6px 8px;background:#f3f4f6;border-radius:4px;border-left:3px solid #4f46e5;">
                            <div style="font-size:10px;color:#6b7280;margin-bottom:2px;">${escapeHtml(dateStr)}</div>
                            <div style="font-size:12px;font-weight:600;color:#111827;">${escapeHtml(answersStr)}</div>
                            <div style="font-size:10px;color:#9ca3af;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(entry.id)}">${escapeHtml(entry.id.substring(0, 60))}${entry.id.length > 60 ? '…' : ''}</div>
                        </div>`;
                }).join('');

                return `
                    <div style="margin-bottom:10px;">
                        <div style="font-size:10px;font-weight:bold;color:#4f46e5;text-transform:uppercase;margin-bottom:4px;letter-spacing:0.5px;">Code: ${escapeHtml(code)}</div>
                        ${rows}
                    </div>`;
            }).join('');

            bookworkContent.innerHTML += `
                <button id="clear-bookwork-btn" style="width:100%;margin-top:8px;padding:6px;background:#fee2e2;color:#dc2626;border:1px solid #fca5a5;border-radius:4px;font-size:10px;font-weight:bold;cursor:pointer;">
                    CLEAR ALL SAVED ANSWERS
                </button>`;

            document.getElementById('clear-bookwork-btn')?.addEventListener('click', () => {
                if (confirm('Clear all saved bookwork answers?')) {
                    chrome.storage.local.remove([BOOKWORK_KEY], () => renderBookworkHistory());
                }
            });
        });
    }

    // ── Core solver ────────────────────────────────────────────────────────────
    solveBtn.onclick = async () => {
        if (!tab?.id) {
            alert("Could not detect the active tab. Please reopen the extension.");
            return;
        }

        chrome.storage.sync.get(['apiKey', 'provider', 'selectedModel'], async (config) => {
            if (!config.apiKey) return alert("Please set your API Key in Settings!");

            solveBtn.disabled = true;
            solveBtn.innerText = "THINKING...";
            resultContainer.style.display = 'block';
            aiRes.innerText = "Processing...";
            rawContainer.style.display = 'none';
            toggleRaw.innerText = "SHOW REASONING";

            const prompt = `You are a math tutor. Solve this problem step-by-step. Put ONLY the final result inside \\boxed{}. Problem: ${previewBox.innerText}`;
            let url, options;

            if (config.provider === 'openrouter') {
                url = "https://openrouter.ai/api/v1/chat/completions";
                options = {
                    method: 'POST',
                    headers: { "Authorization": `Bearer ${config.apiKey}`, "Content-Type": "application/json", "X-Title": "SparxLess AI" },
                    body: JSON.stringify({ model: config.selectedModel, messages: [{ role: "user", content: prompt }] })
                };
            } else {
                url = `https://generativelanguage.googleapis.com/v1beta/models/${config.selectedModel}:generateContent?key=${config.apiKey}`;
                options = {
                    method: 'POST',
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
                };
            }

            try {
                const response = await fetch(url, options);
                const json     = await response.json();
                if (json.error) throw new Error(json.error.message || "API Error");

                const rawText     = config.provider === 'openrouter'
                    ? json.choices[0].message.content
                    : json.candidates[0].content.parts[0].text;
                const cleanAnswer = extractAnswer(rawText);
                aiRes.innerHTML   = `<strong>${cleanAnswer}</strong>`;
                rawContainer.innerText = rawText;

                chrome.tabs.sendMessage(tab.id, { action: 'autoSolve', answer: cleanAnswer });
            } catch (err) {
                aiRes.innerText = "Error: " + err.message;
                console.error(err);
            } finally {
                solveBtn.disabled = false;
                solveBtn.innerText = "SOLVE PROBLEM";
            }
        });
    };
});

// ── Helpers ────────────────────────────────────────────────────────────────────

function extractImageId(url) {
    if (!url) return null;
    const match = url.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    return match ? match[0] : null;
}

function extractAnswer(text) {
    const boxedMatch = text.match(/\\boxed\{((?:[^{}]|\{[^{}]*\})*)\}/);
    if (boxedMatch) return boxedMatch[1];
    const lines = text.trim().split('\n');
    return lines[lines.length - 1].replace(/Answer:/i, '').trim();
}

function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
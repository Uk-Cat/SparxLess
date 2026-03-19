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
    const imageIdDisplay  = document.getElementById('image-id-display');
    const apiKeyInput     = document.getElementById('api-key-input');
    const providerSelect  = document.getElementById('provider-select');
    const modelSelect     = document.getElementById('model-select');
    const bookworkPanel   = document.getElementById('bookwork-panel');
    const toggleBookwork  = document.getElementById('toggle-bookwork');
    const bookworkContent = document.getElementById('bookwork-content');

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
        settingsPanel.style.display = settingsPanel.style.display === 'block' ? 'none' : 'block';
        if (bookworkPanel) bookworkPanel.style.display = 'none';
    };

    // ── UI: Reasoning toggle ───────────────────────────────────────────────────
    toggleRaw.onclick = () => {
        const isHidden = rawContainer.style.display === 'none';
        rawContainer.style.display = isHidden ? 'block' : 'none';
        toggleRaw.innerText = isHidden ? "HIDE REASONING" : "SHOW REASONING";
    };

    // ── UI: Bookwork history panel toggle ──────────────────────────────────────
    if (toggleBookwork) {
        toggleBookwork.onclick = () => {
            const isHidden = !bookworkPanel || bookworkPanel.style.display === 'none';
            if (bookworkPanel) {
                bookworkPanel.style.display = isHidden ? 'block' : 'none';
                settingsPanel.style.display = 'none';
            }
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
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, { action: 'extractAll' }, (data) => {
            if (data?.text)    previewBox.innerText = data.text;
            // Show the detected image ID in its card
            if (imageIdDisplay) {
                imageIdDisplay.innerText = data?.imageId ?? 'None detected';
            }
        });
    }

    // ── Submit to Unconfirmed (Supabase) ───────────────────────────────────────
    // Uses the same getCurrentQuestionText() + getCurrentImageId() already running
    // in content.js — just sends SAVE_QUESTION which background.js routes to Supabase.
    if (submitBtn) {
        submitBtn.onclick = async () => {
            submitBtn.disabled = true;
            submitBtn.innerText = "SUBMITTING...";
            if (submitStatus) { submitStatus.style.color = '#6b7280'; submitStatus.innerText = 'Sending to database...'; }

            chrome.runtime.sendMessage({ action: 'SAVE_QUESTION' }, (result) => {
                submitBtn.disabled = false;
                submitBtn.innerText = "SUBMIT TO UNCONFIRMED";

                if (result?.success) {
                    if (submitStatus) { submitStatus.style.color = '#10b981'; submitStatus.innerText = '✓ Submitted successfully!'; }
                } else {
                    const msg = result?.error || 'Unknown error';
                    if (submitStatus) { submitStatus.style.color = '#ef4444'; submitStatus.innerText = `✗ Error: ${msg}`; }
                    console.error('[SparxLess] Submit failed:', msg);
                }

                // Clear status after 4 seconds
                setTimeout(() => { if (submitStatus) submitStatus.innerText = ''; }, 4000);
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

                const rawText    = config.provider === 'openrouter' ? json.choices[0].message.content : json.candidates[0].content.parts[0].text;
                const cleanAnswer = extractAnswer(rawText);
                aiRes.innerHTML  = `<strong>${cleanAnswer}</strong>`;
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

function extractAnswer(text) {
    const boxedMatch = text.match(/\\boxed\{((?:[^{}]|\{[^{}]*\})*)\}/);
    if (boxedMatch) return boxedMatch[1];
    const lines = text.trim().split('\n');
    return lines[lines.length - 1].replace(/Answer:/i, '').trim();
}

function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
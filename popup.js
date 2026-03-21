document.addEventListener('DOMContentLoaded', async () => {

    // ── Selectors ──────────────────────────────────────────────────────────────
    const solveBtn        = document.getElementById('solve-btn');
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
    const imageCard       = document.getElementById('image-card');
    const imagePreview    = document.getElementById('image-preview');
    const copyImageBtn    = document.getElementById('copy-image-btn');

    let currentImageUrl = null;

    // ── Copy feedback helper ───────────────────────────────────────────────────
    function showCopied(btn, originalLabel) {
        btn.textContent = 'Copied!';
        btn.classList.add('copied');
        setTimeout(() => {
            btn.textContent = originalLabel;
            btn.classList.remove('copied');
        }, 2000);
    }

    // ── Copy question text ─────────────────────────────────────────────────────
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

    // ── Image preview ──────────────────────────────────────────────────────────
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

    copyImageBtn.addEventListener('click', async () => {
        if (!currentImageUrl) return;
        copyImageBtn.textContent = 'Copying...';
        copyImageBtn.disabled = true;
        try {
            const response = await fetch(currentImageUrl);
            const blob     = await response.blob();
            const pngBlob  = blob.type !== 'image/png' ? await convertToPng(blob) : blob;
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
            showCopied(copyImageBtn, 'Copy Image');
        } catch (err) {
            console.error('[SparxLess] Image copy failed:', err);
            copyImageBtn.textContent = 'Failed';
            copyImageBtn.style.color = '#ef4444';
            setTimeout(() => {
                copyImageBtn.textContent = 'Copy Image';
                copyImageBtn.style.color = '';
            }, 2000);
        } finally {
            copyImageBtn.disabled = false;
        }
    });

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

    // ── Model options ──────────────────────────────────────────────────────────
    const modelOptions = {
        google: [
            { name: 'Gemma 3 27B',      id: 'gemma-3-27b-it'   },
            { name: 'Gemini 2.5 Flash', id: 'gemini-2.5-flash' },
            { name: 'Gemini 2.5 Pro',   id: 'gemini-2.5-pro'   }
        ],
        openrouter: [
            { name: 'DeepSeek R1 0528 (Free)',   id: 'deepseek/deepseek-r1-0528:free'          },
            { name: 'Qwen3 235B Thinking (Free)', id: 'qwen/qwen3-235b-a22b-thinking-2507:free' },
            { name: 'OpenAI GPT-OSS 120B (Free)', id: 'openai/gpt-oss-120b:free'                },
            { name: 'GLM 4.5 Air (Free)',         id: 'z-ai/glm-4.5-air:free'                   },
            { name: 'Llama 3.3 70B (Free)',       id: 'meta-llama/llama-3.3-70b-instruct:free'  },
            { name: 'Step 3.5 Flash (Free)',      id: 'stepfun/step-3-5-flash:free'             },
            { name: 'Aurora Alpha (Reasoning)',   id: 'openrouter/aurora-alpha:free'            },
            { name: 'Arcee Trinity Large (Free)', id: 'arcee-ai/trinity-large-preview:free'     },
            { name: 'Qwen3 Coder 480B (Free)',    id: 'qwen/qwen3-coder-480b-a35b:free'         },
            { name: 'NVIDIA Nemotron 30B (Free)', id: 'nvidia/nemotron-3-nano-30b-a3b:free'     },
            { name: 'OpenAI GPT-OSS 20B (Free)',  id: 'openai/gpt-oss-20b:free'                 },
            { name: 'Solar Pro 3 (Free)',         id: 'upstage/solar-pro-3:free'                },
            { name: 'Trinity Mini (Free)',        id: 'arcee-ai/trinity-mini:free'              }
        ]
    };

    // ── Settings drawer ────────────────────────────────────────────────────────
    toggleSettings.onclick = () => {
        const isOpen = settingsPanel.style.display === 'block';
        settingsPanel.style.display = isOpen ? 'none' : 'block';
        if (bookworkPanel) bookworkPanel.style.display = 'none';
    };

    toggleRaw.onclick = () => {
        const isHidden = rawContainer.style.display === 'none';
        rawContainer.style.display = isHidden ? 'block' : 'none';
        toggleRaw.innerText = isHidden ? 'HIDE REASONING' : 'SHOW REASONING';
    };

    if (toggleBookwork && bookworkPanel) {
        toggleBookwork.onclick = () => {
            const isHidden = bookworkPanel.style.display === 'none' || bookworkPanel.style.display === '';
            bookworkPanel.style.display = isHidden ? 'block' : 'none';
            settingsPanel.style.display = 'none';
            if (isHidden) renderBookworkHistory();
        };
    }

    const updateModelDropdown = (provider, selectedModelId) => {
        modelSelect.innerHTML = modelOptions[provider]
            .map(m => '<option value="' + m.id + '"' + (m.id === selectedModelId ? ' selected' : '') + '>' + m.name + '</option>')
            .join('');
    };

    providerSelect.onchange = () => updateModelDropdown(providerSelect.value, null);

    chrome.storage.sync.get(['apiKey', 'provider', 'selectedModel'], (data) => {
        if (data.apiKey) apiKeyInput.value = data.apiKey;
        if (data.provider) {
            providerSelect.value = data.provider;
            updateModelDropdown(data.provider, data.selectedModel);
        } else {
            updateModelDropdown('google', null);
        }
    });

    saveSettings.onclick = () => {
        chrome.storage.sync.set({
            apiKey:        apiKeyInput.value,
            provider:      providerSelect.value,
            selectedModel: modelSelect.value
        }, () => {
            settingsPanel.style.display = 'none';
            alert('Settings Saved!');
        });
    };

    // ── Tab ────────────────────────────────────────────────────────────────────
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // ── Database lookup → result card ──────────────────────────────────────────
    function lookupAndShowResult(questionText, imageUrl) {
        const imageId = extractImageId(imageUrl);
        resultContainer.style.display = 'block';
        aiRes.innerHTML = '<span style="color:#6b7280;font-size:12px;">Checking database...</span>';
        rawContainer.style.display = 'none';
        toggleRaw.style.display = 'none';

        chrome.runtime.sendMessage(
            { action: 'LOOKUP_SUPABASE', payload: { question: questionText, imageId: imageId } },
            (result) => {
                if (chrome.runtime.lastError || !result || !result.found) {
                    resultContainer.style.display = 'none';
                    toggleRaw.style.display = 'block';
                    return;
                }
                toggleRaw.style.display = 'none';
                const answerHtml = escapeHtml(String(result.answer));
                if (result.confirmed) {
                    aiRes.innerHTML =
                        '<span style="font-size:11px;color:#059669;font-weight:700;' +
                        'text-transform:uppercase;letter-spacing:0.5px;">' +
                        '\u2705 Confirmed Answer</span><br>' +
                        '<strong style="font-size:16px;">' + answerHtml + '</strong>';
                } else {
                    aiRes.innerHTML =
                        '<span style="font-size:11px;color:#d97706;font-weight:700;' +
                        'text-transform:uppercase;letter-spacing:0.5px;">' +
                        '\u26a0\ufe0f Unconfirmed \u2014 may be wrong</span><br>' +
                        '<strong style="font-size:16px;">' + answerHtml + '</strong>';
                }
            }
        );
    }

    // ── Page scan: cache → live → retry ───────────────────────────────────────
    function applyExtracted(text, imageUrl) {
        if (text)     previewBox.innerText = text;
        if (imageUrl) showImagePreview(imageUrl);
        if (text)     lookupAndShowResult(text, imageUrl);
    }

    function doLiveScan(onEmpty) {
        if (!tab || !tab.id) { if (onEmpty) onEmpty(); return; }
        chrome.tabs.sendMessage(tab.id, { action: 'extractAll' }, (data) => {
            if (chrome.runtime.lastError || !data || !data.text) {
                if (onEmpty) onEmpty();
                return;
            }
            applyExtracted(data.text, data.images && data.images[0] ? data.images[0] : null);
        });
    }

    chrome.storage.local.get(['SparxLessDisplay'], (stored) => {
        const cached = stored['SparxLessDisplay'];
        if (cached && (cached.text || cached.imageUrl)) {
            applyExtracted(cached.text || null, cached.imageUrl || null);
        } else {
            doLiveScan(() => {
                setTimeout(() => doLiveScan(null), 800);
            });
        }
    });


    // ── Bookwork history ───────────────────────────────────────────────────────
    function renderBookworkHistory() {
        if (!bookworkContent) return;
        bookworkContent.innerHTML = '<em style="font-size:11px;color:#6b7280;">Loading...</em>';

        const BOOKWORK_KEY = 'SparxLessBookwork';
        chrome.storage.local.get([BOOKWORK_KEY], (result) => {
            const store = result[BOOKWORK_KEY] || {};
            const codes = Object.keys(store).sort();

            if (codes.length === 0) {
                bookworkContent.innerHTML =
                    '<p style="font-size:11px;color:#6b7280;text-align:center;margin:8px 0;">' +
                    'No saved answers yet.<br>Answers are saved automatically as you work.</p>';
                return;
            }

            let html = '';
            codes.forEach((code) => {
                const entries = Array.isArray(store[code]) ? store[code] : [];
                const latest  = entries
                    .filter(e => e.answers && e.answers.length > 0)
                    .sort((a, b) => b.date - a.date)[0];
                if (!latest) return;

                const answersStr = latest.answers.join(', ');
                const dateStr    = new Date(latest.date).toLocaleString('en-GB', {
                    day: '2-digit', month: '2-digit', year: '2-digit',
                    hour: '2-digit', minute: '2-digit'
                });

                html +=
                    '<div style="display:flex;align-items:center;justify-content:space-between;' +
                    'padding:8px 10px;margin-bottom:6px;background:#f3f4f6;border-radius:6px;' +
                    'border-left:3px solid #4f46e5;gap:8px;">' +
                        '<div style="font-size:13px;font-weight:800;color:#4f46e5;min-width:28px;white-space:nowrap;">' +
                            escapeHtml(code) +
                        '</div>' +
                        '<div style="font-size:13px;font-weight:600;color:#111827;flex:1;text-align:center;">' +
                            escapeHtml(answersStr) +
                        '</div>' +
                        '<div style="font-size:10px;color:#9ca3af;white-space:nowrap;">' +
                            escapeHtml(dateStr) +
                        '</div>' +
                    '</div>';
            });

            bookworkContent.innerHTML = html ||
                '<p style="font-size:11px;color:#6b7280;text-align:center;">No answers recorded yet.</p>';

            bookworkContent.innerHTML +=
                '<button id="clear-bookwork-btn" style="width:100%;margin-top:8px;padding:6px;' +
                'background:#fee2e2;color:#dc2626;border:1px solid #fca5a5;border-radius:4px;' +
                'font-size:10px;font-weight:bold;cursor:pointer;">CLEAR ALL SAVED ANSWERS</button>';

            const clearBtn = document.getElementById('clear-bookwork-btn');
            if (clearBtn) {
                clearBtn.addEventListener('click', () => {
                    if (confirm('Clear all saved bookwork answers?')) {
                        chrome.storage.local.remove([BOOKWORK_KEY], () => renderBookworkHistory());
                    }
                });
            }
        });
    }

    // ── Core solver ────────────────────────────────────────────────────────────
    solveBtn.onclick = () => {
        if (!tab || !tab.id) {
            alert('Could not detect the active tab. Please reopen the extension.');
            return;
        }

        chrome.storage.sync.get(['apiKey', 'provider', 'selectedModel'], (config) => {
            if (!config.apiKey) { alert('Please set your API Key in Settings!'); return; }

            solveBtn.disabled = true;
            solveBtn.innerText = 'THINKING...';
            resultContainer.style.display = 'block';
            aiRes.innerText = 'Processing...';
            rawContainer.style.display = 'none';
            toggleRaw.innerText = 'SHOW REASONING';
            toggleRaw.style.display = 'block';

            const prompt =
                'You are a math tutor. Solve this problem step-by-step. ' +
                'Put ONLY the final result inside \\boxed{}. Problem: ' +
                previewBox.innerText;

            let url, options;

            if (config.provider === 'openrouter') {
                url = 'https://openrouter.ai/api/v1/chat/completions';
                options = {
                    method: 'POST',
                    headers: {
                        'Authorization': 'Bearer ' + config.apiKey,
                        'Content-Type': 'application/json',
                        'X-Title': 'SparxLess AI'
                    },
                    body: JSON.stringify({ model: config.selectedModel, messages: [{ role: 'user', content: prompt }] })
                };
            } else {
                url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
                      config.selectedModel + ':generateContent?key=' + config.apiKey;
                options = {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
                };
            }

            fetch(url, options)
                .then(res => res.json())
                .then(json => {
                    if (json.error) throw new Error(json.error.message || 'API Error');
                    const rawText = config.provider === 'openrouter'
                        ? json.choices[0].message.content
                        : json.candidates[0].content.parts[0].text;
                    const cleanAnswer = extractAnswer(rawText);
                    aiRes.innerHTML = '<strong>' + cleanAnswer + '</strong>';
                    rawContainer.innerText = rawText;
                    chrome.tabs.sendMessage(tab.id, { action: 'autoSolve', answer: cleanAnswer });
                })
                .catch(err => {
                    aiRes.innerText = 'Error: ' + err.message;
                    console.error(err);
                })
                .finally(() => {
                    solveBtn.disabled = false;
                    solveBtn.innerText = 'SOLVE PROBLEM';
                });
        });
    };

}); // end DOMContentLoaded

// ── Helpers (global) ──────────────────────────────────────────────────────────

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
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
document.addEventListener('DOMContentLoaded', async () => {
    // Selectors
    const solveBtn = document.getElementById('solve-btn');
    const settingsPanel = document.getElementById('settings-panel');
    const toggleSettings = document.getElementById('toggle-settings');
    const saveSettings = document.getElementById('save-settings');
    const resultContainer = document.getElementById('result-container');
    const aiRes = document.getElementById('ai-res');
    const rawContainer = document.getElementById('raw-ai-response');
    const toggleRaw = document.getElementById('toggle-raw');
    const previewBox = document.getElementById('text-preview');
    const apiKeyInput = document.getElementById('api-key-input');
    const providerSelect = document.getElementById('provider-select');
    const modelSelect = document.getElementById('model-select');

    // Model configurations for each provider
    const modelOptions = {
        google: [
            { name: "Gemma 3 27B", id: "gemma-3-27b-it" },
            { name: "Gemini 2.5 Flash", id: "gemini-2.5-flash" },
            { name: "Gemini 2.5 Pro", id: "gemini-2.5-pro" }
        ],
        openrouter: [
            { name: "DeepSeek R1 0528 (Free)", id: "deepseek/deepseek-r1-0528:free" },
            { name: "Qwen3 235B Thinking (Free)", id: "qwen/qwen3-235b-a22b-thinking-2507:free" },
            { name: "OpenAI GPT-OSS 120B (Free)", id: "openai/gpt-oss-120b:free" },
            { name: "GLM 4.5 Air (Free)", id: "z-ai/glm-4.5-air:free" },
        
            // --- FAST & EFFICIENT MODELS ---
            { name: "Llama 3.3 70B (Free)", id: "meta-llama/llama-3.3-70b-instruct:free" },
            { name: "Step 3.5 Flash (Free)", id: "stepfun/step-3-5-flash:free" },
            { name: "Aurora Alpha (Reasoning)", id: "openrouter/aurora-alpha:free" },
        
            // --- LARGE SCALE / FRONTIER ---
            { name: "Arcee Trinity Large (Free)", id: "arcee-ai/trinity-large-preview:free" },
            { name: "Qwen3 Coder 480B (Free)", id: "qwen/qwen3-coder-480b-a35b:free" },
        
            // --- SPECIALIZED / NANO ---
            { name: "NVIDIA Nemotron 30B (Free)", id: "nvidia/nemotron-3-nano-30b-a3b:free" },
            { name: "OpenAI GPT-OSS 20B (Free)", id: "openai/gpt-oss-20b:free" },
            { name: "Solar Pro 3 (Free)", id: "upstage/solar-pro-3:free" },
            { name: "Trinity Mini (Free)", id: "arcee-ai/trinity-mini:free" }
        ]
    };

    // --- UI FUNCTIONS ---

    // Toggle settings drawer
    toggleSettings.onclick = () => {
        settingsPanel.style.display = settingsPanel.style.display === 'block' ? 'none' : 'block';
    };

    // Toggle Reasoning Visibility
    toggleRaw.onclick = () => {
        const isHidden = rawContainer.style.display === 'none';
        rawContainer.style.display = isHidden ? 'block' : 'none';
        toggleRaw.innerText = isHidden ? "HIDE REASONING" : "SHOW REASONING";
    };

    // Function to populate model dropdown based on provider
    const updateModelDropdown = (provider, selectedModelId = null) => {
        modelSelect.innerHTML = modelOptions[provider]
            .map(m => `<option value="${m.id}" ${m.id === selectedModelId ? 'selected' : ''}>${m.name}</option>`)
            .join('');
    };

    // Update models when provider changes
    providerSelect.onchange = () => {
        updateModelDropdown(providerSelect.value);
    };

    // --- STORAGE & INITIALIZATION ---

    // Load saved settings
    chrome.storage.sync.get(['apiKey', 'provider', 'selectedModel'], (data) => {
        if (data.apiKey) apiKeyInput.value = data.apiKey;
        if (data.provider) {
            providerSelect.value = data.provider;
            updateModelDropdown(data.provider, data.selectedModel);
        } else {
            updateModelDropdown('google'); // Default
        }
    });

    // Save settings
    saveSettings.onclick = () => {
        const config = {
            apiKey: apiKeyInput.value,
            provider: providerSelect.value,
            selectedModel: modelSelect.value
        };
        chrome.storage.sync.set(config, () => {
            settingsPanel.style.display = 'none';
            alert("Settings Saved!");
        });
    };

    // Initial scan of the page
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, { action: 'extractAll' }, (data) => {
            if (data?.text) previewBox.innerText = data.text;
        });
    }

    // --- CORE SOLVER LOGIC ---

    solveBtn.onclick = async () => {
        chrome.storage.sync.get(['apiKey', 'provider', 'selectedModel'], async (config) => {
            if (!config.apiKey) return alert("Please set your API Key in Settings!");

            // UI Feedback
            solveBtn.disabled = true;
            solveBtn.innerText = "THINKING...";
            resultContainer.style.display = 'block';
            aiRes.innerText = "Processing...";
            rawContainer.style.display = 'none';
            toggleRaw.innerText = "SHOW REASONING";

            const prompt = `You are a math tutor. Solve this problem step-by-step. Put ONLY the final result inside \\boxed{}. Problem: ${previewBox.innerText}`;
            
            let url, options;

            // Prepare request based on provider
            if (config.provider === 'openrouter') {
                url = "https://openrouter.ai/api/v1/chat/completions";
                options = {
                    method: 'POST',
                    headers: {
                        "Authorization": `Bearer ${config.apiKey}`,
                        "Content-Type": "application/json",
                        "X-Title": "SparxLess AI"
                    },
                    body: JSON.stringify({
                        model: config.selectedModel,
                        messages: [{ role: "user", content: prompt }]
                    })
                };
            } else {
                url = `https://generativelanguage.googleapis.com/v1beta/models/${config.selectedModel}:generateContent?key=${config.apiKey}`;
                options = {
                    method: 'POST',
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }]
                    })
                };
            }

            try {
                const response = await fetch(url, options);
                const json = await response.json();

                if (json.error) throw new Error(json.error.message || "API Error");

                // Extract response based on API format
                let rawText = "";
                if (config.provider === 'openrouter') {
                    rawText = json.choices[0].message.content;
                } else {
                    rawText = json.candidates[0].content.parts[0].text;
                }

                const cleanAnswer = extractAnswer(rawText);
                aiRes.innerHTML = `<strong>${cleanAnswer}</strong>`;
                rawContainer.innerText = rawText;

                // Send auto-fill command to content script
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

// Helper to find the \boxed{} answer or fallback to the last line
function extractAnswer(text) {
    const boxedMatch = text.match(/\\boxed\{((?:[^{}]|\{[^{}]*\})*)\}/);
    if (boxedMatch) return boxedMatch[1];
    
    const lines = text.trim().split('\n');
    return lines[lines.length - 1].replace(/Answer:/i, '').trim();
}
document.addEventListener('DOMContentLoaded', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
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

    // UI Controls
    toggleSettings.onclick = () => {
        settingsPanel.style.display = settingsPanel.style.display === 'block' ? 'none' : 'block';
    };

    toggleRaw.onclick = () => {
        const isHidden = rawContainer.style.display === 'none';
        rawContainer.style.display = isHidden ? 'block' : 'none';
        toggleRaw.innerText = isHidden ? "HIDE REASONING" : "SHOW REASONING";
    };

    // Load saved data
    chrome.storage.sync.get(['apiKey', 'selectedModel'], (data) => {
        if (data.apiKey) document.getElementById('api-key-input').value = data.apiKey;
        if (data.selectedModel) document.getElementById('model-select').value = data.selectedModel;
    });

    // Save data
    saveSettings.onclick = () => {
        const key = document.getElementById('api-key-input').value;
        const model = document.getElementById('model-select').value;
        chrome.storage.sync.set({ apiKey: key, selectedModel: model }, () => {
            settingsPanel.style.display = 'none';
        });
    };

    // Initial Scan
    chrome.tabs.sendMessage(tab.id, { action: 'extractAll' }, (data) => {
        if (data) previewBox.innerText = data.text || "No question detected.";
    });

    // Solve Button
    solveBtn.onclick = async () => {
        chrome.storage.sync.get(['apiKey', 'selectedModel'], async (config) => {
            if (!config.apiKey) return alert("Please set your API Key in Settings!");

            solveBtn.disabled = true;
            solveBtn.innerText = "THINKING...";
            resultContainer.style.display = 'block';
            aiRes.innerText = "Processing...";

            try {
                const prompt = `Solve this math problem step-by-step. Wrap ONLY the final answer in \\boxed{}. Problem: ${previewBox.innerText}`;
                
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${config.selectedModel}:generateContent?key=${config.apiKey}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: { temperature: 0.1, maxOutputTokens: 1024 }
                    })
                });

                const json = await response.json();
                if (json.error) throw new Error(json.error.message);

                const rawText = json.candidates[0].content.parts[0].text;
                const cleanAnswer = extractAnswer(rawText);

                aiRes.innerHTML = `<strong>${cleanAnswer}</strong>`;
                rawContainer.innerText = rawText;
                
                chrome.tabs.sendMessage(tab.id, { action: 'autoSolve', answer: cleanAnswer });

            } catch (err) {
                aiRes.innerText = "Error: " + err.message;
            } finally {
                solveBtn.disabled = false;
                solveBtn.innerText = "SOLVE PROBLEM";
            }
        });
    };
});

function extractAnswer(text) {
    const match = text.match(/\\boxed\{((?:[^{}]|\{[^{}]*\})*)\}/);
    return match ? match[1] : text.trim().split('\n').pop();
}
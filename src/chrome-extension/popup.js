document.getElementById('study-btn').addEventListener('click', () => {
	chrome.tabs.create({ url: chrome.runtime.getURL('study.html') });
});

document.getElementById('wordlist-btn').addEventListener('click', () => {
	chrome.tabs.create({ url: chrome.runtime.getURL('wordlist.html') });
});

const btn = document.getElementById('send');
const wordsEl = document.getElementById('words');
const statusEl = document.getElementById('status');

function setStatus(msg, type = '') {
	statusEl.textContent = msg;
	statusEl.className = type;
}

btn.addEventListener('click', async () => {
	const raw = wordsEl.value.trim();
	if (!raw) return setStatus('Please enter at least one word.', 'err');

	const words = [...new Set(raw
		.split(/[\s,;.!?()[\]"]+/)
		.map(w => w.replace(/[^a-zA-Z'-]/g, '').toLowerCase())
		.filter(w => w.length > 1))];
	if (words.length === 0) return setStatus('No valid words found.', 'err');

	const { serverUrl, apiToken } = await chrome.storage.sync.get(['serverUrl', 'apiToken']);
	if (!serverUrl || !apiToken) {
		return setStatus('Set up server URL and token in options first.', 'err');
	}

	btn.disabled = true;
	setStatus('Adding...');

	try {
		const res = await fetch(`${serverUrl}/api/feed`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ token: apiToken, words }),
		});
		const data = await res.json();
		if (data.ok) {
			setStatus(`Added ${words.length} word(s).`, 'ok');
			wordsEl.value = '';
		}
		else {
			setStatus(data.error || 'Something went wrong.', 'err');
		}
	}
	catch {
		setStatus('Could not reach bot. Is it running?', 'err');
	}

	btn.disabled = false;
});

// ── Dictionary lookup ──────────────────────────────────────────────────────

const dictInput = document.getElementById('dict-input');
const dictResult = document.getElementById('dict-result');

function esc(s) {
	return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function showResult(html) {
	dictResult.style.display = 'block';
	dictResult.innerHTML = html;
}

dictInput.addEventListener('keydown', (e) => {
	if (e.key === 'Enter') {
		const word = dictInput.value.trim();
		if (word) doLookup(word);
	}
});

dictInput.addEventListener('input', () => {
	if (!dictInput.value.trim()) dictResult.style.display = 'none';
});

async function doLookup(word) {
	const { serverUrl, apiToken } = await chrome.storage.sync.get(['serverUrl', 'apiToken']);
	if (!serverUrl || !apiToken) {
		showResult('<div class="result-err">Set up server URL and token in options first.</div>');
		return;
	}

	showResult('<div class="result-loading">Looking up…</div>');

	try {
		const res = await fetch(
			`${serverUrl}/api/enrich?token=${encodeURIComponent(apiToken)}&word=${encodeURIComponent(word)}`,
		);
		const data = await res.json();
		if (!data.ok) throw new Error(data.error || 'Lookup failed');

		const zhPart = data.zh ? `<span class="zh">${esc(data.zh)}</span> – ` : '';
		const defPart = esc(data.definition || 'No definition found.');
		const exPart = data.example
			? `<div class="result-ex-label">Example</div><div class="result-ex">${esc(data.example)}</div>`
			: '';

		showResult(`
      <div class="result-card">
        <div class="result-word-row">
          <span class="result-word">${esc(data.word || word)}</span>
          <button class="result-speak" title="Hear pronunciation">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
              <path d="M4 9.5v5h3.2L12 18.5V5.5L7.2 9.5H4Z" fill="#fff"/>
              <path d="M15.2 9.2c.9.8 1.4 1.8 1.4 2.8s-.5 2-1.4 2.8" stroke="#fff" stroke-width="1.7" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
        <div class="result-def">${zhPart}${defPart}</div>
        ${exPart}
      </div>`);

		const audioUrl = data.audio || '';
		const speakWord = data.word || word;
		dictResult.querySelector('.result-speak').addEventListener('click', () => {
			if (audioUrl) { new Audio(audioUrl).play().catch(() => {}); return; }
			speechSynthesis.cancel();
			const u = new SpeechSynthesisUtterance(speakWord);
			u.lang = 'en-US'; u.rate = 0.9;
			speechSynthesis.speak(u);
		});
	}
	catch (err) {
		showResult(`<div class="result-err">${esc(err.message || 'Could not reach server.')}</div>`);
	}
}

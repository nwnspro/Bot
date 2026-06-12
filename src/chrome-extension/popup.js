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

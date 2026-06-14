let serverUrl = '';
let apiToken = '';
let words = [];

function esc(s) {
	return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderGrid() {
	if (words.length === 0) {
		document.getElementById('content').innerHTML = `
      <div class="state-card">
        <div class="state-title">No words yet</div>
        <div class="state-sub">Select text on any page to add words.</div>
      </div>`;
		return;
	}

	const items = words.map(w => `
    <div class="word-item" data-word="${esc(w.word)}">
      <span>${esc(w.word)}</span>
      <button class="del-btn" title="Remove">&#x2715;</button>
    </div>`).join('');

	document.getElementById('content').innerHTML = `<div class="panel"><div class="word-grid">${items}</div></div>`;

	document.querySelectorAll('.del-btn').forEach(btn => {
		btn.addEventListener('click', async (e) => {
			e.stopPropagation();
			const item = btn.closest('.word-item');
			const word = item.dataset.word;
			item.style.opacity = '0.4';
			item.style.pointerEvents = 'none';
			try {
				await fetch(`${serverUrl}/api/delete-word`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ token: apiToken, word }),
				});
			} catch (err) {
				console.error('[wordlist] delete error:', err);
			}
			words = words.filter(w => w.word !== word);
			renderGrid();
		});
	});
}

async function init() {
	const store = await chrome.storage.sync.get(['serverUrl', 'apiToken']);
	serverUrl = store.serverUrl || '';
	apiToken = store.apiToken || '';

	if (!serverUrl || !apiToken) {
		document.getElementById('content').innerHTML = `
      <div class="state-card">
        <div class="state-title">Not configured</div>
        <div class="state-sub">Set up your server URL and token in extension options first.</div>
      </div>`;
		return;
	}

	try {
		const res = await fetch(`${serverUrl}/api/words/list?token=${encodeURIComponent(apiToken)}`);
		const data = await res.json();
		if (!data.ok) throw new Error(data.error || 'Failed to load words');
		words = (data.words || []).sort((a, b) => a.word.localeCompare(b.word));
		renderGrid();
	} catch (err) {
		document.getElementById('content').innerHTML = `
      <div class="state-card">
        <div class="state-title">Couldn't load words</div>
        <div class="err-text">${esc(err.message || 'Could not reach server.')}</div>
      </div>`;
	}
}

document.getElementById('back-btn').addEventListener('click', () => window.close());

init();

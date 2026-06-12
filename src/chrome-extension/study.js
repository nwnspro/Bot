let words = [];
let index = 0;
let serverUrl = '';
let apiToken = '';

function esc(s) {
	return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function emph(sentence, word) {
	if (!sentence || !word) return esc(sentence || '');
	const safe = esc(sentence);
	const re = new RegExp(`(${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig');
	return safe.replace(re, '<span class="hl">$1</span>');
}

function speak(text) {
	speechSynthesis.cancel();
	const u = new SpeechSynthesisUtterance(text);
	u.lang = 'en-US'; u.rate = 0.9;
	speechSynthesis.speak(u);
}

function speakZh(text) {
	speechSynthesis.cancel();
	const u = new SpeechSynthesisUtterance(text);
	u.lang = 'zh-CN';
	speechSynthesis.speak(u);
}

function updateCount() {
	const remaining = words.length - index;
	document.getElementById('count-label').textContent =
		remaining > 0 ? `${remaining} to review` : 'Review';
}

function renderWord(w) {
	const exText = w.examples?.[0] || w.example || '';
	const zhText = w.zh || '';
	const phonetic = w.phonetic || w.pronunciation || '';
	const pos = w.pos || w.partOfSpeech || '';

	return `
    <div class="card">
      <div class="word-section">
        <button class="play-btn" id="speak-en" title="Hear word">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M5 3.5L12 8L5 12.5V3.5Z" fill="#4a6741"/>
          </svg>
        </button>
        <div class="word-meta">
          <div class="word-row">
            <span class="word-text">${esc(w.word)}</span>
            ${pos ? `<span class="pos-text">${esc(pos)}</span>` : ''}
          </div>
          ${phonetic ? `<div class="phonetic">${esc(phonetic)}</div>` : ''}
        </div>
      </div>

      <div class="tinted">
        ${zhText ? `
        <div class="zh-row">
          <button class="play-btn-sm" id="speak-zh" title="Hear in Chinese">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <path d="M5 3.5L12 8L5 12.5V3.5Z" fill="#4a6741"/>
            </svg>
          </button>
          <span class="zh-text">${esc(zhText)}</span>
        </div>
        <hr>
        ` : ''}
        <div class="ex-label">Example</div>
        <div class="ex-text">${emph(exText, w.word)}</div>
      </div>
    </div>

    <div class="actions">
      <button class="btn btn-know" id="btn-know">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M5 12.5l4 4 10-10" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        I know it
      </button>
      <button class="btn btn-keep" id="btn-keep">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M4 12a8 8 0 1 1 .4 2.5" stroke="#3d5c38" stroke-width="2" stroke-linecap="round"/>
          <path d="M4 7v5h5" stroke="#3d5c38" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        Keep
      </button>
    </div>`;
}

function renderDone() {
	return `
    <div class="state-card">
      <div class="done-icon">🎉</div>
      <div class="state-title">All done!</div>
      <div class="state-sub">You've reviewed all your words.<br>Come back later to keep practising.</div>
    </div>`;
}

function renderError(msg) {
	return `
    <div class="state-card">
      <div class="state-title">Couldn't load words</div>
      <div class="err-text">${esc(msg)}</div>
    </div>`;
}

function show() {
	const el = document.getElementById('content');
	updateCount();

	if (index >= words.length) {
		el.innerHTML = renderDone();
		return;
	}

	el.innerHTML = renderWord(words[index]);

	const w = words[index];

	document.getElementById('speak-en').addEventListener('click', () => speak(w.word));
	document.getElementById('speak-zh')?.addEventListener('click', () => speakZh(w.zh));

	document.getElementById('btn-know').addEventListener('click', async () => {
		// Mark known on server (fire and forget)
		markStatus(w.word, 'known');
		index++;
		show();
	});

	document.getElementById('btn-keep').addEventListener('click', () => {
		index++;
		show();
	});

	// Auto-play
	setTimeout(() => speak(w.word), 150);
}

async function markStatus(word, status) {
	try {
		await fetch(`${serverUrl}/api/word-status`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ token: apiToken, word, status }),
		});
	}
	catch (err) {
		console.error('[study] markStatus error:', err);
	}
}

async function init() {
	const store = await chrome.storage.sync.get(['serverUrl', 'apiToken']);
	serverUrl = store.serverUrl || '';
	apiToken = store.apiToken || '';

	if (!serverUrl || !apiToken) {
		document.getElementById('content').innerHTML = renderError(
			'Set up your server URL and token in extension options first.',
		);
		return;
	}

	try {
		const res = await fetch(`${serverUrl}/api/words?token=${encodeURIComponent(apiToken)}`);
		const data = await res.json();
		if (!data.ok) throw new Error(data.error || 'Failed to load words');
		words = data.words || [];

		if (words.length === 0) {
			document.getElementById('content').innerHTML = `
        <div class="state-card">
          <div class="done-icon">📚</div>
          <div class="state-title">No words to review</div>
          <div class="state-sub">Add words by selecting text on any page,<br>or use /learn in Discord.</div>
        </div>`;
			return;
		}

		// Shuffle
		words = words.sort(() => Math.random() - 0.5);
		show();
	}
	catch (err) {
		document.getElementById('content').innerHTML = renderError(
			err.message || 'Could not reach bot. Is it running?',
		);
	}
}

document.getElementById('wordlist-btn').addEventListener('click', () => {
	chrome.tabs.create({ url: chrome.runtime.getURL('wordlist.html') });
});

init();

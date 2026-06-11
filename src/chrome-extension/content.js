(() => {
	// ── Utilities ─────────────────────────────────────────────────────────────
	function hexA(hex, a) {
		const r = parseInt(hex.slice(1, 3), 16);
		const g = parseInt(hex.slice(3, 5), 16);
		const b = parseInt(hex.slice(5, 7), 16);
		return `rgba(${r},${g},${b},${a})`;
	}

	function esc(str) {
		return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	}

	function escAttr(str) {
		return esc(str).replace(/"/g, '&quot;');
	}

	function emph(sentence, word) {
		const safe = esc(sentence);
		const re = new RegExp(`(${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig');
		return safe.replace(re, '<em class="hl">$1</em>');
	}

	async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 10000) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);

		try {
			const res = await fetch(url, {
				...options,
				signal: controller.signal,
			});
			return await res.json();
		}
		finally {
			clearTimeout(timer);
		}
	}

	function hasExtensionContext() {
		try {
			return Boolean(chrome?.runtime?.id && chrome?.storage?.sync);
		}
		catch {
			return false;
		}
	}

	function isContextInvalidatedError(err) {
		return /extension context invalidated/i.test(err?.message || '');
	}

	// ── Shadow hosts ──────────────────────────────────────────────────────────
	let iconShadow = null, cardShadow = null;
	let hideTimer = null, lastWord = '', lastRect = null;
	let lastAudio = '';
	let cardPinned = false;
	let reviewWords = [];
	let reviewIndex = 0;

	function teardownStaleExtensionUi() {
		if (hideTimer) clearTimeout(hideTimer);
		document.getElementById('__ele-icon__')?.remove();
		document.getElementById('__ele-card__')?.remove();
		iconShadow = null;
		cardShadow = null;
		cardPinned = false;
	}

	const ACCENT = '#6f8b61';
	// Flip to true for dark mode.
	const DARK = false;
	const BG = DARK ? '#26231f' : '#fffdfb';
	const INK = DARK ? '#efeae4' : '#36302b';
	const SUB = DARK ? '#a89f97' : '#8a8077';
	const HAIR = DARK ? 'rgba(255,255,255,.08)' : 'rgba(78,68,60,.09)';

	function makeHost(id) {
		document.getElementById(id)?.remove();
		const host = document.createElement('div');
		host.id = id;
		host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;display:none;pointer-events:none;';
		document.documentElement.appendChild(host);
		return host.attachShadow({ mode: 'open' });
	}

	// ── Floating trigger icon ─────────────────────────────────────────────────
	function ensureIcon() {
		if (iconShadow) return;
		iconShadow = makeHost('__ele-icon__');
		iconShadow.innerHTML = `
      <style>
        #btn {
          min-width:36px;height:42px;background:transparent!important;
          display:flex;align-items:center;justify-content:center;
          cursor:pointer;pointer-events:all;
          border:0!important;border-radius:0!important;
          box-shadow:none!important;
          font-size:30px;line-height:1;
          filter:drop-shadow(0 8px 14px rgba(0,0,0,.18));
          transition:transform .12s,border-color .12s;
        }
        #btn:hover{transform:scale(1.12);border-color:${hexA(ACCENT, 0.75)};}
      </style>
      <div id="btn" title="Look up in Elephant" aria-label="Look up in Elephant">🐘</div>`;
		iconShadow.getElementById('btn').addEventListener('pointerdown', e => {
			e.preventDefault(); e.stopPropagation();
		});
		iconShadow.getElementById('btn').addEventListener('click', e => {
			e.preventDefault(); e.stopPropagation();
			openCard(lastWord, lastRect).catch(err => {
				if (isContextInvalidatedError(err)) teardownStaleExtensionUi();
			});
		});
	}

	function showIcon(rect) {
		ensureIcon();
		const h = iconShadow.host;
		h.style.left = `${rect.left + rect.width / 2 - 18}px`;
		h.style.top = `${rect.top - 42 < 6 ? rect.bottom + 6 : rect.top - 42}px`;
		h.style.display = 'block';
	}
	function hideIcon() { if (iconShadow) iconShadow.host.style.display = 'none'; }

	// ── Card CSS ──────────────────────────────────────────────────────────────
	const CARD_CSS = `
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
    :host{all:initial;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;}

    #wrap{position:relative;width:344px;}

    /* caret */
    #caret{display:none;}

    /* card shell */
    #card{
      position:relative;
      background:${BG};border-radius:18px;
      border:1px solid ${HAIR};
      box-shadow:0 24px 50px ${hexA('#433526', 0.16)},0 2px 8px ${hexA('#433526', 0.06)};
      overflow:hidden;z-index:2;
    }

    /* body */
    #body{padding:16px 18px 18px;}
    #close-btn{
      position:absolute;top:10px;right:10px;
      width:26px;height:26px;border-radius:8px;display:grid;place-items:center;
      background:rgba(78,68,60,.05);cursor:pointer;pointer-events:all;border:none;
      z-index:3;
    }
    #close-btn:hover{background:rgba(78,68,60,.12);}

    /* headword row */
    #hw-row{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;}
    #hw{font-size:30px;font-weight:700;color:${INK};letter-spacing:-.01em;line-height:1;}
    #pos{
      font-size:12.5px;font-style:italic;color:${SUB};
      padding:3px 9px;border-radius:999px;
      background:rgba(78,68,60,.05);
    }

    /* phonetic row */
    #pron-row{display:flex;align-items:center;gap:10px;margin-top:11px;}
    #speak-btn{
      width:34px;height:34px;border-radius:50%;border:none;cursor:pointer;
      display:grid;place-items:center;flex:0 0 auto;pointer-events:all;
      background:${ACCENT};box-shadow:0 4px 10px ${hexA(ACCENT, 0.4)};
      transition:transform .1s;
    }
    #speak-btn:hover{transform:scale(1.08);}
    @keyframes speakPulse{
      0%,100%{box-shadow:0 4px 10px ${hexA(ACCENT, 0.4)};}
      50%{box-shadow:0 4px 18px ${hexA(ACCENT, 0.7)},0 0 0 6px ${hexA(ACCENT, 0.15)};}
    }
    #speak-btn.pulse{animation:speakPulse 1.4s ease-in-out 2;}
    #phonetic{font-size:16px;color:${SUB};}
    /* zh translation box */
    #zh-box{
      margin-top:16px;padding:13px 15px;border-radius:13px;
      background:${hexA(ACCENT, 0.07)};border:1px solid ${hexA(ACCENT, 0.14)};
    }
    #zh-text{
      font-size:23px;font-weight:600;color:${INK};
      font-family:'PingFang SC','Noto Sans SC','Microsoft YaHei',sans-serif;
      line-height:1.35;
    }

    /* sections */
    .sec{margin-top:16px;}
    .sec-label{
      font-size:11px;letter-spacing:.09em;text-transform:uppercase;
      font-weight:600;margin-bottom:6px;color:${ACCENT};
    }
    #def-text{font-size:14.5px;line-height:1.55;color:${INK};}
    #ex-text{
      font-size:14.5px;line-height:1.55;color:${SUB};font-style:italic;
      padding-left:12px;border-left:2.5px solid ${hexA(ACCENT, 0.4)};
    }
    em.hl{color:${ACCENT};font-style:normal;font-weight:600;}

    /* chips */
    .chips{display:flex;flex-wrap:wrap;gap:7px;}
    .chip{
      display:inline-block;padding:5px 11px;border-radius:999px;
      font-size:13.5px;line-height:1;white-space:nowrap;
      color:#5b534d;background:rgba(78,68,60,.06);
      border:1px solid rgba(78,68,60,.10);
      cursor:pointer;pointer-events:all;font:inherit;
    }
    .chip:hover{color:${ACCENT};background:${hexA(ACCENT, 0.08)};}
    .chip.ant{color:${ACCENT};background:${hexA(ACCENT, 0.10)};}

    .bottom-actions{
      margin-top:18px;padding-top:14px;border-top:1px solid ${HAIR};
      display:flex;gap:10px;
    }
    .plain-action{
      width:100%;border:1px solid ${hexA(ACCENT, 0.26)};
      border-radius:12px;background:#fff;color:${ACCENT};
      padding:10px 12px;font-size:13px;font-weight:700;
      cursor:pointer;pointer-events:all;
    }
    .plain-action:hover{background:${hexA(ACCENT, 0.07)};}

    #review-content{display:none;padding:18px;}
    .review-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;}
    .review-brand{display:flex;align-items:center;gap:10px;font-size:17px;font-weight:800;color:${ACCENT};}
    .review-logo{font-size:24px;line-height:1;border-bottom:3px solid ${ACCENT};}
    .review-count{font-size:13px;font-weight:700;color:${ACCENT};}
    .review-card{border:1px solid ${HAIR};border-radius:16px;padding:18px;background:#fff;}
    .review-word-row{display:flex;align-items:flex-start;gap:12px;}
    .review-word{font-size:30px;font-weight:800;line-height:1;color:${INK};}
    .review-pos{font-size:14px;font-style:italic;color:${SUB};margin-top:7px;}
    .review-phonetic{font-size:14px;color:${SUB};margin-top:8px;}
    .review-zh{margin-top:16px;padding:12px 14px;border-radius:12px;background:${hexA(ACCENT, 0.07)};font-size:24px;font-weight:800;color:${INK};}
    .review-example-label{margin-top:16px;font-size:11px;letter-spacing:.09em;text-transform:uppercase;font-weight:800;color:${ACCENT};}
    .review-example{margin-top:6px;color:${SUB};font-size:14px;line-height:1.5;font-style:italic;}
    .review-actions{display:flex;gap:10px;margin-top:14px;}
    .review-btn{flex:1;border-radius:13px;border:1px solid ${hexA(ACCENT, 0.28)};padding:12px;font-size:14px;font-weight:800;cursor:pointer;pointer-events:all;}
    .review-known{background:${ACCENT};color:#fff;border-color:${ACCENT};}
    .review-keep{background:#fff;color:${ACCENT};}

    /* loading */
    #loading{
      padding:22px 18px;display:flex;align-items:center;gap:12px;
      font-size:13px;color:${SUB};
    }
    @keyframes spin{to{transform:rotate(360deg);}}
    .spinner{
      width:18px;height:18px;border:2px solid rgba(78,68,60,.15);
      border-top-color:${ACCENT};border-radius:50%;
      animation:spin .7s linear infinite;flex-shrink:0;
    }
    #err-msg{padding:16px 18px;font-size:13px;color:#c0392b;}
  `;

	// ── Card HTML template ────────────────────────────────────────────────────
	const CARD_HTML = `
    <div id="wrap">
      <div id="caret"></div>
      <div id="card">

        <button id="close-btn" title="Close">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M6 6l12 12M18 6L6 18" stroke="${SUB}" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </button>

        <div id="loading"><div class="spinner"></div> Looking up…</div>
        <div id="err-msg" style="display:none"></div>

        <div id="content" style="display:none">
          <div id="body">
            <div id="hw-row">
              <span id="hw"></span>
              <span id="pos"></span>
            </div>

            <div id="pron-row">
              <button id="speak-btn" title="Hear pronunciation">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
                  <path d="M4 9.5v5h3.2L12 18.5V5.5L7.2 9.5H4Z" fill="#fff"/>
                  <path d="M15.2 9.2c.9.8 1.4 1.8 1.4 2.8s-.5 2-1.4 2.8"
                        stroke="#fff" stroke-width="1.7" stroke-linecap="round"/>
                  <path d="M17.6 6.6c1.7 1.4 2.6 3.3 2.6 5.4s-.9 4-2.6 5.4"
                        stroke="#fff" stroke-width="1.7" stroke-linecap="round"/>
                </svg>
              </button>
              <span id="phonetic"></span>
            </div>

            <div id="zh-box"><div id="zh-text"></div></div>

            <div class="sec" id="def-sec">
              <div class="sec-label">Definition</div>
              <div id="def-text"></div>
            </div>

            <div class="sec" id="ex-sec">
              <div class="sec-label">Example</div>
              <div id="ex-text"></div>
            </div>

            <div class="sec" id="syn-sec">
              <div class="sec-label">Similar</div>
              <div class="chips" id="syn-chips"></div>
            </div>

            <div class="sec" id="ant-sec">
              <div class="sec-label">Opposite</div>
              <div class="chips" id="ant-chips"></div>
            </div>

            <div class="bottom-actions">
              <button id="review-open-btn" class="plain-action" type="button">Review wordlist</button>
            </div>
          </div>
        </div>

        <div id="review-content"></div>

      </div>
    </div>`;

	// ── Build card shadow DOM ─────────────────────────────────────────────────
	function ensureCard() {
		if (cardShadow) return;
		cardShadow = makeHost('__ele-card__');
		cardShadow.innerHTML = `<style>${CARD_CSS}</style>${CARD_HTML}`;
		cardShadow.host.style.pointerEvents = 'all';

		const $ = id => cardShadow.getElementById(id);

		$('close-btn').addEventListener('click', hideAll);
		$('speak-btn').addEventListener('click', () => speakWord(lastWord));
		$('review-open-btn').addEventListener('click', () => {
			openReviewPanel().catch(err => {
				if (isContextInvalidatedError(err)) teardownStaleExtensionUi();
			});
		});
		$('content').addEventListener('click', e => {
			if (!(e.target instanceof Element)) return;
			const chip = e.target.closest('[data-lookup-word]');
			if (!chip) return;
			e.preventDefault();
			e.stopPropagation();
			openCard(chip.dataset.lookupWord, lastRect).catch(err => {
				if (isContextInvalidatedError(err)) teardownStaleExtensionUi();
			});
		});
	}

	async function getSettings() {
		if (!hasExtensionContext()) {
			teardownStaleExtensionUi();
			throw new Error('Extension context invalidated. Reload this page after reloading Elephant.');
		}
		return chrome.storage.sync.get(['serverUrl', 'apiToken']);
	}

	function speakWord(word) {
		if (lastAudio) {
			new Audio(lastAudio).play().catch(() => {
				// Fall back silently if the browser blocks audio playback.
			});
			return;
		}
		if (!word) return;
		speechSynthesis.cancel();
		const u = new SpeechSynthesisUtterance(word);
		u.lang = 'en-US'; u.rate = 0.9;
		speechSynthesis.speak(u);
	}

	// ── Open card ─────────────────────────────────────────────────────────────
	async function openCard(word, rect) {
		if (!word || !rect) return;
		const lookupWord = word.trim();
		lastWord = lookupWord;
		lastRect = rect;
		ensureCard();
		cardPinned = true;
		hideIcon();

		const $ = id => cardShadow.getElementById(id);

		// Reset
		$('loading').style.display = 'flex';
		$('err-msg').style.display = 'none';
		$('content').style.display = 'none';
		$('review-content').style.display = 'none';
		$('speak-btn').classList.remove('pulse');
		lastAudio = '';

		positionCard();
		cardShadow.host.style.display = 'block';

		// Fetch + save in one call (enrich endpoint handles saving)
		let data;
		try {
			const { serverUrl, apiToken } = await getSettings();
			if (!serverUrl || !apiToken) {
				$('loading').style.display = 'none';
				$('err-msg').style.display = 'block';
				$('err-msg').textContent = 'Open extension options and add your server URL and token.';
				return;
			}

			data = await fetchJsonWithTimeout(`${serverUrl}/api/enrich?token=${encodeURIComponent(apiToken)}&word=${encodeURIComponent(lookupWord)}`);
			if (!data.ok) throw new Error(data.error || 'Lookup failed');
		}
		catch (err) {
			if (isContextInvalidatedError(err)) {
				teardownStaleExtensionUi();
				return;
			}
			$('loading').style.display = 'none';
			$('err-msg').style.display = 'block';
			$('err-msg').textContent = err.name === 'AbortError'
				? 'Lookup took too long. Try again.'
				: err.message || 'Could not reach bot. Is it running?';
			return;
		}

		// Populate
		$('hw').textContent = data.word || lookupWord;
		$('pos').textContent = data.pos || '';
		$('phonetic').textContent = data.phonetic || '';
		lastAudio = data.audio || '';
		$('zh-text').textContent = data.zh || '';
		$('zh-box').style.display = data.zh ? '' : 'none';
		$('def-text').textContent = data.definition || '';
		$('def-sec').style.display = data.definition ? '' : 'none';
		$('ex-text').innerHTML = emph(data.example || '', data.word || lookupWord, ACCENT);
		$('ex-sec').style.display = data.example ? '' : 'none';

		const syns = data.synonyms || [];
		$('syn-chips').innerHTML = syns
			.map(s => `<button class="chip" type="button" data-lookup-word="${escAttr(s)}">${esc(s)}</button>`)
			.join('');
		$('syn-sec').style.display = syns.length ? '' : 'none';

		const ants = data.antonyms || [];
		$('ant-chips').innerHTML = ants
			.map(s => `<button class="chip ant" type="button" data-lookup-word="${escAttr(s)}">${esc(s)}</button>`)
			.join('');
		$('ant-sec').style.display = ants.length ? '' : 'none';

		$('loading').style.display = 'none';
		$('content').style.display = 'block';

		// Re-position now we know the real height
		positionCard();

		// Auto-play + pulse
		setTimeout(() => {
			if (!cardShadow) return;
			speakWord(data.word || lookupWord);
			$('speak-btn')?.classList.add('pulse');
		}, 120);
	}

	async function markReviewStatus(word, status) {
		let settings;
		try {
			settings = await getSettings();
		}
		catch (err) {
			if (isContextInvalidatedError(err)) teardownStaleExtensionUi();
			return;
		}

		const { serverUrl, apiToken } = settings;
		if (!serverUrl || !apiToken) return;

		try {
			await fetch(`${serverUrl}/api/word-status`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ token: apiToken, word, status }),
			});
		}
		catch {
			// Network hiccups should not block the lightweight review UI.
		}
	}

	function renderReview() {
		const reviewEl = cardShadow.getElementById('review-content');
		const remaining = reviewWords.length - reviewIndex;

		if (remaining <= 0) {
			reviewEl.innerHTML = `
				<div class="review-head">
					<div class="review-brand">Review mode</div>
				</div>
				<div class="review-card">
					<div class="review-word">All done</div>
					<div class="review-example">You reviewed every word in this session.</div>
				</div>`;
			positionCard();
			return;
		}

		const word = reviewWords[reviewIndex];
		const example = word.examples?.[0] || word.example || '';
		const zh = word.zh || '';
		const phonetic = word.phonetic || word.pronunciation || '';
		const pos = word.pos || word.partOfSpeech || '';
		lastAudio = word.audio || '';

		reviewEl.innerHTML = `
			<div class="review-head">
				<div class="review-brand">Review mode</div>
				<div class="review-count">${remaining} to review</div>
			</div>
			<div class="review-card">
				<div class="review-word-row">
					<button class="play-btn" id="review-speak" title="Hear word">
						<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
							<path d="M5 3.5L12 8L5 12.5V3.5Z" fill="${ACCENT}"/>
						</svg>
					</button>
					<div>
						<div><span class="review-word">${esc(word.word)}</span>${pos ? `<span class="review-pos"> ${esc(pos)}</span>` : ''}</div>
						${phonetic ? `<div class="review-phonetic">${esc(phonetic)}</div>` : ''}
					</div>
				</div>
				${zh ? `<div class="review-zh">${esc(zh)}</div>` : ''}
				${example ? `<div class="review-example-label">Example</div><div class="review-example">${emph(example, word.word)}</div>` : ''}
			</div>
			<div class="review-actions">
				<button class="review-btn review-known" id="review-known">I know it</button>
				<button class="review-btn review-keep" id="review-keep">Keep</button>
			</div>`;

		cardShadow.getElementById('review-speak')?.addEventListener('click', () => speakWord(word.word));
		cardShadow.getElementById('review-known').addEventListener('click', async () => {
			await markReviewStatus(word.word, 'known');
			reviewIndex++;
			renderReview();
		});
		cardShadow.getElementById('review-keep').addEventListener('click', () => {
			reviewIndex++;
			renderReview();
		});
		positionCard();
	}

	async function openReviewPanel() {
		ensureCard();
		cardPinned = true;
		hideIcon();

		const $ = id => cardShadow.getElementById(id);
		$('loading').style.display = 'flex';
		$('loading').innerHTML = '<div class="spinner"></div> Loading review…';
		$('err-msg').style.display = 'none';
		$('content').style.display = 'none';
		$('review-content').style.display = 'none';
		cardShadow.host.style.display = 'block';
		positionCard();

		try {
			const { serverUrl, apiToken } = await getSettings();
			if (!serverUrl || !apiToken) throw new Error('Open extension options and add your server URL and token.');

			const data = await fetchJsonWithTimeout(`${serverUrl}/api/words?token=${encodeURIComponent(apiToken)}`);
			if (!data.ok) throw new Error(data.error || 'Failed to load words');

			reviewWords = (data.words || []).sort(() => Math.random() - 0.5);
			reviewIndex = 0;
			$('loading').style.display = 'none';
			$('loading').innerHTML = '<div class="spinner"></div> Looking up…';
			$('review-content').style.display = 'block';
			renderReview();
		}
		catch (err) {
			if (isContextInvalidatedError(err)) {
				teardownStaleExtensionUi();
				return;
			}
			$('loading').style.display = 'none';
			$('loading').innerHTML = '<div class="spinner"></div> Looking up…';
			$('err-msg').style.display = 'block';
			$('err-msg').textContent = err.message || 'Could not load review.';
			positionCard();
		}
	}

	function positionCard() {
		if (!cardShadow) return;
		const host = cardShadow.host;
		const card = cardShadow.getElementById('card');
		const cardW = card?.offsetWidth || 344;
		const cardH = card?.offsetHeight || 480;
		const viewport = window.visualViewport || {
			width: window.innerWidth,
			height: window.innerHeight,
			offsetLeft: 0,
			offsetTop: 0,
		};
		const x = Math.max(8, viewport.offsetLeft + (viewport.width - cardW) / 2);
		const y = Math.max(18, viewport.offsetTop + (viewport.height - cardH) / 2 + 24);

		host.style.left = `${x}px`;
		host.style.top = `${y}px`;
	}

	// ── Hide helpers ──────────────────────────────────────────────────────────
	function hideCard() {
		if (cardShadow) cardShadow.host.style.display = 'none';
		cardPinned = false;
	}

	function hideAll() {
		hideIcon();
		hideCard();
		lastWord = '';
		lastAudio = '';
	}

	// ── Selection listener ────────────────────────────────────────────────────
	document.addEventListener('mouseup', e => {
		if (e.composedPath().some(n => n.id === '__ele-icon__' || n.id === '__ele-card__')) return;
		if (cardPinned) return;
		clearTimeout(hideTimer);

		const sel = window.getSelection();
		const text = sel?.toString().trim();
		if (!text || text.split(/\s+/).length > 4 || text.length < 2) {
			hideTimer = setTimeout(hideIcon, 200);
			return;
		}

		const cleaned = text.replace(/[^a-zA-Z'\- ]/g, '').trim();
		if (!cleaned) {
			hideTimer = setTimeout(hideIcon, 200);
			return;
		}

		lastWord = cleaned;
		lastRect = sel.getRangeAt(0).getBoundingClientRect();
		showIcon(lastRect);
	});

	window.addEventListener('scroll', () => {
		hideIcon();
		if (cardShadow?.host.style.display === 'block') positionCard();
	}, { passive: true });
})();

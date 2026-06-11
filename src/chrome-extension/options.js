const statusEl = document.getElementById('status');

function setStatus(msg, type = '') {
	statusEl.textContent = msg;
	statusEl.className = type;
}

async function load() {
	const { serverUrl, apiToken } = await chrome.storage.sync.get(['serverUrl', 'apiToken']);
	if (serverUrl) document.getElementById('serverUrl').value = serverUrl;
	if (apiToken) document.getElementById('apiToken').value = apiToken;
}

document.getElementById('save').addEventListener('click', async () => {
	const serverUrl = document.getElementById('serverUrl').value.trim().replace(/\/$/, '');
	const apiToken = document.getElementById('apiToken').value.trim();

	if (!serverUrl || !apiToken) {
		setStatus('Both fields are required.', 'err');
		return;
	}

	await chrome.storage.sync.set({ serverUrl, apiToken });
	setStatus('Saved!');
	setTimeout(() => setStatus(''), 2000);
});

document.getElementById('register').addEventListener('click', async () => {
	const serverUrl = document.getElementById('serverUrl').value.trim().replace(/\/$/, '');
	if (!serverUrl) {
		setStatus('Enter the Server URL first.', 'err');
		return;
	}

	const btn = document.getElementById('register');
	btn.disabled = true;
	setStatus('Creating account…');

	try {
		const res = await fetch(`${serverUrl}/api/register`, { method: 'POST' });
		const data = await res.json();
		if (!data.ok) throw new Error(data.error || 'Registration failed');

		document.getElementById('apiToken').value = data.token;
		await chrome.storage.sync.set({ serverUrl, apiToken: data.token });
		setStatus('Account created and saved!');
		setTimeout(() => setStatus(''), 3000);
	} catch (err) {
		setStatus(err.message || 'Could not reach server.', 'err');
	} finally {
		btn.disabled = false;
	}
});

load();

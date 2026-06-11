async function load() {
	const { serverUrl, apiToken } = await chrome.storage.sync.get(['serverUrl', 'apiToken']);
	if (serverUrl) document.getElementById('serverUrl').value = serverUrl;
	if (apiToken) document.getElementById('apiToken').value = apiToken;
}

document.getElementById('save').addEventListener('click', async () => {
	const serverUrl = document.getElementById('serverUrl').value.trim().replace(/\/$/, '');
	const apiToken = document.getElementById('apiToken').value.trim();
	const statusEl = document.getElementById('status');

	if (!serverUrl || !apiToken) {
		statusEl.textContent = 'Both fields are required.';
		statusEl.className = 'err';
		return;
	}

	await chrome.storage.sync.set({ serverUrl, apiToken });
	statusEl.textContent = 'Saved!';
	statusEl.className = '';
	setTimeout(() => { statusEl.textContent = ''; }, 2000);
});

load();

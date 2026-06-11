chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'vocab-add',
    title: 'Add to Vocab Bot',
    contexts: ['selection'],
  });
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== 'vocab-add') return;

  const selection = info.selectionText.trim();
  if (!selection) return;

  // Extract words from selection (handles single words or multi-word selections)
  const words = selection
    .split(/[\s,;.!?()\[\]"]+/)
    .map(w => w.replace(/[^a-zA-Z'-]/g, '').toLowerCase())
    .filter(w => w.length > 1);

  if (words.length === 0) return;

  const { serverUrl, apiToken } = await chrome.storage.sync.get(['serverUrl', 'apiToken']);

  if (!serverUrl || !apiToken) {
    chrome.notifications.create('vocab-setup', {
      type: 'basic',
      iconUrl: 'icon.png',
      title: 'Vocab Bot — Setup needed',
      message: 'Open extension options and add your server URL and token.',
    });
    return;
  }

  try {
    const res = await fetch(`${serverUrl}/api/feed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: apiToken, words }),
    });
    const data = await res.json();
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icon.png',
      title: 'Vocab Bot',
      message: data.ok
        ? `Sent ${words.length} word(s) to Discord! Check your DMs.`
        : (data.error || 'Something went wrong.'),
    });
  } catch {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icon.png',
      title: 'Vocab Bot — Connection failed',
      message: 'Could not reach the bot. Make sure it is running.',
    });
  }
});

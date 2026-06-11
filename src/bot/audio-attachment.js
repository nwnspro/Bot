const { AttachmentBuilder } = require('discord.js');
const https = require('https');
const http = require('http');

const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 5000;

function extensionFromContentType(contentType) {
	if (/mpeg|mp3/i.test(contentType)) return 'mp3';
	if (/ogg|opus/i.test(contentType)) return 'ogg';
	if (/wav/i.test(contentType)) return 'wav';
	return 'mp3';
}

function safeName(word, ext) {
	const clean = String(word || 'pronunciation')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '')
		.slice(0, 40) || 'pronunciation';
	return `${clean}.${ext}`;
}

function downloadAudio(url) {
	return new Promise((resolve, reject) => {
		let parsed;
		try {
			parsed = new URL(url);
		}
		catch {
			reject(new Error('Invalid audio URL'));
			return;
		}

		if (!['http:', 'https:'].includes(parsed.protocol)) {
			reject(new Error('Unsupported audio URL protocol'));
			return;
		}

		const client = parsed.protocol === 'https:' ? https : http;
		const req = client.get(parsed, res => {
			if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
				res.resume();
				downloadAudio(new URL(res.headers.location, parsed).toString()).then(resolve, reject);
				return;
			}

			if (res.statusCode < 200 || res.statusCode >= 300) {
				res.resume();
				reject(new Error(`Audio request failed with ${res.statusCode}`));
				return;
			}

			const chunks = [];
			let size = 0;
			res.on('data', chunk => {
				size += chunk.length;
				if (size > MAX_AUDIO_BYTES) {
					req.destroy(new Error('Audio file too large'));
					return;
				}
				chunks.push(chunk);
			});
			res.on('end', () => resolve({
				buffer: Buffer.concat(chunks),
				contentType: res.headers['content-type'] || '',
			}));
		});

		req.setTimeout(REQUEST_TIMEOUT_MS, () => {
			req.destroy(new Error('Audio request timed out'));
		});
		req.on('error', reject);
	});
}

async function buildAudioAttachment(entry, fallbackWord) {
	if (!entry?.audio) return null;

	try {
		const { buffer, contentType } = await downloadAudio(entry.audio);
		const ext = extensionFromContentType(contentType);
		return new AttachmentBuilder(buffer, {
			name: safeName(entry.word || fallbackWord, ext),
			description: `Pronunciation for ${entry.word || fallbackWord}`,
		});
	}
	catch (err) {
		console.warn('[audio] attachment skipped:', err.message);
		return null;
	}
}

module.exports = { buildAudioAttachment };

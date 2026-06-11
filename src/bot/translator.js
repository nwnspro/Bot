const https = require('https');

const REQUEST_TIMEOUT_MS = 4500;

function get(url) {
	return new Promise((resolve, reject) => {
		const req = https.get(url, res => {
			let data = '';
			res.on('data', chunk => { data += chunk; });
			res.on('end', () => resolve({ status: res.statusCode, body: data }));
		});

		req.setTimeout(REQUEST_TIMEOUT_MS, () => {
			req.destroy(new Error('Request timed out'));
		});
		req.on('error', reject);
	});
}

function postJson(url, body, headers) {
	return new Promise((resolve, reject) => {
		const req = https.request(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json; charset=UTF-8',
				...headers,
			},
		}, res => {
			let data = '';
			res.on('data', chunk => { data += chunk; });
			res.on('end', () => resolve({ status: res.statusCode, body: data }));
		});

		req.setTimeout(REQUEST_TIMEOUT_MS, () => {
			req.destroy(new Error('Request timed out'));
		});
		req.on('error', reject);
		req.write(JSON.stringify(body));
		req.end();
	});
}

async function translateWithAzure(text) {
	const key = process.env.AZURE_TRANSLATOR_KEY;
	const region = process.env.AZURE_TRANSLATOR_REGION;
	if (!key || !region || !text) return '';

	try {
		const { status, body } = await postJson(
			'https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&from=en&to=zh-Hans',
			[{ Text: text }],
			{
				'Ocp-Apim-Subscription-Key': key,
				'Ocp-Apim-Subscription-Region': region,
			},
		);

		if (status !== 200) return '';
		const [result] = JSON.parse(body);
		return result?.translations?.[0]?.text || '';
	}
	catch {
		return '';
	}
}

async function translateWithMyMemory(text) {
	if (!text) return '';

	try {
		const query = new URLSearchParams({
			q: text,
			langpair: 'en|zh-CN',
		});
		if (process.env.MYMEMORY_EMAIL) query.set('de', process.env.MYMEMORY_EMAIL);

		const { status, body } = await get(`https://api.mymemory.translated.net/get?${query.toString()}`);
		if (status !== 200) return '';

		const result = JSON.parse(body);
		return result?.responseData?.translatedText || '';
	}
	catch {
		return '';
	}
}

async function translateToZh(text) {
	return await translateWithAzure(text) || await translateWithMyMemory(text);
}

module.exports = { translateToZh };

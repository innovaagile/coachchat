// netlify/functions/coachchat.js
// Proxy seguro a OpenAI Assistants v2, con logs y manejo de errores claro

const HEADERS_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS'
};

// Helper para ver el cuerpo de error cuando la API responde != 2xx
async function fetchJson(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} -> ${text}`);
  }
  try { return JSON.parse(text); } catch { return text; }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: HEADERS_CORS, body: 'OK' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: HEADERS_CORS, body: 'Method Not Allowed' };
  }

  try {
    const { message, threadId: incomingThreadId } = JSON.parse(event.body || '{}');
    if (!message) {
      return { statusCode: 400, headers: HEADERS_CORS, body: JSON.stringify({ error: 'Missing message' }) };
    }

    const apiKey = process.env.OPENAI_API_KEY;
    const assistantId = process.env.ASSISTANT_ID;
    if (!apiKey || !assistantId) {
      return { statusCode: 500, headers: HEADERS_CORS, body: JSON.stringify({ error: 'Missing server env vars' }) };
    }

    const base = 'https://api.openai.com/v1';
    const headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      // ⚠️ Obligatorio para Assistants **v2**
      'OpenAI-Beta': 'assistants=v2'
    };

    // 1) Thread
    let threadId = incomingThreadId;
    if (!threadId) {
      const thr = await fetchJson(`${base}/threads`, { method: 'POST', headers, body: JSON.stringify({}) });
      threadId = thr.id;
    }

    // 2) Add user message
    await fetchJson(`${base}/threads/${threadId}/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ role: 'user', content: message })
    });

    // 3) Run
    const run = await fetchJson(`${base}/threads/${threadId}/runs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ assistant_id: assistantId })
    });

    // 4) Poll until completed
    let status = 'queued', tries = 0;
    while (!['completed','failed','cancelled','expired'].includes(status) && tries < 30) {
      await new Promise(r => setTimeout(r, 1000));
      const rj = await fetchJson(`${base}/threads/${threadId}/runs/${run.id}`, { headers });
      status = rj.status;
      tries++;
    }
    if (status !== 'completed') {
      throw new Error(`Run status: ${status}`);
    }

    // 5) Get last assistant message
    const msgs = await fetchJson(`${base}/threads/${threadId}/messages?order=desc&limit=1`, { headers });
    const last = msgs.data?.[0];
    const parts = last?.content?.map(c => c.text?.value).filter(Boolean) || [];
    const reply = parts.join('\n\n') || '(sin respuesta)';

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', ...HEADERS_CORS },
      body: JSON.stringify({ reply, threadId })
    };
  } catch (err) {
    console.error('ERROR coachchat:', err); // <- esto aparecerá en la terminal
    return {
      statusCode: 500,
      headers: HEADERS_CORS,
      body: JSON.stringify({ error: err.message || 'Server error' })
    };
  }
};

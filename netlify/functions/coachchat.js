// Función Netlify: CoachChat (Assistants v2 con polling)
// No expone claves al cliente. Llama a OpenAI desde el servidor.

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

exports.handler = async (event) => {
  // Preflight (por si algún navegador hace OPTIONS)
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      },
      body: ""
    };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  // Validación de entorno
  if (!OPENAI_API_KEY || !ASSISTANT_ID) {
    return respJSON(500, { error: "Missing server env vars" });
  }

  // Validación de payload
  if (!event.body || event.body.length > 10 * 1024) {
    return respJSON(400, { error: "Bad request" });
  }
  let payload;
  try { payload = JSON.parse(event.body); } 
  catch { return respJSON(400, { error: "Bad JSON" }); }

  const userMessage = (payload.message || "").toString().slice(0, 2000);
  if (!userMessage) return respJSON(400, { error: "Missing message" });

  try {
    // 1) Crear thread
    const thread = await fetchJSON("https://api.openai.com/v1/threads", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({})
    });

    const threadId = thread.id;

    // 2) Agregar mensaje del usuario
    await fetchJSON(`https://api.openai.com/v1/threads/${threadId}/messages`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        role: "user",
        content: userMessage
      })
    });

    // 3) Crear run con el assistant
    const run = await fetchJSON(`https://api.openai.com/v1/threads/${threadId}/runs`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ assistant_id: ASSISTANT_ID })
    });

    // 4) Polling hasta completar o fallar
    let runId = run.id;
    let status = run.status;
    const maxTries = 30;       // ~24s (30 * 800ms)
    const delayMs = 800;

    for (let i = 0; i < maxTries; i++) {
      if (status === "completed") break;
      if (["failed", "cancelled", "expired"].includes(status)) {
        // Traer detalle de error si existe
        const runNow = await fetchJSON(`https://api.openai.com/v1/threads/${threadId}/runs/${runId}`, {
          method: "GET",
          headers: authHeaders()
        });
        return respJSON(502, { error: "Run error", status: runNow.status, last_error: runNow.last_error || null });
      }
      await sleep(delayMs);
      const runNow = await fetchJSON(`https://api.openai.com/v1/threads/${threadId}/runs/${runId}`, {
        method: "GET",
        headers: authHeaders()
      });
      status = runNow.status;
    }

    if (status !== "completed") {
      return respJSON(504, { error: "Run timeout", status });
    }

    // 5) Leer mensajes y extraer la última respuesta del asistente
    const msgs = await fetchJSON(`https://api.openai.com/v1/threads/${threadId}/messages?limit=10`, {
      method: "GET",
      headers: authHeaders()
    });

    const reply = pickAssistantReply(msgs);
    if (!reply) return respJSON(502, { error: "No assistant reply" });

    return respJSON(200, { reply });

  } catch (err) {
    // Log interno y respuesta controlada
    console.error("CoachChat error:", err?.message || err);
    return respJSON(500, { error: "Server error", detail: safeErr(err) });
  }
};

// Helpers

function authHeaders() {
  return {
    "Authorization": `Bearer ${OPENAI_API_KEY}`,
    "Content-Type": "application/json",
    "OpenAI-Beta": "assistants=v2"
  };
}

async function fetchJSON(url, opts) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { _raw: text }; }
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status; err.url = url; err.body = json;
    throw err;
  }
  return json;
}

function pickAssistantReply(messagesList) {
  // Busca el último mensaje del asistente y devuelve su texto plano
  const data = messagesList?.data || [];
  for (const m of data) {
    if (m.role === "assistant" && Array.isArray(m.content)) {
      for (const c of m.content) {
        if (c.type === "text" && c.text && c.text.value) {
          return c.text.value;
        }
      }
    }
  }
  return null;
}

function respJSON(code, obj) {
  return {
    statusCode: code,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(obj)
  };
}

function safeErr(e) {
  return {
    message: e?.message || "unknown",
    status: e?.status || null,
    url: e?.url || null,
    body: e?.body || null
  };
}

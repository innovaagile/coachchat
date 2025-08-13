// Test de diagnóstico: SOLO verifica que la función ve las variables
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const key = process.env.OPENAI_API_KEY || "";
  const asst = process.env.OPENAI_ASSISTANT_ID || "";

  const hasKey = key.startsWith("sk-");
  const hasAsst = asst.startsWith("asst_");

  // Para mayor claridad, devolvemos además el largo de cada variable (sin exponer el valor)
  const keyLen = key.length;
  const asstLen = asst.length;

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: true, hasKey, hasAsst, keyLen, asstLen })
  };
};

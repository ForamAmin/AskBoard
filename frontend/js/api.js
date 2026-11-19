const askboardApiBase = window.ASKBOARD_API_BASE || "http://127.0.0.1:8000";

async function parseApiResponse(response) {
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const detail = payload?.detail || `The server returned an error (${response.status}).`;
    throw new Error(detail);
  }

  return payload;
}

async function extractPdfDocument(file) {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`${askboardApiBase}/api/documents/extract`, {
    method: "POST",
    body: formData,
  });
  const payload = await parseApiResponse(response);

  if (!payload?.filename || typeof payload.page_count !== "number" || typeof payload.text !== "string") {
    throw new Error("The server returned an incomplete extraction result.");
  }
  return payload;
}

async function generateAnswer(documentId, question, topK = 4) {
  const response = await fetch(`${askboardApiBase}/api/answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      document_id: documentId,
      question,
      top_k: topK,
    }),
  });
  const payload = await parseApiResponse(response);

  if (typeof payload?.answer !== "string" || !Array.isArray(payload.sources)) {
    throw new Error("The server returned an incomplete answer.");
  }
  return payload;
}

async function health() {
  const response = await fetch(`${askboardApiBase}/api/health`);
  return parseApiResponse(response);
}

window.askboardApi = Object.freeze({ baseUrl: askboardApiBase, extractPdfDocument, generateAnswer, health });
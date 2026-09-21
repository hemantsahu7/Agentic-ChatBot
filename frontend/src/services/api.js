// All communication with the FastAPI backend lives here.
// The frontend only ever sees thread ids, messages and events, never API keys.

const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:8000").replace(/\/$/, "");

export const MAX_UPLOAD_MB = 20;

export class ApiError extends Error {
  constructor(message, { status = null, network = false } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.network = network;
  }
}

const NETWORK_MESSAGE = `Cannot reach the backend at ${API_URL}. Make sure the server is running.`;

// FastAPI errors look like {"detail": "message"}; fall back to the status code.
async function errorFromResponse(response) {
  let message = `Request failed (HTTP ${response.status}).`;
  try {
    const body = await response.json();
    if (typeof body.detail === "string") message = body.detail;
    else if (Array.isArray(body.detail)) message = body.detail.map((d) => d.msg).join("; ");
  } catch {
    /* non-JSON error body: keep the generic message */
  }
  return new ApiError(message, { status: response.status });
}

async function fetchOrThrow(path, options) {
  let response;
  try {
    response = await fetch(`${API_URL}${path}`, options);
  } catch (err) {
    if (err.name === "AbortError") throw err;
    throw new ApiError(NETWORK_MESSAGE, { network: true });
  }
  if (!response.ok) throw await errorFromResponse(response);
  return response;
}

async function requestJson(path, options) {
  const response = await fetchOrThrow(path, options);
  return response.json();
}

const jsonPost = (body) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

// ---- Threads --------------------------------------------------------------

export const checkHealth = () => requestJson("/api/health");

export const listThreads = async () => (await requestJson("/api/threads")).threads;

export const createThread = async () => (await requestJson("/api/threads", { method: "POST" })).thread_id;

export const getThread = (threadId) => requestJson(`/api/threads/${encodeURIComponent(threadId)}`);

// ---- Chat (Server-Sent Events over a POST) ----------------------------------

// Parse one SSE frame ("event: x\ndata: {...}") into { event, data }.
function parseFrame(frame) {
  let event = "message";
  const dataLines = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;
  return { event, data: JSON.parse(dataLines.join("\n")) };
}

// POST to `path`, then read the SSE response and call handlers[event](data).
// Resolves once the server sends `done`; rejects on `error`, a dropped
// connection, or an HTTP error before the stream starts.
async function streamPost(path, body, handlers, signal) {
  const response = await fetchOrThrow(path, { ...jsonPost(body), signal });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;

  const dispatch = (frame) => {
    const parsed = parseFrame(frame);
    if (!parsed) return;
    if (parsed.event === "error") throw new ApiError(parsed.data.message || "The assistant failed.");
    if (parsed.event === "done") finished = true;
    handlers[parsed.event]?.(parsed.data);
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      const frames = buffer.split("\n\n");
      buffer = frames.pop(); // the last piece may be an incomplete frame
      frames.forEach(dispatch);
    }
  } catch (err) {
    if (err instanceof ApiError || err.name === "AbortError") throw err;
    throw new ApiError("The connection to the server was lost while the reply was streaming.", { network: true });
  }

  if (buffer.trim()) dispatch(buffer);
  if (!finished) throw new ApiError("The connection to the server closed before the reply finished.", { network: true });
}

export const streamChat = (threadId, message, handlers, signal) =>
  streamPost("/api/chat", { thread_id: threadId, message }, handlers, signal);

export const resumeChat = (threadId, decision, handlers, signal) =>
  streamPost("/api/chat/resume", { thread_id: threadId, decision }, handlers, signal);

// ---- PDF upload -------------------------------------------------------------

// XMLHttpRequest (not fetch) because it reports upload progress.
// onProgress(percent) while sending; onProcessing() once the whole file has
// been sent and the server is indexing it.
export function uploadPdf(file, { onProgress, onProcessing } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_URL}/api/upload`);
    xhr.responseType = "json";

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
    };
    xhr.upload.onload = () => onProcessing?.();

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve(xhr.response);
      const detail = xhr.response?.detail;
      reject(new ApiError(typeof detail === "string" ? detail : `Upload failed (HTTP ${xhr.status}).`, { status: xhr.status }));
    };
    xhr.onerror = () => reject(new ApiError(NETWORK_MESSAGE, { network: true }));

    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  });
}

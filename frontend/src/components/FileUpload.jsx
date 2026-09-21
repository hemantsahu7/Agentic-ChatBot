import { useEffect, useRef, useState } from "react";
import * as api from "../services/api";

const SUCCESS_VISIBLE_MS = 8000;

// Paperclip button + status line. Phases: idle → uploading → processing → success | error.
export default function FileUpload() {
  const [state, setState] = useState({ phase: "idle" });
  const input = useRef(null);
  const busy = state.phase === "uploading" || state.phase === "processing";

  // Success messages fade away on their own; errors stay until dismissed.
  useEffect(() => {
    if (state.phase !== "success") return undefined;
    const timer = setTimeout(() => setState({ phase: "idle" }), SUCCESS_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [state]);

  async function handleFile(event) {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow picking the same file again
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".pdf")) {
      return setState({ phase: "error", name: file.name, message: "Only PDF files are supported." });
    }
    if (file.size > api.MAX_UPLOAD_MB * 1024 * 1024) {
      return setState({ phase: "error", name: file.name, message: `The PDF is larger than ${api.MAX_UPLOAD_MB} MB.` });
    }

    setState({ phase: "uploading", name: file.name, progress: 0 });
    try {
      await api.uploadPdf(file, {
        onProgress: (progress) => setState((s) => (s.phase === "uploading" ? { ...s, progress } : s)),
        onProcessing: () => setState({ phase: "processing", name: file.name }),
      });
      setState({ phase: "success", name: file.name });
    } catch (err) {
      setState({ phase: "error", name: file.name, message: err.message });
    }
  }

  return (
    <div className="upload">
      {state.phase !== "idle" && (
        <div className={`upload-status upload-${state.phase}`} role={state.phase === "error" ? "alert" : "status"}>
          {state.phase === "uploading" && (
            <>
              <span className="spinner" aria-hidden="true" />
              <span>
                Uploading <strong>{state.name}</strong> … {state.progress}%
              </span>
            </>
          )}
          {state.phase === "processing" && (
            <>
              <span className="spinner" aria-hidden="true" />
              <span>
                Processing <strong>{state.name}</strong> (indexing for search) …
              </span>
            </>
          )}
          {state.phase === "success" && (
            <span>
              ✅ <strong>{state.name}</strong> is ready. Ask questions about it.
            </span>
          )}
          {state.phase === "error" && (
            <>
              <span>
                ⚠️ {state.name}: {state.message}
              </span>
              <button type="button" className="btn-link" onClick={() => setState({ phase: "idle" })} aria-label="Dismiss">
                ✕
              </button>
            </>
          )}
        </div>
      )}

      <input ref={input} type="file" accept="application/pdf,.pdf" onChange={handleFile} hidden />
      <button
        type="button"
        className="icon-btn attach"
        onClick={() => input.current.click()}
        disabled={busy}
        aria-label="Attach PDF"
        title={busy ? "Processing PDF…" : "Attach a PDF"}
      >
        📎
      </button>
    </div>
  );
}

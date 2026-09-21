# Agentic Chatbot

A LangGraph agent (Gemini + tools + RAG) with a **React** chat UI and a **FastAPI** API in between.

```
React (Vite)  ──HTTP / SSE──▶  FastAPI  ──▶  LangGraph agent
frontend/                      backend/       backend/agentic_chatbot_backend.py
                                                ├─ Gemini
                                                ├─ Tavily · Calculator · Stock · Weather
                                                ├─ RAG (PyPDF → Google embeddings → FAISS)
                                                └─ SQLite checkpointer (chatbot.db)
```

## Project structure

```
.
├── backend/
│   ├── main.py                       FastAPI app: CORS, routers, error handlers
│   ├── config.py                     Settings from env (FRONTEND_URL, MAX_UPLOAD_MB)
│   ├── schemas.py                    Pydantic request/response models
│   ├── utils.py                      text_from_content(), SSE formatting
│   ├── routers/
│   │   ├── chat.py                   POST /api/chat, POST /api/chat/resume  (SSE)
│   │   ├── threads.py                GET/POST /api/threads, GET /api/threads/{id}
│   │   └── upload.py                 POST /api/upload
│   ├── services/
│   │   ├── chat_service.py           runs the graph, maps its stream to SSE events
│   │   ├── thread_service.py         thread list / history from the checkpointer
│   │   └── rag_service.py            PDF ingestion wrapper
│   ├── agentic_chatbot_backend.py    the existing LangGraph agent (tools, RAG, checkpointer)
│   ├── requirements.txt
│   ├── .env.example
│   ├── chatbot.db                    LangGraph SQLite checkpoints (source of truth for threads)
│   └── faiss_db/                     FAISS index of the last uploaded PDF (git-ignored)
└── frontend/
    ├── index.html · vite.config.js · package.json · .env.example
    └── src/
        ├── main.jsx · App.jsx        state: threads, messages, streaming, approval
        ├── services/api.js           the only code that talks to the backend (fetch + SSE parser + XHR upload)
        ├── components/
        │   ├── Sidebar.jsx           New Chat + conversation list
        │   ├── Chat.jsx              header, banners, scrollable messages
        │   ├── Message.jsx           user / assistant bubble
        │   ├── Markdown.jsx          Markdown + code blocks (with Copy)
        │   ├── ToolStatus.jsx        🔧 Using `tool` … → ✅ `tool` finished
        │   ├── ApprovalCard.jsx      human-in-the-loop Approve / Reject
        │   ├── ChatInput.jsx         textarea + send
        │   └── FileUpload.jsx        📎 PDF upload with progress / processing / success / error
        └── styles/index.css
```

## Run it locally

You need Python 3.11+ and Node 20+.

**1. Backend**

```bash
cd backend
python -m venv .venv            # or reuse an existing virtualenv
.venv\Scripts\activate          # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # then fill in your API keys (Windows: copy .env.example .env)
uvicorn main:app --reload
```

The API is now on http://localhost:8000 (interactive docs: http://localhost:8000/docs).
`.env` can live in `backend/` or in the project root.

**2. Frontend** (second terminal)

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173.

## Environment variables

Backend (`backend/.env`, never sent to the browser):

| Variable | Required | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | yes | Gemini chat model + embeddings |
| `TAVILY_API_KEY` | yes | Web search tool |
| `OPENWEATHER_API_KEY` | yes | Weather tool |
| `ALPHA_VANTAGE_API_KEY` | yes | Stock price tool (previously hard-coded in the source) |
| `FRONTEND_URL` | no (default `http://localhost:5173`) | Origin allowed by CORS; comma-separate several |
| `MAX_UPLOAD_MB` | no (default `20`) | Largest accepted PDF |
| `GEMINI_MODEL` | no (default `gemini-3.6-flash`) | Override the chat model without editing code |

Frontend (`frontend/.env`, optional):

| Variable | Default | Purpose |
|---|---|---|
| `VITE_API_URL` | `http://localhost:8000` | Where the FastAPI backend is |

## API

All errors are JSON: `{"detail": "human-readable message"}`.

| Method & path | Body | Success | Errors |
|---|---|---|---|
| `GET /api/health` | – | `200 {"status":"ok"}` | – |
| `POST /api/threads` | – | `201 {"thread_id": "<uuid>"}` | – |
| `GET /api/threads` | – | `200 {"threads":[{"thread_id","title","updated_at"}]}` newest first | – |
| `GET /api/threads/{thread_id}` | – | `200 {"thread_id","messages":[{"role","content","tools":[{"id","name","status"}]}],"pending_interrupt":{"message"}\|null}` | `404` unknown thread, `422` malformed id |
| `POST /api/chat` | `{"thread_id","message"}` | `200` SSE stream | `422` empty/invalid input, `409` thread is waiting for approval |
| `POST /api/chat/resume` | `{"thread_id","decision":"yes"\|"no"}` | `200` SSE stream | `422` invalid input, `409` nothing pending |
| `POST /api/upload` | multipart field `file` (PDF) | `200 {"filename","message"}` | `422` not a PDF / unreadable / no text, `413` too large, `500` indexing failed |

Notes:
- A thread created by `POST /api/threads` is just an id; it shows up in `GET /api/threads` (and `GET /api/threads/{id}` stops returning 404) once its first message has been sent, because the LangGraph checkpoint is the only conversation store.
- A thread id is any string matching `[A-Za-z0-9_-]{1,128}` (the UUIDs from `POST /api/threads`, plus any older ids in the database).

### SSE events (`/api/chat` and `/api/chat/resume`)

Each frame is `event: <name>` + `data: <json>`.

| Event | Data | Meaning |
|---|---|---|
| `token` | `{"text"}` | A piece of the assistant's answer (only `AIMessage` text; tool output is never sent as text) |
| `tool_start` | `{"id","name"}` | The model called a tool |
| `tool_end` | `{"id","name","status":"success"\|"error"}` | The tool returned (a `ToolMessage`) |
| `interrupt` | `{"message"}` | The graph paused for human approval (stock purchase). Answer with `POST /api/chat/resume` |
| `done` | `{}` | Stream finished normally |
| `error` | `{"message"}` | The run failed; the stream ends |

## How the pieces talk

**React → FastAPI.** `frontend/src/services/api.js` is the only place that does network I/O.
Normal calls are JSON over `fetch`. Chat is a `POST` whose response is a Server-Sent Events stream;
because `EventSource` cannot `POST`, `api.js` reads the `fetch` response body and parses the SSE frames itself.
PDF upload uses `XMLHttpRequest` so it can show upload progress, then a "Processing" state while the server indexes the file.
CORS only allows `FRONTEND_URL`; the browser never sees an API key.

**FastAPI → LangGraph.** The agent module is imported as-is (`chatbot`, `checkpoint`, `ingest_rag_document`).
- **Chat:** `chatbot.stream({"messages":[HumanMessage(...)]}, config, stream_mode="messages")` with the same config the Streamlit app used
  (`{"configurable":{"thread_id": ...}, "metadata": ..., "run_name": "chat_trace"}`). The same `thread_id` continues the same conversation.
  `AIMessage` chunks become `token` events; the model's tool calls and `ToolMessage`s become `tool_start` / `tool_end`.
  The graph is synchronous, so it runs in a worker thread and hands events to the async response through a queue — the event loop is never blocked.
  The worker always runs to completion, even if the browser disconnects, so a checkpoint is never left holding a tool call without a result.
- **Human-in-the-loop:** when a stream ends, the service checks the checkpointer for a pending `interrupt()`. If there is one it sends `interrupt`;
  the UI shows Approve / Reject and calls `/api/chat/resume`, which runs `chatbot.stream(Command(resume="yes"|"no"), config, …)`.
- **Threads:** `GET /api/threads` and `GET /api/threads/{id}` read the SQLite checkpointer (`checkpoint.list()` / `chatbot.get_state()`).
- **Upload:** the PDF is written to a temp file, validated, passed to `ingest_rag_document()` in a worker thread, and the temp file is always deleted.

## Changes to the existing agent file

`backend/agentic_chatbot_backend.py` was moved (unchanged logic, prompts and tools) with these small edits:

- `purchase_stock` was defined but missing from the `tools` list, so the model could never call it; it is now registered.
- The Alpha Vantage key is read from `ALPHA_VANTAGE_API_KEY` instead of being hard-coded.
- `chatbot.db` / `faiss_db` paths are anchored to the file's folder instead of the current working directory.
- The model name can be overridden with `GEMINI_MODEL` (default unchanged).
- `ingest_rag_document()` raises a clear error for PDFs with no extractable text (e.g. scans) instead of crashing inside FAISS.

## Security note

The old Alpha Vantage key was committed to git history (commit `4e700e1`). It is now read from the environment, but you should **rotate that key** since it is still in the history.

import { useCallback, useEffect, useRef, useState } from "react";
import Sidebar from "./components/Sidebar.tsx";
import Chat from "./components/Chat.tsx";
import * as api from "./services/api";
import { ApiError, type StreamHandlers } from "./services/api";
import type { ChatMessage, PendingApproval, ServerMessage, ThreadSummary, ToolCall } from "./types";

let idCounter = 0;
const uid = () => `${Date.now().toString(36)}-${(idCounter++).toString(36)}`;

// Server history -> UI message. A tool call with no result yet is "waiting" (for approval).
const fromServerMessage = (m: ServerMessage): ChatMessage => ({
  id: uid(),
  role: m.role,
  content: m.content,
  tools: (m.tools || []).map((t) => ({
    id: t.id || uid(), // the tool-call id lets a resumed stream update this entry
    name: t.name,
    status: t.status === "pending" ? "waiting" : t.status,
  })),
});

const newAssistantMessage = (): ChatMessage => ({ id: uid(), role: "assistant", content: "", tools: [], streaming: true, error: null });

// tool_start is re-sent when a paused run resumes, so match on the tool call id.
function upsertTool(tools: ToolCall[], tool: ToolCall): ToolCall[] {
  const index = tools.findIndex((t) => t.id === tool.id);
  if (index === -1) return [...tools, tool];
  const next = tools.slice();
  next[index] = { ...next[index], ...tool };
  return next;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default function App() {
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState<PendingApproval | null>(null); // paused for human approval
  const [streaming, setStreaming] = useState(false);
  const [loadingThread, setLoadingThread] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null); // backend unreachable at startup
  const [notice, setNotice] = useState<string | null>(null); // dismissible error banner
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const activeIdRef = useRef<string | null>(null);

  const activate = useCallback((threadId: string) => {
    activeIdRef.current = threadId;
    setActiveId(threadId);
    setMessages([]);
    setPending(null);
    setNotice(null);
  }, []);

  const refreshThreads = useCallback(async () => {
    try {
      setThreads(await api.listThreads());
    } catch (err) {
      setNotice(errorMessage(err));
    }
  }, []);

  // First load: fetch conversations and start a fresh chat (like the old Streamlit app).
  const init = useCallback(async () => {
    try {
      const [list, threadId] = await Promise.all([api.listThreads(), api.createThread()]);
      setThreads(list);
      activate(threadId);
      setConnectionError(null);
    } catch (err) {
      setConnectionError(errorMessage(err));
    }
  }, [activate]);

  useEffect(() => {
    init();
  }, [init]);

  // Conversations from the server plus the not-yet-saved current chat.
  const sidebarThreads =
    activeId && !threads.some((t) => t.thread_id === activeId)
      ? [{ thread_id: activeId, title: "New chat", draft: true }, ...threads]
      : threads;

  const loadThread = useCallback(async (threadId: string) => {
    setLoadingThread(true);
    try {
      const detail = await api.getThread(threadId);
      if (activeIdRef.current !== threadId) return; // the user moved on
      setMessages(detail.messages.map(fromServerMessage));
      setPending(detail.pending_interrupt);
    } catch (err) {
      if (activeIdRef.current === threadId) setNotice(errorMessage(err));
    } finally {
      if (activeIdRef.current === threadId) setLoadingThread(false);
    }
  }, []);

  async function selectThread(threadId: string) {
    setSidebarOpen(false);
    if (threadId === activeId || streaming) return;
    const saved = threads.some((t) => t.thread_id === threadId);
    activate(threadId);
    if (saved) await loadThread(threadId);
  }

  async function newChat() {
    setSidebarOpen(false);
    if (streaming) return;
    if (activeId && messages.length === 0 && !loadingThread) return; // already an empty chat
    try {
      activate(await api.createThread());
    } catch (err) {
      setNotice(errorMessage(err));
    }
  }

  const patchLastAssistant = (update: (m: ChatMessage) => ChatMessage) =>
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (!last || last.role !== "assistant") return prev;
      return [...prev.slice(0, -1), update(last)];
    });

  // Runs one streamed request (a new message or an approval decision) and
  // applies its events to the last assistant message.
  async function runStream(open: (handlers: StreamHandlers) => Promise<void>, threadId: string) {
    setStreaming(true);
    const handlers: StreamHandlers = {
      token: ({ text }) => patchLastAssistant((m) => ({ ...m, content: m.content + text })),
      tool_start: ({ id, name }) =>
        patchLastAssistant((m) => ({ ...m, tools: upsertTool(m.tools, { id, name, status: "running" }) })),
      tool_end: ({ id, name, status }) =>
        patchLastAssistant((m) => ({
          ...m,
          tools: upsertTool(m.tools, { id, name, status: status === "error" ? "error" : "done" }),
        })),
      interrupt: ({ message }) => {
        setPending({ message });
        patchLastAssistant((m) => ({
          ...m,
          tools: m.tools.map((t) => (t.status === "running" ? { ...t, status: "waiting" } : t)),
        }));
      },
    };

    let failed = false;
    let unreachable = false;
    try {
      await open(handlers);
    } catch (err) {
      failed = true;
      const apiErr = err instanceof ApiError ? err : null;
      unreachable = apiErr?.network === true;
      patchLastAssistant((m) => ({ ...m, error: apiErr?.message ?? errorMessage(err) }));
      // 409 = our view of the thread is out of sync (e.g. a pending approval); reload it.
      if (apiErr?.status === 409) loadThread(threadId);
    } finally {
      patchLastAssistant((m) => ({
        ...m,
        streaming: false,
        tools: failed ? m.tools.map((t) => (t.status === "running" ? { ...t, status: "error" } : t)) : m.tools,
      }));
      setStreaming(false);
      if (!unreachable) refreshThreads(); // the error is already shown in the reply
    }
  }

  async function send(text: string) {
    if (!activeId || streaming || pending) return;
    setNotice(null);
    setMessages((prev) => [...prev, { id: uid(), role: "user", content: text, tools: [] }, newAssistantMessage()]);
    await runStream((handlers) => api.streamChat(activeId, text, handlers), activeId);
  }

  async function decide(decision: "yes" | "no") {
    if (!activeId || streaming) return;
    setPending(null);
    setNotice(null);
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last?.role === "assistant") return [...prev.slice(0, -1), { ...last, streaming: true, error: null }];
      return [...prev, newAssistantMessage()];
    });
    await runStream((handlers) => api.resumeChat(activeId, decision, handlers), activeId);
  }

  return (
    <div className="app">
      <Sidebar
        threads={sidebarThreads}
        activeId={activeId}
        onSelect={selectThread}
        onNew={newChat}
        busy={streaming}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <Chat
        messages={messages}
        activeId={activeId}
        streaming={streaming}
        loading={loadingThread}
        pending={pending}
        connectionError={connectionError}
        notice={notice}
        onDismissNotice={() => setNotice(null)}
        onRetryConnection={init}
        onSend={send}
        onDecision={decide}
        onOpenSidebar={() => setSidebarOpen(true)}
      />
    </div>
  );
}

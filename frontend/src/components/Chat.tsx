import { useLayoutEffect, useRef } from "react";
import Message from "./Message.tsx";
import ChatInput from "./ChatInput.tsx";
import ApprovalCard from "./ApprovalCard.tsx";
import type { ChatMessage, PendingApproval } from "../types";

const SUGGESTIONS = [
  "What's the weather in Jaipur right now?",
  "Calculate sqrt(2024) * 15",
  "What is the current price of AAPL?",
  "Search the web for today's top tech news",
];

interface ChatProps {
  messages: ChatMessage[];
  activeId: string | null;
  streaming: boolean;
  loading: boolean;
  pending: PendingApproval | null;
  connectionError: string | null;
  notice: string | null;
  onDismissNotice: () => void;
  onRetryConnection: () => void;
  onSend: (text: string) => void;
  onDecision: (decision: "yes" | "no") => void;
  onOpenSidebar: () => void;
}

export default function Chat({
  messages,
  activeId,
  streaming,
  loading,
  pending,
  connectionError,
  notice,
  onDismissNotice,
  onRetryConnection,
  onSend,
  onDecision,
  onOpenSidebar,
}: ChatProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const handleScroll = () => {
    const el = scroller.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  // A different conversation always starts at the bottom.
  useLayoutEffect(() => {
    stickToBottom.current = true;
  }, [activeId]);

  // Follow new content, unless the user scrolled up to read.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, pending, loading, activeId]);

  const visible = messages.filter((m) => m.role === "user" || m.content || m.tools.length > 0 || m.streaming || m.error);
  const isEmpty = visible.length === 0 && !loading;
  const inputBlocked = streaming || loading || !!pending || !activeId;

  let placeholder = "Message the assistant…";
  if (pending) placeholder = "Approve or reject the action above to continue";
  else if (streaming) placeholder = "Waiting for the reply…";

  return (
    <main className="chat">
      <header className="chat-header">
        <button className="icon-btn menu-btn" onClick={onOpenSidebar} aria-label="Open conversations">
          ☰
        </button>
        <h2>Agentic Chatbot with LangGraph</h2>
      </header>

      {connectionError && (
        <div className="banner banner-error" role="alert">
          <span>{connectionError}</span>
          <button className="btn-link" onClick={onRetryConnection}>
            Retry
          </button>
        </div>
      )}
      {notice && !connectionError && (
        <div className="banner banner-error" role="alert">
          <span>{notice}</span>
          <button className="btn-link" onClick={onDismissNotice} aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}

      <div className="messages" ref={scroller} onScroll={handleScroll}>
        <div className="messages-inner">
          {loading && <p className="muted center">Loading conversation…</p>}

          {isEmpty && (
            <div className="welcome">
              <h3>How can I help?</h3>
              <p className="muted">Ask a question, use a tool, or attach a PDF and ask about it.</p>
              <div className="suggestions">
                {SUGGESTIONS.map((text) => (
                  <button key={text} className="suggestion" onClick={() => onSend(text)} disabled={inputBlocked}>
                    {text}
                  </button>
                ))}
              </div>
            </div>
          )}

          {visible.map((message) => (
            <Message key={message.id} message={message} />
          ))}

          {pending && <ApprovalCard message={pending.message} onDecision={onDecision} />}
        </div>
      </div>

      <ChatInput onSend={onSend} disabled={inputBlocked} placeholder={placeholder} />
    </main>
  );
}

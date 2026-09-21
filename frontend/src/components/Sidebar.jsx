export default function Sidebar({ threads, activeId, onSelect, onNew, busy, open, onClose }) {
  return (
    <>
      <div className={`backdrop ${open ? "show" : ""}`} onClick={onClose} aria-hidden="true" />
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <div className="sidebar-header">
          <h1>My Conversations</h1>
          <button className="btn-primary new-chat" onClick={onNew} disabled={busy} title={busy ? "Wait for the reply to finish" : undefined}>
            + New Chat
          </button>
        </div>

        <nav className="thread-list" aria-label="Conversations">
          {threads.length === 0 && <p className="thread-empty">No conversations yet.</p>}
          {threads.map((thread) => (
            <button
              key={thread.thread_id}
              className={`thread ${thread.thread_id === activeId ? "active" : ""}`}
              onClick={() => onSelect(thread.thread_id)}
              disabled={busy && thread.thread_id !== activeId}
              aria-current={thread.thread_id === activeId ? "true" : undefined}
              title={thread.title}
            >
              <span className="thread-title">{thread.title}</span>
            </button>
          ))}
        </nav>
      </aside>
    </>
  );
}

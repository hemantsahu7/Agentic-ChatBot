import Markdown from "./Markdown.tsx";
import ToolStatus from "./ToolStatus.tsx";
import type { ChatMessage } from "../types";

export default function Message({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="row row-user">
        <div className="bubble-user">{message.content}</div>
      </div>
    );
  }

  const toolRunning = message.tools.some((t) => t.status === "running");
  const showThinking = message.streaming && !message.content && !toolRunning && !message.error;

  return (
    <div className="row row-assistant">
      <div className="avatar" aria-hidden="true">
        🤖
      </div>
      <div className="assistant-body">
        <ToolStatus tools={message.tools} />
        {message.content && <Markdown>{message.content}</Markdown>}
        {message.streaming && message.content && <span className="caret" aria-hidden="true" />}
        {showThinking && (
          <div className="typing" role="status" aria-label="Assistant is thinking">
            <span />
            <span />
            <span />
          </div>
        )}
        {message.error && (
          <div className="msg-error" role="alert">
            ⚠️ {message.error}
          </div>
        )}
      </div>
    </div>
  );
}

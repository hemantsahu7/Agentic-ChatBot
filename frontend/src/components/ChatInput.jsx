import { useEffect, useRef, useState } from "react";
import FileUpload from "./FileUpload.jsx";

const MAX_HEIGHT_PX = 200;

export default function ChatInput({ onSend, disabled, placeholder }) {
  const [text, setText] = useState("");
  const textarea = useRef(null);

  // Grow with the content, up to a limit.
  useEffect(() => {
    const el = textarea.current;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [text]);

  // Put the cursor back after a reply finishes.
  useEffect(() => {
    if (!disabled) textarea.current?.focus();
  }, [disabled]);

  function submit(event) {
    event?.preventDefault();
    const message = text.trim();
    if (!message || disabled) return;
    onSend(message);
    setText("");
  }

  function handleKeyDown(event) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      submit(event);
    }
  }

  return (
    <form className="composer" onSubmit={submit}>
      <div className="composer-row">
        <FileUpload />
        <textarea
          ref={textarea}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          disabled={disabled}
          aria-label="Message"
        />
        <button type="submit" className="btn-primary send" disabled={disabled || !text.trim()}>
          Send
        </button>
      </div>
      <p className="composer-hint">Enter to send · Shift+Enter for a new line</p>
    </form>
  );
}

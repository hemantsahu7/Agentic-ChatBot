import type { ToolCall } from "../types";

// One line per tool call, mirroring the old Streamlit status box:
//   🔧 Using `tool` …   →   ✅ `tool` finished
export default function ToolStatus({ tools }: { tools: ToolCall[] }) {
  if (!tools || tools.length === 0) return null;

  return (
    <ul className="tools" aria-label="Tool activity">
      {tools.map((tool) => (
        <li key={tool.id} className={`tool tool-${tool.status}`}>
          {tool.status === "running" && (
            <>
              <span className="spinner" aria-hidden="true" />
              <span>
                🔧 Using <code>{tool.name}</code> …
              </span>
            </>
          )}
          {tool.status === "waiting" && (
            <span>
              ⏸️ <code>{tool.name}</code> is waiting for your approval
            </span>
          )}
          {tool.status === "done" && (
            <span>
              ✅ <code>{tool.name}</code> finished
            </span>
          )}
          {tool.status === "error" && (
            <span>
              ⚠️ <code>{tool.name}</code> failed
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

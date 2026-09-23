export type ToolCallStatus = "running" | "waiting" | "done" | "error";

export interface ToolCall {
  id: string;
  name: string;
  status: ToolCallStatus;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  tools: ToolCall[];
  streaming?: boolean;
  error?: string | null;
}

export interface ThreadSummary {
  thread_id: string;
  title: string;
  draft?: boolean;
}

export interface PendingApproval {
  message: string;
}

export interface ServerToolCall {
  id?: string;
  name: string;
  status: "pending" | ToolCallStatus;
}

export interface ServerMessage {
  role: "user" | "assistant";
  content: string;
  tools?: ServerToolCall[];
}

export interface ThreadDetail {
  messages: ServerMessage[];
  pending_interrupt: PendingApproval | null;
}

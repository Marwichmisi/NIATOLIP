// Client du run agent : envoie le run à POST /api/chat et parse le flux
// UIMessage (SSE `data: {...}`). Sans @ai-sdk/react (dépendance évitée) :
// parseur minimal couvrant texte + cycle de vie des outils.
"use client";

export interface ChatMsgIn {
  role: "user" | "agent";
  text: string;
}

export interface StreamCallbacks {
  onText: (fullText: string) => void;
  onToolStart: (toolName: string, toolCallId: string) => void;
  onToolEnd: (toolName: string, ok: boolean, detail: string) => void;
  onError: (message: string) => void;
}

interface UIMessageOut {
  id: string;
  role: "user" | "assistant";
  parts: Array<{ type: "text"; text: string }>;
}

function toUIMessages(msgs: ChatMsgIn[]): UIMessageOut[] {
  return msgs.map((m, i) => ({
    id: `m${i}`,
    role: m.role === "user" ? "user" : "assistant",
    parts: [{ type: "text", text: m.text }],
  }));
}

function toolDetail(name: string, output: unknown): string {
  if (output && typeof output === "object") {
    const o = output as Record<string, unknown>;
    if (typeof o.hint === "string") return String(o.hint).slice(0, 160);
    if (o.gates && Array.isArray(o.gates)) {
      return (o.gates as Array<{ gate: string; status: string }>)
        .map((g) => `${g.gate}:${g.status}`)
        .join(" ");
    }
    if (Array.isArray(o.candidates)) return `${o.candidates.length} candidat(s)`;
    if (o.findings && Array.isArray(o.findings)) {
      const errs = o.findings.filter((f: unknown) => (f as { severity: string }).severity === "error").length;
      return errs === 0 ? "0 erreur" : `${errs} erreur(s)`;
    }
    if (typeof o.message === "string") return o.message.slice(0, 160);
    if (o.ok === true) return "OK";
  }
  return "";
}

export async function streamChat(opts: {
  messages: ChatMsgIn[];
  model: string;
  projectId: string;
  clientBoard: Record<string, unknown> | null;
  signal: AbortSignal;
  cb: StreamCallbacks;
}): Promise<{ text: string; runId: string | null }> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: toUIMessages(opts.messages),
      model: opts.model,
      projectId: opts.projectId,
      clientBoard: opts.clientBoard,
    }),
    signal: opts.signal,
  });
  const runId = res.headers.get("X-Run-Id");
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `Chat HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  const toolNames = new Map<string, string>();

  const handleChunk = (chunk: Record<string, unknown>) => {
    const type = chunk.type as string;
    if (type === "text-delta") {
      text += String(chunk.delta ?? "");
      opts.cb.onText(text);
    } else if (type === "tool-input-available") {
      const id = String(chunk.toolCallId ?? "");
      const name = String(chunk.toolName ?? "outil");
      toolNames.set(id, name);
      opts.cb.onToolStart(name, id);
    } else if (type === "tool-output-available") {
      const id = String(chunk.toolCallId ?? "");
      const name = toolNames.get(id) ?? "outil";
      const output = chunk.output as unknown;
      const err = output && typeof output === "object" && (output as Record<string, unknown>).error;
      opts.cb.onToolEnd(name, !err, toolDetail(name, output));
    } else if (type === "tool-input-error") {
      const name = String(chunk.toolName ?? "outil");
      opts.cb.onToolEnd(name, false, String(chunk.errorText ?? "entrée invalide").slice(0, 160));
    } else if (type === "error") {
      opts.cb.onError(String(chunk.errorText ?? "Erreur de stream").slice(0, 300));
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        handleChunk(JSON.parse(payload) as Record<string, unknown>);
      } catch {
        // chunk incomplet : ignoré
      }
    }
  }
  return { text, runId };
}

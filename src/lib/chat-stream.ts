// Client du run agent : envoie le run à POST /api/chat et parse le flux
// UIMessage (SSE `data: {...}`). Sans @ai-sdk/react (dépendance évitée) :
// parseur minimal couvrant texte + cycle de vie des outils + approbations.
// La mémoire inter-runs passe par ici : chaque message agent embarque ses
// parties d'outils (dynamic-tool), renvoyées au run suivant et persistées.
// Les gates H1/H2/export suspendent le run (toolApproval 'user-approval') :
// le stream se termine sur `tool-approval-request`, l'UI affiche la carte,
// puis un second POST reprend le run avec la réponse d'approbation.
"use client";

export interface ToolPartIn {
  toolName: string;
  toolCallId: string;
  input: unknown;
  output?: unknown;
  error?: string;
  /** Réponse d'approbation (reprise H1/H2/export) — renvoyée au run suivant. */
  approval?: { id: string; approved: boolean; reason?: string };
}

export interface ChatMsgIn {
  role: "user" | "agent";
  text: string;
  parts?: ToolPartIn[];
}

export interface ApprovalRequest {
  approvalId: string;
  toolCallId: string;
  toolName: string;
  input: unknown;
  reason?: string;
}

export interface StreamCallbacks {
  onText: (fullText: string) => void;
  onToolStart: (toolName: string, toolCallId: string, input: unknown) => void;
  onToolEnd: (
    toolName: string,
    toolCallId: string,
    ok: boolean,
    detail: string,
    raw: string
  ) => void;
  onApprovalRequest: (approval: ApprovalRequest) => void;
  onError: (message: string) => void;
  onFinish?: (finishReason: string) => void;
}

type UIMessagePartOut =
  | { type: "text"; text: string }
  | {
      type: "dynamic-tool";
      toolName: string;
      toolCallId: string;
      state: "output-available" | "output-error" | "approval-responded";
      input: unknown;
      output?: unknown;
      errorText?: string;
      approval?: { id: string; approved: boolean };
    };

interface UIMessageOut {
  id: string;
  role: "user" | "assistant";
  parts: UIMessagePartOut[];
}

function toUIMessages(msgs: ChatMsgIn[]): UIMessageOut[] {
  return msgs.map((m, i) => {
    const parts: UIMessagePartOut[] = [{ type: "text", text: m.text }];
    if (m.role === "agent" && Array.isArray(m.parts)) {
      for (const p of m.parts.slice(0, 100)) {
        if (!p || typeof p.toolName !== "string" || typeof p.toolCallId !== "string") continue;
        const name = p.toolName.slice(0, 80);
        const id = p.toolCallId.slice(0, 80);
        if (p.approval) {
          parts.push({
            type: "dynamic-tool",
            toolName: name,
            toolCallId: id,
            state: "approval-responded",
            input: p.input ?? null,
            approval: {
              id: p.approval.id.slice(0, 80),
              approved: p.approval.approved,
              ...(typeof p.approval.reason === "string" && p.approval.reason
                ? { reason: p.approval.reason.slice(0, 2000) }
                : {}),
            },
          });
        } else if (typeof p.error === "string") {
          parts.push({
            type: "dynamic-tool",
            toolName: name,
            toolCallId: id,
            state: "output-error",
            input: p.input ?? null,
            errorText: p.error.slice(0, 2000),
          });
        } else {
          parts.push({
            type: "dynamic-tool",
            toolName: name,
            toolCallId: id,
            state: "output-available",
            input: p.input ?? null,
            output: p.output ?? null,
          });
        }
      }
    }
    return { id: `m${i}`, role: m.role === "user" ? "user" : "assistant", parts };
  });
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
    if (typeof o.next === "string") return o.next.slice(0, 160);
    if (typeof o.message === "string") return o.message.slice(0, 160);
    if (o.ok === true) return "OK";
  }
  return "";
}

function rawOf(value: unknown): string {
  try {
    const s = JSON.stringify(value ?? null);
    return s.length > 4000 ? `${s.slice(0, 4000)}\n…[tronqué]` : s;
  } catch {
    return "[non sérialisable]";
  }
}

export async function streamChat(opts: {
  messages: ChatMsgIn[];
  model: string;
  projectId: string;
  clientBoard: Record<string, unknown> | null;
  signal: AbortSignal;
  cb: StreamCallbacks;
}): Promise<{
  text: string;
  runId: string | null;
  parts: ToolPartIn[];
  pendingApproval: ApprovalRequest | null;
  finishReason: string | null;
  streamError: string | null;
}> {
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
  let finishReason: string | null = null;
  let pendingApproval: ApprovalRequest | null = null;
  let streamError: string | null = null;
  const toolNames = new Map<string, string>();
  const toolInputs = new Map<string, unknown>();
  const parts: ToolPartIn[] = [];

  const handleChunk = (chunk: Record<string, unknown>) => {
    const type = chunk.type as string;
    if (type === "text-delta") {
      text += String(chunk.delta ?? "");
      opts.cb.onText(text);
    } else if (type === "tool-input-available") {
      const id = String(chunk.toolCallId ?? "");
      const name = String(chunk.toolName ?? "outil");
      const input = (chunk.input as unknown) ?? null;
      toolNames.set(id, name);
      toolInputs.set(id, input);
      opts.cb.onToolStart(name, id, input);
    } else if (type === "tool-output-available") {
      const id = String(chunk.toolCallId ?? "");
      const name = toolNames.get(id) ?? "outil";
      const output = chunk.output as unknown;
      const err = output && typeof output === "object" && (output as Record<string, unknown>).error;
      parts.push({
        toolName: name,
        toolCallId: id,
        input: toolInputs.get(id) ?? null,
        ...(err ? { error: String(err).slice(0, 2000) } : { output: output ?? null }),
      });
      opts.cb.onToolEnd(name, id, !err, toolDetail(name, output), rawOf(output));
    } else if (type === "tool-input-error") {
      const id = String(chunk.toolCallId ?? "");
      const name = String(chunk.toolName ?? toolNames.get(id) ?? "outil");
      parts.push({
        toolName: name,
        toolCallId: id || `err-${parts.length}`,
        input: toolInputs.get(id) ?? chunk.input ?? null,
        error: String(chunk.errorText ?? "entrée invalide").slice(0, 2000),
      });
      opts.cb.onToolEnd(name, id, false, String(chunk.errorText ?? "entrée invalide").slice(0, 160), rawOf(chunk.input));
    } else if (type === "tool-approval-request") {
      // Le run est suspendu : aucun output ne suivra pour cet appel sans
      // réponse explicite (bouton Approuver/Modifier dans l'UI).
      const id = String(chunk.toolCallId ?? "");
      const approval: ApprovalRequest = {
        approvalId: String(chunk.approvalId ?? ""),
        toolCallId: id,
        toolName: toolNames.get(id) ?? "outil",
        input: toolInputs.get(id) ?? null,
        reason: typeof chunk.reason === "string" ? chunk.reason.slice(0, 300) : undefined,
      };
      pendingApproval = approval;
      opts.cb.onApprovalRequest(approval);
    } else if (type === "tool-output-denied") {
      const id = String(chunk.toolCallId ?? "");
      const name = toolNames.get(id) ?? "outil";
      parts.push({
        toolName: name,
        toolCallId: id,
        input: toolInputs.get(id) ?? null,
        error: "Approbation refusée par l'utilisateur.",
      });
      opts.cb.onToolEnd(name, id, false, "Refusé — en attente de vos modifications", rawOf({ denied: true }));
    } else if (type === "finish") {
      finishReason = typeof chunk.finishReason === "string" ? chunk.finishReason : "stop";
      opts.cb.onFinish?.(finishReason);
    } else if (type === "error") {
      // Le chunk d'erreur AI SDK est générique (« An error occurred ») :
      // on le garde et la page ira chercher le détail dans le registre run.
      streamError = String(chunk.errorText ?? "Erreur de stream").slice(0, 300);
      opts.cb.onError(streamError);
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const splits = buffer.split("\n\n");
    buffer = splits.pop() ?? "";
    for (const part of splits) {
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
  return { text, runId, parts, pendingApproval, finishReason, streamError };
}

"use client";

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  FormEvent,
  ChangeEvent,
  KeyboardEvent,
} from "react";

/** =========================
 *  API Base
 *  ========================= */
const API_BASE = (process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");
const S2X_BASE = `${API_BASE}/s2x`;

const API = {
  health: `${S2X_BASE}/health`,
  upload: `${S2X_BASE}/upload`,
  chat: `${S2X_BASE}/agent/chat`,
  exportPdf: `${S2X_BASE}/export/pdf`,
  exportPptx: `${S2X_BASE}/export/pptx`,
  listConvs: `${S2X_BASE}/agent/conversations`,
  getMsgs: (cid: string) => `${S2X_BASE}/agent/conversations/${cid}/messages`,
};

/** =========================
 *  Types
 *  ========================= */
type RagMode = "file_then_vector" | "vector_only" | "file_only";

type UploadResult = {
  url: string;
  filetype?: string;
  filename?: string;
  text?: string;
  summary?: string;
};

type BackendMsg = {
  role: "user" | "assistant";
  type: "text" | "image" | "file";
  content?: string | null;
  url?: string | null;
  filetype?: string | null;
};

type RagSource = {
  title?: string;
  file?: string;
  file_id?: string;
  url?: string;
  page?: number | string;
  chunk?: number | string;
  snippet?: string;
  score?: number;
  kind?: string;
};

type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  evidence?: RagSource[];
  meta?: { grounded?: boolean };
};

function safeJsonParse(raw: string) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** =========================
 *  Evidence normalization
 *  ========================= */
function normalizeSources(resp: any): RagSource[] {
  if (!resp) return [];
  const direct =
    resp.sources ||
    resp.citations ||
    resp.references ||
    resp.rag?.sources ||
    resp.rag?.citations ||
    resp.result?.sources;

  if (Array.isArray(direct)) {
    return direct.map((s: any) => ({
      title: s.title ?? s.name ?? s.file_name ?? s.filename,
      file: s.file ?? s.file_name ?? s.filename ?? s.title,
      file_id: s.file_id ?? s.id,
      url: s.url ?? s.link,
      page: s.page ?? s.pageno ?? s.page_no,
      chunk: s.chunk ?? s.chunk_id,
      snippet: s.snippet ?? s.text ?? s.content,
      score: typeof s.score === "number" ? s.score : (typeof s.similarity === "number" ? s.similarity : undefined),
      kind: s.kind ?? s.type ?? s.source_type,
    }));
  }

  if (Array.isArray(resp.actions)) {
    const pools: any[] = [];
    for (const a of resp.actions) {
      if (!a) continue;
      if (Array.isArray(a.sources)) pools.push(...a.sources);
      if (Array.isArray(a.citations)) pools.push(...a.citations);
      if (a.type === "sources" && Array.isArray(a.items)) pools.push(...a.items);
    }
    if (pools.length) {
      return pools.map((s: any) => ({
        title: s.title ?? s.name ?? s.file_name ?? s.filename,
        file: s.file ?? s.file_name ?? s.filename ?? s.title,
        file_id: s.file_id ?? s.id,
        url: s.url ?? s.link,
        page: s.page ?? s.pageno ?? s.page_no,
        chunk: s.chunk ?? s.chunk_id,
        snippet: s.snippet ?? s.text ?? s.content,
        score: typeof s.score === "number" ? s.score : (typeof s.similarity === "number" ? s.similarity : undefined),
        kind: s.kind ?? s.type ?? s.source_type,
      }));
    }
  }

  return [];
}

/** =========================
 *  Evidence UI
 *  ========================= */
function EvidenceBlock({ evidence }: { evidence: RagSource[] }) {
  const [open, setOpen] = useState(false);
  const count = evidence?.length ?? 0;

  if (!count) {
    return (
      <div className="mt-2 rounded-xl border px-3 py-2 text-[12px]"
           style={{ borderColor: "rgba(148,163,184,0.35)", backgroundColor: "rgba(148,163,184,0.10)" }}>
        <div className="font-semibold" style={{ color: "rgba(15,23,42,0.85)" }}>
          依據：<span className="text-red-600">本次未提供可追溯來源</span>
        </div>
        <div className="opacity-80 mt-1">
          （這句不是「有依據 RAG」。你可以要求後端必回傳 sources/citations 才算合格。）
        </div>
      </div>
    );
  }

  const copyRefs = async () => {
    const lines = evidence.map((s, i) => {
      const name = s.file || s.title || `source-${i + 1}`;
      const page = s.page !== undefined && s.page !== null ? `p.${s.page}` : "";
      const chunk = s.chunk !== undefined && s.chunk !== null ? `chunk:${s.chunk}` : "";
      const score = typeof s.score === "number" ? `score:${s.score.toFixed(3)}` : "";
      return `[#${i + 1}] ${name} ${page} ${chunk} ${score}`.trim();
    });
    await navigator.clipboard.writeText(lines.join("\n"));
  };

  return (
    <div className="mt-2 rounded-xl border px-3 py-2 text-[12px]"
         style={{ borderColor: "rgba(34,197,94,0.35)", backgroundColor: "rgba(34,197,94,0.10)" }}>
      <div className="flex items-center justify-between gap-2">
        <div className="font-semibold" style={{ color: "rgba(15,23,42,0.88)" }}>
          依據：<span className="text-emerald-700">{count} 筆來源</span>
          <span className="ml-2 opacity-70">（可追溯 / 可驗證）</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={copyRefs}
            className="px-2 py-1 rounded-lg border"
            style={{ borderColor: "rgba(15,23,42,0.15)", backgroundColor: "rgba(255,255,255,0.7)" }}
          >
            複製引用
          </button>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="px-2 py-1 rounded-lg border"
            style={{ borderColor: "rgba(15,23,42,0.15)", backgroundColor: "rgba(255,255,255,0.7)" }}
          >
            {open ? "收合" : "展開"}
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-2 space-y-2">
          {evidence.map((s, idx) => {
            const name = s.file || s.title || `source-${idx + 1}`;
            const meta = [
              s.kind ? `type:${s.kind}` : null,
              s.page !== undefined && s.page !== null ? `p.${s.page}` : null,
              s.chunk !== undefined && s.chunk !== null ? `chunk:${s.chunk}` : null,
              typeof s.score === "number" ? `score:${s.score.toFixed(3)}` : null,
            ].filter(Boolean).join(" · ");

            return (
              <div key={`src-${idx}-${name}`} className="rounded-lg border px-2 py-2"
                   style={{ borderColor: "rgba(15,23,42,0.12)", backgroundColor: "rgba(255,255,255,0.65)" }}>
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold">
                    #{idx + 1} {name}
                  </div>
                  {s.url && (
                    <a className="text-blue-700 underline text-[12px]" href={s.url} target="_blank" rel="noreferrer">
                      開啟
                    </a>
                  )}
                </div>
                {meta && <div className="opacity-70 mt-1">{meta}</div>}
                {s.snippet && (
                  <div className="mt-2 whitespace-pre-wrap leading-relaxed text-[12px] opacity-90">
                    {s.snippet.length > 600 ? s.snippet.slice(0, 600) + "…" : s.snippet}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** =========================
 *  Page
 *  ========================= */
export default function LLMPage() {
  const [healthOk, setHealthOk] = useState<boolean | null>(null);

  const [userId, setUserId] = useState("guest");
  const [sessionId, setSessionId] = useState<string>("test-1");

  const [ragMode, setRagMode] = useState<RagMode>("file_then_vector");

  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [uploaded, setUploaded] = useState<UploadResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const greeting = useMemo<ChatMessage>(() => ({
    id: 1,
    role: "assistant",
    content:
      "嗨，我是 GalaBone LLM。\n" +
      "你可以：\n" +
      "1) 直接問（我會用你已建好的向量資料庫做 RAG，並附來源）\n" +
      "2) 上傳檔案（只做本次摘要/解釋，不建索引、不污染向量庫）\n" +
      "3) 匯出 PDF/PPTX（含引用，老師看了會安靜）",
    meta: { grounded: true },
  }), []);

  const [messages, setMessages] = useState<ChatMessage[]>([greeting]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(API.health);
        setHealthOk(r.ok);
      } catch {
        setHealthOk(false);
      }
    })();
  }, []);

  const msgSeqRef = useRef(1000);
  const nextId = () => Date.now() + (++msgSeqRef.current);

  function addUser(text: string) {
    setMessages((prev) => [...prev, { id: nextId(), role: "user", content: text }]);
  }

  function addAssistant(text: string, evidence?: RagSource[]) {
    const grounded = !!(evidence && evidence.length);
    setMessages((prev) => [...prev, { id: nextId(), role: "assistant", content: text, evidence, meta: { grounded } }]);
  }

  function toBackendMessages(uiMsgs: ChatMessage[]): BackendMsg[] {
    return uiMsgs.map((m) => ({
      role: m.role,
      type: "text",
      content: m.content,
      url: null,
      filetype: null,
    }));
  }

  async function uploadFile(file: File) {
    setErrorMsg(null);
    setLoading(true);

    try {
      const fd = new FormData();
      fd.append("file", file);

      const res = await fetch(API.upload, { method: "POST", body: fd });
      const raw = await res.text();
      const data = safeJsonParse(raw);

      if (!res.ok || !data) {
        throw new Error(`上傳失敗 ${res.status}：${raw.slice(0, 200)}`);
      }

      setUploaded({
        url: data.url,
        filetype: data.filetype,
        filename: data.filename || file.name,
        text: data.text,
        summary: data.summary,
      });

      const hint =
        `✅ 已上傳檔案：${data.filename || file.name}\n` +
        `（只做本次對話參考，不建立索引、不寫入向量庫）\n` +
        (data.summary ? `\n摘要：\n${String(data.summary).slice(0, 600)}${String(data.summary).length > 600 ? "…" : ""}` : "");

      addAssistant(hint, []);
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function callChat(question: string) {
    setErrorMsg(null);
    setLoading(true);

    try {
      const needFile = ragMode !== "vector_only" && uploaded?.url;
      const needVector = ragMode !== "file_only";

      const fileHint = needFile
        ? `\n\n---\n【已上傳檔案（僅本次使用，不建索引）】${uploaded?.filename || "uploaded"}\n【file_url】${uploaded?.url}\n` +
          (uploaded?.summary ? `【file_summary】${String(uploaded.summary).slice(0, 200)}${String(uploaded.summary).length > 200 ? "…" : ""}\n` : "")
        : "";

      const vectorHint = needVector
        ? `\n\n---\n【RAG】請用既有教材向量庫檢索後回答，並附 sources（檔名/頁碼或chunk/score）。找不到就說找不到。`
        : "";

      const prompt =
        question +
        (ragMode === "file_then_vector" ? fileHint + vectorHint : ragMode === "vector_only" ? vectorHint : fileHint);

      const payload = {
        session_id: sessionId.trim(),
        user_id: userId.trim() || "guest",
        messages: [{ role: "user", type: "text", content: prompt } satisfies BackendMsg],
      };

      const r = await fetch(API.chat, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const raw = await r.text();
      const data = safeJsonParse(raw);

      if (!r.ok || !data) {
        throw new Error(`chat 失敗 ${r.status}：${raw.slice(0, 300)}`);
      }

      const sources = normalizeSources(data);

      if (data.answer || data.content || data.message) {
        addAssistant(String(data.answer ?? data.content ?? data.message), sources);
        return;
      }

      if (Array.isArray(data.messages)) {
        const last = [...data.messages].reverse().find((m: any) => m?.role === "assistant" && (m?.content ?? "").trim());
        if (last) {
          addAssistant(String(last.content), sources);
          return;
        }
      }

      addAssistant(raw.slice(0, 1200), sources);

      if (!sources.length) {
        setErrorMsg((prev) => prev ?? "⚠️ 本次回覆未回傳 sources/citations，無法主張為「有依據 RAG」。");
      }
    } finally {
      setLoading(false);
    }
  }

  async function sendMessage(e?: FormEvent) {
    if (e) e.preventDefault();
    const q = input.trim();
    if (!q || loading) return;

    setInput("");
    addUser(q);

    try {
      await callChat(q);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      setErrorMsg(msg);
      addAssistant(
        "⚠️ 後端沒有正常回覆。\n" +
          "你可以檢查：\n" +
          `- backend: ${API_BASE}\n` +
          `- /s2x/agent/chat 是否吃你送的 body（session_id/user_id/messages）\n` +
          `- 422/500 的 detail（貼 log 我就能一槍斃命）`,
        []
      );
    }
  }

  function onInputChange(e: ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  }

  async function exportFile(kind: "pdf" | "pptx") {
    setErrorMsg(null);
    setLoading(true);

    try {
      const url = kind === "pdf" ? API.exportPdf : API.exportPptx;

      // ✅ 你現在後端 422 明確說缺 messages，所以匯出必送 messages
      const payload = {
        session_id: sessionId.trim(),
        user_id: userId.trim() || "guest",
        messages: toBackendMessages(messages),
      };

      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!r.ok) {
        const t = await r.text();
        throw new Error(`匯出失敗：${t.slice(0, 250)}`);
      }

      const blob = await r.blob();
      const dlName = kind === "pdf" ? "GalaBone_Report.pdf" : "GalaBone_Report.pptx";

      const a = document.createElement("a");
      const objUrl = URL.createObjectURL(blob);
      a.href = objUrl;
      a.download = dlName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);

      addAssistant(`✅ 已匯出 ${dlName}（含對話重點與引用來源）。`, []);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="h-[calc(100vh-4rem)] flex overflow-hidden" style={{ backgroundColor: "#f8fafc" }}>
      {/* Sidebar */}
      <aside className="w-80 border-r flex flex-col" style={{ borderColor: "rgba(15,23,42,0.08)", backgroundColor: "#ffffff" }}>
        <div className="px-4 pt-4 pb-3 border-b" style={{ borderColor: "rgba(15,23,42,0.08)" }}>
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-full flex items-center justify-center font-bold text-white" style={{ background: "#0ea5e9" }}>
              G
            </div>
            <div>
              <div className="text-lg font-semibold">GalaBone</div>
              <div className="text-[11px] opacity-70">Your Bone We Care</div>
            </div>
          </div>

          <div className="mt-3 text-[12px]">
            S2X health:{" "}
            <span className={`font-semibold ${healthOk ? "text-emerald-600" : "text-red-600"}`}>
              {healthOk === null ? "checking..." : healthOk ? "OK" : "FAIL"}
            </span>
          </div>

          <div className="mt-3 space-y-2">
            <label className="flex flex-col gap-1 text-[12px]">
              <span className="text-slate-600">user_id（一般使用者預設 guest）</span>
              <input
                className="rounded-lg px-3 py-2 border outline-none"
                style={{ borderColor: "rgba(15,23,42,0.12)" }}
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
              />
            </label>

            <label className="flex flex-col gap-1 text-[12px]">
              <span className="text-slate-600">session_id（legacy 必填）</span>
              <input
                className="rounded-lg px-3 py-2 border outline-none"
                style={{ borderColor: "rgba(15,23,42,0.12)" }}
                value={sessionId}
                onChange={(e) => setSessionId(e.target.value)}
              />
            </label>

            <label className="flex flex-col gap-1 text-[12px]">
              <span className="text-slate-600">RAG 模式（不會建立索引）</span>
              <select
                className="rounded-lg px-3 py-2 border outline-none bg-white"
                style={{ borderColor: "rgba(15,23,42,0.12)" }}
                value={ragMode}
                onChange={(e) => setRagMode(e.target.value as RagMode)}
              >
                <option value="file_then_vector">先用上傳檔案 → 不足再查向量庫</option>
                <option value="vector_only">只查向量庫（你做好的教材庫）</option>
                <option value="file_only">只用上傳檔案（不查向量庫）</option>
              </select>
            </label>

            <div className="text-[11px] opacity-70">
              backend: <span className="font-mono">{API_BASE}</span>
              <br />
              s2x: <span className="font-mono">{S2X_BASE}</span>
            </div>
          </div>
        </div>

        <div className="px-4 py-3 border-b" style={{ borderColor: "rgba(15,23,42,0.08)" }}>
          <div className="text-[12px] font-semibold">工具</div>

          <div className="mt-2 flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.txt,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadFile(f);
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-3 py-2 rounded-xl border text-[12px] font-semibold"
              style={{ borderColor: "rgba(15,23,42,0.12)", backgroundColor: "rgba(148,163,184,0.12)" }}
              disabled={loading}
            >
              上傳檔案（不建索引）
            </button>

            <button
              type="button"
              onClick={() => void exportFile("pdf")}
              className="px-3 py-2 rounded-xl border text-[12px] font-semibold"
              style={{ borderColor: "rgba(15,23,42,0.12)", backgroundColor: "rgba(99,102,241,0.14)" }}
              disabled={loading}
            >
              匯出 PDF
            </button>

            <button
              type="button"
              onClick={() => void exportFile("pptx")}
              className="px-3 py-2 rounded-xl border text-[12px] font-semibold"
              style={{ borderColor: "rgba(15,23,42,0.12)", backgroundColor: "rgba(99,102,241,0.14)" }}
              disabled={loading}
            >
              匯出 PPTX
            </button>
          </div>

          <div className="mt-2 text-[11px] opacity-70">
            ⚠️ 這裡上傳的檔案只做「本次對話」摘要/解釋，不會寫入你的向量資料庫（不污染）。
          </div>

          {uploaded?.filename && (
            <div className="mt-2 text-[11px]">
              目前檔案：<span className="font-semibold">{uploaded.filename}</span>
            </div>
          )}
        </div>

        <div className="px-4 py-3 text-[12px]">
          <div className="font-semibold">老師閉嘴模式 checklist</div>
          <ul className="mt-2 list-disc pl-5 opacity-80 space-y-1">
            <li>每個回答都有來源清單（檔名/頁碼/chunk/score）</li>
            <li>可展開 snippet，能對照原文</li>
            <li>可匯出 PDF/PPTX，引用一起帶走</li>
            <li>沒有 sources 就標示「不主張有依據」</li>
          </ul>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 min-h-0 flex flex-col px-6 py-6 gap-3 overflow-hidden">
        <div className="flex items-center justify-between text-[12px] opacity-80">
          <div className="font-semibold">LLM Console（/s2x）</div>
          {errorMsg && <div className="text-red-600 whitespace-pre-wrap max-w-[70%]">{errorMsg}</div>}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-1">
          {messages.map((m) => {
            const isUser = m.role === "user";
            const bubbleBg = isUser ? "#0ea5e9" : "rgba(15,23,42,0.75)";
            const bubbleColor = "#ffffff";

            return (
              <div key={m.id} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                <div className="max-w-[88%] rounded-2xl px-3 py-2 whitespace-pre-wrap break-words leading-relaxed"
                     style={{ backgroundColor: bubbleBg, color: bubbleColor }}>
                  <div>{m.content}</div>
                  {!isUser && <EvidenceBlock evidence={m.evidence ?? []} />}
                </div>
              </div>
            );
          })}

          {loading && (
            <div className="flex justify-start">
              <div className="rounded-2xl px-3 py-2 text-[12px]"
                   style={{ backgroundColor: "rgba(15,23,42,0.65)", color: "#fff" }}>
                正在檢索與生成中…
              </div>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        <form onSubmit={sendMessage} className="pt-2">
          <div className="flex items-end gap-3">
            <textarea
              value={input}
              onChange={onInputChange}
              onKeyDown={onKeyDown}
              placeholder={
                uploaded?.filename
                  ? `提出問題…（可先用你上傳的檔案：${uploaded.filename}，也可切換向量庫 RAG）`
                  : "提出問題…（會用你已建好的向量庫 RAG，並附來源）"
              }
              className="flex-1 rounded-2xl border px-4 py-3 outline-none resize-none"
              style={{ borderColor: "rgba(15,23,42,0.12)", backgroundColor: "#fff" }}
              rows={2}
            />
            <button
              type="submit"
              disabled={!input.trim() || loading}
              className="h-11 px-5 rounded-2xl font-semibold text-white disabled:opacity-60"
              style={{ background: "linear-gradient(135deg,#0ea5e9,#22c55e)" }}
            >
              送出
            </button>
          </div>

          <div className="mt-2 text-[11px] opacity-70">
            Enter 送出，Shift+Enter 換行。回覆若無來源，系統會明確標示「不主張有依據」。
          </div>
        </form>
      </div>
    </div>
  );
}

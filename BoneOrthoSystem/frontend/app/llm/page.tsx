// frontend/app/llm/page.tsx
"use client";

import {
  FormEvent,
  KeyboardEvent,
  ChangeEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "next/navigation";

/** =========================
 * Types
 * ========================= */
type BackendMsg = {
  role: "user" | "assistant";
  type: "text" | "image";
  content?: string | null;
  url?: string | null;
  filetype?: string | null;
};

type UiMessage = {
  id: number;
  role: "user" | "assistant";
  type: "text" | "image" | "file";
  content?: string;
  url?: string | null;
  filetype?: string | null;
  filename?: string | null;
};

type ConversationItem = {
  conversation_id: string;
  title?: string | null;
  updated_at?: string | null;
};

const MIN_HEIGHT = 28;
const MAX_HEIGHT = 120;

const API_BASE = (
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000"
).replace(/\/+$/, "");

// ✅ legacy app mount：/s2x
const S2X_BASE = `${API_BASE}/s2x`;

// ✅ Swagger：/s2x/upload（回傳 url + text + summary）
const S2X_UPLOAD_URL = `${S2X_BASE}/upload`;

// ✅ Swagger：/s2x/agent/chat
const S2X_CHAT_URL = `${S2X_BASE}/agent/chat`;

// ✅ Swagger：/s2x/agent/conversations...
const S2X_LIST_CONV_URL = `${S2X_BASE}/agent/conversations`;
const S2X_CREATE_CONV_URL = `${S2X_BASE}/agent/conversations`;

// ✅ Swagger：/s2x/export/pdf、/s2x/export/pptx
const S2X_EXPORT_PDF_URL = `${S2X_BASE}/export/pdf`;
const S2X_EXPORT_PPTX_URL = `${S2X_BASE}/export/pptx`;

// （保留）從 S1 帶入的 bootstrap
const BOOT_URL = `${API_BASE}/s2/agent/bootstrap-from-s1`;
const ENSURE_TITLE_URL = `${API_BASE}/s2/agent/ensure-title`;

/** =========================
 * Utils
 * ========================= */
function msgKey(m: { role: string; type: string; content?: string; url?: any }) {
  return `${m.role}|${m.type}|${(m.content ?? "").trim()}|${m.url ?? ""}`;
}

async function fetchJsonOrThrow(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const ct = res.headers.get("content-type") || "";
  const raw = await res.text();

  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}：${raw.slice(0, 300)}`);
  }
  if (!ct.includes("application/json")) {
    throw new Error(`回傳不是 JSON：${raw.slice(0, 200)}`);
  }
  return JSON.parse(raw);
}

async function postJsonTry(url: string, payloads: any[]) {
  let lastErr: any = null;

  for (const payload of payloads) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const ct = res.headers.get("content-type") || "";
      const raw = await res.text();

      if (!res.ok) throw new Error(`HTTP ${res.status}: ${raw.slice(0, 250)}`);

      if (ct.includes("application/json")) {
        return { kind: "json" as const, data: JSON.parse(raw), res };
      }

      // 可能是 binary (pdf/pptx)
      return { kind: "binary" as const, data: raw, res };
    } catch (e: any) {
      lastErr = e;
      continue;
    }
  }

  throw lastErr ?? new Error("所有 payload 都失敗");
}

/**
 * ✅ 修正重點：
 * legacy /s2x/upload 回傳 url 可能是 "/uploads/xxx.pdf"
 * 但 mount 後變 "/s2x/uploads/xxx.pdf"
 */
function toS2xAbsoluteUrl(maybeUrl?: string | null) {
  if (!maybeUrl) return null;
  if (maybeUrl.startsWith("http://") || maybeUrl.startsWith("https://"))
    return maybeUrl;

  const path = maybeUrl.startsWith("/") ? maybeUrl : `/${maybeUrl}`;

  if (path.startsWith("/uploads/")) {
    return `${API_BASE}/s2x${path}`;
  }
  if (path.startsWith("/public/")) {
    return `${API_BASE}${path}`;
  }
  return `${API_BASE}${path}`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export default function LLMPage() {
  const searchParams = useSearchParams();
  const lastSentExpandedRef = useRef<string>("");


  const greeting: UiMessage = useMemo(
    () => ({
      id: 1,
      role: "assistant",
      type: "text",
      content:
        "嗨，我是 GalaBone LLM。\n你可以：\n- 直接聊天（盡量有依據）\n- 上傳檔案（讀內容＋摘要，不會建立索引、不會汙染向量資料庫）\n- 匯出 PDF / PPTX 把內容帶走",
    }),
    []
  );

  const [messages, setMessages] = useState<UiMessage[]>([greeting]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [userId, setUserId] = useState("guest");
  const [conversationId, setConversationId] = useState<string>("");
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [loadingConvs, setLoadingConvs] = useState(false);

  const [showToolMenu, setShowToolMenu] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);

  // 上傳檔案 context（不建索引：只在前端存）
  const [activeFile, setActiveFile] = useState<{
    urlRel: string;
    urlAbs: string;
    filename: string;
    filetype: string;
    text?: string;
    summary?: string;
  } | null>(null);

  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const msgSeqRef = useRef(1000);
  const nextId = () => {
    msgSeqRef.current += 1;
    return Date.now() + msgSeqRef.current;
  };

  const baseHeightRef = useRef<number | null>(null);
  const [isMultiLine, setIsMultiLine] = useState(false);
  const [inputBoxHeight, setInputBoxHeight] = useState(MIN_HEIGHT);

  const pinnedSeedRef = useRef<UiMessage[]>([]);
  const hiddenMsgKeysRef = useRef<Set<string>>(new Set());

  function autoResizeTextarea() {
    const el = inputRef.current;
    if (!el) return;

    const text = el.value;
    if (text.trim().length === 0) {
      baseHeightRef.current = null;
      el.style.height = `${MIN_HEIGHT}px`;
      setIsMultiLine(false);
      setInputBoxHeight(MIN_HEIGHT);
      return;
    }

    el.style.height = "auto";
    const contentHeight = el.scrollHeight;

    if (!isMultiLine) {
      if (baseHeightRef.current === null) baseHeightRef.current = contentHeight;
      const singleLineHeight = baseHeightRef.current;
      if (contentHeight > singleLineHeight + 2) setIsMultiLine(true);
      el.style.height = `${MIN_HEIGHT}px`;
      setInputBoxHeight(MIN_HEIGHT);
      return;
    }

    const newHeight = Math.min(contentHeight, MAX_HEIGHT);
    el.style.height = `${newHeight}px`;
    setInputBoxHeight(newHeight);
  }

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    autoResizeTextarea();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** =========================
   * Conversation APIs (S2X)
   * ========================= */
  async function refreshConversationList() {
    if (!userId.trim()) return;
    setLoadingConvs(true);
    try {
      const url = `${S2X_LIST_CONV_URL}?user_id=${encodeURIComponent(
        userId.trim()
      )}`;
      const data = await fetchJsonOrThrow(url);

      const list: any[] = Array.isArray(data) ? data : data?.conversations ?? [];
      const mapped: ConversationItem[] = (list || [])
        .map((x) => ({
          conversation_id:
            x.conversation_id ?? x.id ?? x.session_id ?? x.conversationId ?? "",
          title: x.title ?? x.name ?? null,
          updated_at: x.updated_at ?? x.updatedAt ?? null,
        }))
        .filter((x) => x.conversation_id);

      setConversations(mapped);
    } catch (e: any) {
      setErrorMsg(`載入聊天室失敗：${e?.message ?? e}`);
    } finally {
      setLoadingConvs(false);
    }
  }

  async function createConversation() {
    setErrorMsg(null);
    if (!userId.trim()) {
      setErrorMsg("user_id 不能空。");
      return;
    }

    const r = await postJsonTry(S2X_CREATE_CONV_URL, [
      { user_id: userId.trim() },
      { userId: userId.trim() },
      { user_id: userId.trim(), title: "新對話" },
    ]);

    if (r.kind !== "json") throw new Error("建立聊天室回傳不是 JSON");

    const data: any = r.data;
    const id =
      data?.conversation_id ??
      data?.id ??
      data?.session_id ??
      data?.conversationId;

    if (!id)
      throw new Error(
        `建立聊天室回傳缺 id：${JSON.stringify(data).slice(0, 200)}`
      );

    setConversationId(String(id));
    setMessages([greeting]);
    setActiveFile(null);
    await refreshConversationList();
  }

  async function loadConversationMessages(convId: string) {
    setErrorMsg(null);
    if (!convId) return;

    const url = `${S2X_BASE}/agent/conversations/${encodeURIComponent(
      convId
    )}/messages`;
    const data = await fetchJsonOrThrow(url);

    const list: any[] = Array.isArray(data) ? data : data?.messages ?? [];
    const ui: UiMessage[] = [greeting];

    for (const m of list) {
      const role: "user" | "assistant" =
        m.role === "assistant" ? "assistant" : "user";
      const type = m.type === "image" ? "image" : "text";
      const content = (m.content ?? m.text ?? "") as string;
      const urlRel = (m.url ?? null) as string | null;
      const urlAbs = urlRel ? toS2xAbsoluteUrl(urlRel) : null;

      ui.push({
        id: nextId(),
        role,
        type,
        content,
        url: urlAbs,
      });
    }

    pinnedSeedRef.current = [];
    setMessages(ui);
  }

  useEffect(() => {
    refreshConversationList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setTimeout(() => refreshConversationList(), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  /** =========================
   * Bootstrap from S1 (保留)
   * ========================= */
  function mapBackendToUi(serverMsgs: BackendMsg[]) {
    return (serverMsgs || []).map((m) => {
      const absUrl = toS2xAbsoluteUrl(m.url ?? null);
      return {
        id: nextId(),
        role: m.role,
        type: m.type,
        content: (m.content ?? "") as string,
        url: absUrl,
        filetype: m.filetype ?? null,
      } as UiMessage;
    });
  }

  function applyBackendMessages(serverMsgs: BackendMsg[]) {
    const mapped = mapBackendToUi(serverMsgs);

    setMessages((prev) => {
      const pinned = pinnedSeedRef.current || [];
      const result: UiMessage[] = [];
      const seen = new Set<string>();

      const pushIfOk = (m: UiMessage) => {
        const k = msgKey(m);
        if (hiddenMsgKeysRef.current.has(k)) return;
        if (seen.has(k)) return;
        seen.add(k);
        result.push(m);
      };

      pushIfOk(greeting);
      for (const p of pinned) pushIfOk(p);
      for (const m of prev) pushIfOk(m);
      for (const m of mapped) pushIfOk(m);
      return result;
    });
  }

  async function ensureConversationTitle(
    conversation_id: string,
    image_case_id: number
  ) {
    const res = await fetch(ENSURE_TITLE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversation_id, image_case_id }),
    });
    const ct = res.headers.get("content-type") || "";
    const raw = await res.text();
    if (!res.ok)
      throw new Error(`ensure-title 失敗 ${res.status}：${raw.slice(0, 200)}`);
    if (!ct.includes("application/json"))
      throw new Error(`ensure-title 回傳不是 JSON：${raw.slice(0, 200)}`);
  }

  const bootOnceRef = useRef(false);
  useEffect(() => {
    const caseIdStr = searchParams.get("caseId");
    if (!caseIdStr) return;
    if (bootOnceRef.current) return;
    bootOnceRef.current = true;

    const caseId = Number(caseIdStr);
    if (!Number.isFinite(caseId) || caseId <= 0) {
      setErrorMsg(`caseId 不合法：${caseIdStr}`);
      return;
    }

    (async () => {
      setErrorMsg(null);
      setLoading(true);

      try {
        const r = await fetch(BOOT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image_case_id: caseId }),
        });

        const rCt = r.headers.get("content-type") || "";
        const rRaw = await r.text();

        if (!r.ok)
          throw new Error(`bootstrap 失敗 ${r.status}：${rRaw.slice(0, 300)}`);
        if (!rCt.includes("application/json"))
          throw new Error(`bootstrap 回傳不是 JSON：${rRaw.slice(0, 200)}`);

        const boot = JSON.parse(rRaw) as {
          session_id: string;
          seed_messages: BackendMsg[];
        };

        if (!boot?.session_id || !Array.isArray(boot.seed_messages)) {
          throw new Error(
            `bootstrap 回傳格式不對：${JSON.stringify(boot).slice(0, 200)}`
          );
        }

        setConversationId(boot.session_id);

        const seedUi = mapBackendToUi(boot.seed_messages);
        pinnedSeedRef.current = seedUi;
        setMessages([greeting, ...seedUi]);

        try {
          await ensureConversationTitle(boot.session_id, caseId);
        } catch (e: any) {
          console.warn(e);
        }
      } catch (err: any) {
        setErrorMsg(err?.message ?? "自動帶入失敗");
      } finally {
        setLoading(false);
      }
    })();
  }, [searchParams, greeting]);

  /** =========================
   * Chat (S2X /agent/chat)
   * ========================= */
  async function postChat(userText: string) {
    const batch: BackendMsg[] = [
      { role: "user", type: "text", content: userText },
    ];

    const payloads = [
      {
        session_id: conversationId || "guest",
        messages: batch,
        user_id: userId,
        conversation_id: conversationId || null,
      },
      {
        conversation_id: conversationId || null,
        user_id: userId,
        messages: batch,
      },
      {
        conversation_id: conversationId || null,
        user_id: userId,
        content: userText,
      },
    ];

    const r = await postJsonTry(S2X_CHAT_URL, payloads);
    if (r.kind !== "json") throw new Error("chat 回傳不是 JSON");

    const data: any = r.data;

    if (Array.isArray(data?.messages)) {
      applyBackendMessages(data.messages as BackendMsg[]);
      return;
    }

    const reply =
      data?.reply ??
      data?.answer ??
      data?.content ??
      (typeof data === "string" ? data : null);

    if (reply) {
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: "assistant",
          type: "text",
          content: String(reply),
        },
      ]);
      return;
    }

    setMessages((prev) => [
      ...prev,
      {
        id: nextId(),
        role: "assistant",
        type: "text",
        content: `⚠️ chat 回傳格式我看不懂：${JSON.stringify(data).slice(
          0,
          200
        )}`,
      },
    ]);
  }

  async function sendMessage(e?: FormEvent) {
    if (e) e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    setErrorMsg(null);

    const maxChars = 12000;
    const withFileContext =
      activeFile?.text && activeFile.text.trim().length > 0
        ? `${text}\n\n---\n【你剛上傳的檔案：${activeFile.filename}】\n【檔案內容節錄（用於回答依據，不會建立索引）】\n${activeFile.text.slice(
            0,
            maxChars
          )}${activeFile.text.length > maxChars ? "\n…（已省略後段）" : ""}`
        : text;

    setMessages((prev) => [
      ...prev,
      { id: nextId(), role: "user", type: "text", content: text },
    ]);
    setInput("");

    if (inputRef.current) {
      const el = inputRef.current;
      el.value = "";
      el.style.height = `${MIN_HEIGHT}px`;
      el.scrollTop = 0;
    }
    baseHeightRef.current = null;
    setIsMultiLine(false);
    setInputBoxHeight(MIN_HEIGHT);


    // ✅ 只顯示使用者短句，但「送去後端的 expanded 內容」不要回灌到 UI
lastSentExpandedRef.current = (withFileContext ?? "").trim();
hiddenMsgKeysRef.current.add(
  msgKey({ role: "user", type: "text", content: lastSentExpandedRef.current, url: null })
);



    setLoading(true);
    try {
      if (!conversationId) {
        await createConversation();
      }
      await postChat(withFileContext);
      await refreshConversationList();
    } catch (e2: any) {
      setErrorMsg(e2?.message ?? "呼叫後端失敗");
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: "assistant",
          type: "text",
          content:
            "⚠️ 後端暫時沒回來或 API 路徑不對。\n請直接看 swagger 確認 /s2x/agent/chat 是否存在。",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function handleInputChange(e: ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    autoResizeTextarea();
  }

  /** =========================
   * Upload file (S2X /upload)
   * - 不建索引
   * - 直接回 text + summary
   * ========================= */
  async function handlePickAndUploadFile(file: File) {
    setUploadingFile(true);
    setErrorMsg(null);

    try {
      const fd = new FormData();
      fd.append("file", file);

      const res = await fetch(S2X_UPLOAD_URL, { method: "POST", body: fd });
      const ct = res.headers.get("content-type") || "";
      const raw = await res.text();

      if (!res.ok)
        throw new Error(`上傳失敗 ${res.status}：${raw.slice(0, 300)}`);
      if (!ct.includes("application/json"))
        throw new Error(`上傳回傳非 JSON：${raw.slice(0, 200)}`);

      const data = JSON.parse(raw) as {
        url: string;
        filetype?: string;
        filename?: string;
        text?: string;
        summary?: string;
      };

      const urlRel = data.url;
      const urlAbs = toS2xAbsoluteUrl(urlRel) || "";

      const filename = data.filename || file.name;
      const filetype = data.filetype || file.type || "bin";

      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: "user",
          type: "file",
          filename,
          filetype,
          url: urlAbs,
          content: "",
        },
      ]);

      if (data.summary && data.summary.trim()) {
        setMessages((prev) => [
          ...prev,
          {
            id: nextId(),
            role: "assistant",
            type: "text",
            content: `📄 我讀完了：${filename}\n\n【摘要】\n${(data.summary ?? "").trim()}\n\n你可以直接問我「這份文件在講什麼？」或「幫我解釋某段」。`,
          },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            id: nextId(),
            role: "assistant",
            type: "text",
            content:
              "📄 檔案上傳成功，但後端沒有回 summary。你直接問我，我會用內容回答。",
          },
        ]);
      }

      setActiveFile({
        urlRel,
        urlAbs,
        filename,
        filetype,
        text: data.text || "",
        summary: data.summary || "",
      });
    } catch (e: any) {
      setErrorMsg(e?.message ?? "檔案上傳失敗");
    } finally {
      setUploadingFile(false);
      setShowToolMenu(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  /** =========================
   * Export (S2X /export/pdf, /export/pptx)
   * ========================= */
  async function handleExport(kind: "pdf" | "pptx") {
    setShowExportMenu(false);
    setErrorMsg(null);

    if (!conversationId) {
      setErrorMsg("目前沒有 conversation_id，無法匯出（先聊幾句或先建新對話）。");
      return;
    }

    setLoading(true);
    try {
      const url = kind === "pdf" ? S2X_EXPORT_PDF_URL : S2X_EXPORT_PPTX_URL;

      const payloads = [
        { conversation_id: conversationId, user_id: userId },
        { conversation_id: conversationId },
        { session_id: conversationId, user_id: userId },
        { session_id: conversationId },
      ];

      let okRes: Response | null = null;

      for (const p of payloads) {
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(p),
        });
        if (r.ok) {
          okRes = r;
          break;
        }
      }

      if (!okRes) throw new Error("匯出失敗：所有 payload 都不吃（看後端 request body）");

      const ct = okRes.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        const j: any = await okRes.json();
        const fileUrl = j?.url ?? j?.file_url ?? j?.download_url ?? null;
        if (!fileUrl)
          throw new Error(`匯出成功但沒回 url：${JSON.stringify(j).slice(0, 200)}`);
        const abs = toS2xAbsoluteUrl(fileUrl);
        if (abs) window.open(abs, "_blank");
        return;
      }

      const blob = await okRes.blob();
      downloadBlob(
        blob,
        kind === "pdf"
          ? `GalaBone_${conversationId}.pdf`
          : `GalaBone_${conversationId}.pptx`
      );
    } catch (e: any) {
      setErrorMsg(e?.message ?? "匯出失敗");
    } finally {
      setLoading(false);
    }
  }

  /** =========================
   * Render
   * ========================= */
  return (
    <div
      className="h-[calc(100vh-4rem)] flex overflow-hidden"
      style={{ backgroundColor: "var(--background)", color: "var(--foreground)" }}
    >
      {/* Left */}
      <aside
        className="w-72 border-r flex flex-col"
        style={{
          backgroundColor: "var(--background)",
          borderColor: "var(--navbar-border)",
          color: "var(--navbar-text)",
        }}
      >
        <div
          className="px-4 pt-4 pb-3 border-b flex flex-col gap-3"
          style={{ borderColor: "var(--navbar-border)" }}
        >
          <div>
            <h1 className="text-lg font-semibold tracking-wide">GalaBone</h1>
            <p className="text-[11px] mt-1 opacity-70">Your Bone We Care</p>
          </div>

          <label className="flex flex-col gap-1 text-[11px] opacity-80">
            <span>user_id（一般使用者預設 guest）</span>
            <input
              className="rounded-md px-2 py-[6px] text-[11px] outline-none border"
              style={{
                backgroundColor: "var(--background)",
                color: "var(--foreground)",
                borderColor: "var(--navbar-border)",
              }}
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="guest"
            />
          </label>

          <label className="flex flex-col gap-1 text-[11px] opacity-80">
            <span>conversation_id（可留空，會自動建立）</span>
            <input
              className="rounded-md px-2 py-[6px] text-[11px] outline-none border"
              style={{
                backgroundColor: "var(--background)",
                color: "var(--foreground)",
                borderColor: "var(--navbar-border)",
              }}
              value={conversationId}
              onChange={(e) => setConversationId(e.target.value)}
              placeholder="（留空會自動建立）"
            />
          </label>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={refreshConversationList}
              className="flex-1 rounded-lg px-3 py-2 text-[11px] font-semibold border"
              style={{
                borderColor: "var(--navbar-border)",
                backgroundColor: "rgba(148,163,184,0.10)",
              }}
              disabled={loadingConvs}
            >
              {loadingConvs ? "載入中…" : "載入歷史"}
            </button>

            <button
              type="button"
              onClick={() => createConversation().catch((e) => setErrorMsg(String(e?.message ?? e)))}
              className="flex-1 rounded-lg px-3 py-2 text-[11px] font-semibold border"
              style={{
                borderColor: "var(--navbar-border)",
                backgroundColor: "rgba(99,102,241,0.14)",
              }}
            >
              新對話
            </button>
          </div>

          <div className="text-[11px] opacity-70 space-y-1">
            <div>
              backend: <span className="font-mono">{API_BASE}</span>
            </div>
            <div>
              s2x: <span className="font-mono">{S2X_BASE}</span>
            </div>
          </div>
        </div>

        <div className="px-4 py-3 border-b" style={{ borderColor: "var(--navbar-border)" }}>
          <div className="text-[11px] opacity-70 mb-2">聊天室列表</div>
          <div className="max-h-[240px] overflow-y-auto space-y-2 pr-1">
            {conversations.length === 0 ? (
              <div className="text-[11px] opacity-60">（目前沒有聊天室）</div>
            ) : (
              conversations.map((c) => (
                <button
                  key={c.conversation_id}
                  type="button"
                  onClick={() => {
                    setConversationId(c.conversation_id);
                    loadConversationMessages(c.conversation_id).catch((e) =>
                      setErrorMsg(String(e?.message ?? e))
                    );
                  }}
                  className="w-full text-left rounded-lg px-3 py-2 border text-[11px]"
                  style={{
                    borderColor: "var(--navbar-border)",
                    backgroundColor:
                      c.conversation_id === conversationId
                        ? "rgba(56,189,248,0.10)"
                        : "rgba(148,163,184,0.06)",
                  }}
                >
                  <div className="font-semibold truncate">
                    {c.title?.trim()
                      ? c.title
                      : `聊天室 ${c.conversation_id.slice(0, 8)}…`}
                  </div>
                  <div className="opacity-60 font-mono truncate">
                    {c.conversation_id}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <nav className="flex-1 px-3 pt-4 pb-2 space-y-3 text-sm">
          <div className="text-[11px] opacity-70">
            ✅ 檔案上傳：<span className="font-mono">/s2x/upload</span>
          </div>
          <div className="text-[11px] opacity-70">
            ✅ 聊天：<span className="font-mono">/s2x/agent/chat</span>
          </div>
          <div className="text-[11px] opacity-70">
            ✅ 匯出：<span className="font-mono">/s2x/export/pdf</span> /{" "}
            <span className="font-mono">/s2x/export/pptx</span>
          </div>
          <div className="text-[11px] opacity-70">
            ⚠️ 這頁不做建索引（不會汙染你的向量資料庫）。
          </div>
        </nav>
      </aside>

      {/* Right */}
      <div className="flex-1 min-h-0 flex flex-col px-6 py-6 gap-4 overflow-hidden">
        <section className="flex-1 min-h-0 flex flex-col relative">
          <div className="flex items-center justify-between mb-2 text-xs opacity-70 px-1">
            <span>LLM Console（/s2x）</span>
            {errorMsg ? (
              <span className="text-red-400 whitespace-pre-wrap">{errorMsg}</span>
            ) : null}
          </div>

          <div
            className="chat-scroll flex-1 min-h-0 overflow-y-auto space-y-3 pr-1 text-sm break-words"
            style={{ paddingBottom: inputBoxHeight + 40 }}
          >
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[92%] rounded-2xl px-3 py-2 whitespace-pre-wrap break-words leading-relaxed ${
                    msg.role === "user"
                      ? "bg-sky-500 text-white rounded-br-sm"
                      : "bg-slate-800/70 text-slate-50 rounded-bl-sm"
                  }`}
                >
                  {msg.type === "file" ? (
                    <div
                      className="rounded-xl border p-3"
                      style={{ borderColor: "rgba(255,255,255,0.18)" }}
                    >
                      <div className="text-[12px] font-semibold">
                        📎 {msg.filename ?? "檔案"}
                      </div>
                      <div className="text-[11px] opacity-80 mt-1">
                        type: <span className="font-mono">{msg.filetype ?? "-"}</span>
                      </div>
                      {msg.url ? (
                        <a
                          className="inline-block mt-2 text-[11px] underline opacity-90"
                          href={msg.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          開啟 / 下載
                        </a>
                      ) : null}
                    </div>
                  ) : msg.type === "image" && msg.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={msg.url}
                      alt="uploaded"
                      className="max-w-full rounded-xl border"
                      style={{ borderColor: "rgba(255,255,255,0.18)" }}
                    />
                  ) : (
                    msg.content
                  )}
                </div>
              </div>
            ))}

            {loading ? (
              <div className="flex justify-start">
                <div className="bg-slate-800/80 text-slate-200 text-xs rounded-2xl rounded-bl-sm px-3 py-2">
                  正在思考中…
                </div>
              </div>
            ) : null}

            <div ref={chatEndRef} />
          </div>

          {/* Input */}
          <div
            className="sticky bottom-0 left-0 right-0 pt-3 pb-4"
            style={{ backgroundColor: "var(--background)" }}
          >
            <form onSubmit={sendMessage}>
              <div className="w-full flex justify-center">
                <div className="flex items-end gap-3 w-full max-w-3xl">
                  <div className="flex-1 relative">
                    <div
                      className={`border px-4 py-2 shadow-lg backdrop-blur-sm ${
                        isMultiLine ? "rounded-2xl" : "rounded-full"
                      }`}
                      style={{
                        backgroundColor: "var(--navbar-bg)",
                        borderColor: "var(--navbar-border)",
                        color: "var(--foreground)",
                      }}
                    >
                      <div className="flex flex-col gap-2">
                        <div className={isMultiLine ? "" : "flex items-end gap-3"}>
                          {!isMultiLine ? (
                            <button
                              type="button"
                              onClick={() => setShowToolMenu((v) => !v)}
                              className="self-end text-2xl pb-[2px]"
                              style={{ color: "var(--foreground)" }}
                              title="工具"
                            >
                              +
                            </button>
                          ) : null}

                          <textarea
                            ref={inputRef}
                            value={input}
                            onChange={handleInputChange}
                            onKeyDown={handleKeyDown}
                            placeholder={
                              activeFile
                                ? `提出問題⋯（會優先使用你剛上傳的檔案：${activeFile.filename}）`
                                : "提出任何問題⋯"
                            }
                            rows={1}
                            className={`custom-scroll bg-transparent resize-none border-none outline-none
                              text-sm leading-relaxed overflow-hidden placeholder:text-slate-500
                              ${isMultiLine ? "w-full" : "flex-1 self-end"}`}
                            style={{
                              color: "var(--foreground)",
                              caretColor: "var(--foreground)",
                            }}
                          />

                          {!isMultiLine ? (
                            <div className="flex items-end gap-3 self-end">
                              <span className="text-[10px] text-emerald-400 pb-[3px]">●</span>
                              <button
                                type="submit"
                                disabled={!input.trim() || loading}
                                className="h-7 w-7 rounded-full flex items-center justify-center text-white text-sm font-semibold disabled:opacity-60"
                                style={{
                                  background: "linear-gradient(135deg,#0ea5e9,#22c55e)",
                                  boxShadow: "0 10px 25px rgba(56,189,248,0.45)",
                                }}
                              >
                                {loading ? "…" : <i className="fa-solid fa-arrow-up text-[13px]" />}
                              </button>
                            </div>
                          ) : null}
                        </div>

                        {isMultiLine ? (
                          <div className="flex items-center justify-between">
                            <button
                              type="button"
                              onClick={() => setShowToolMenu((v) => !v)}
                              className="text-2xl"
                              style={{ color: "var(--foreground)" }}
                              title="工具"
                            >
                              +
                            </button>

                            <div className="flex items-center gap-3">
                              <span className="text-[10px] text-emerald-400">●</span>
                              <button
                                type="submit"
                                disabled={!input.trim() || loading}
                                className="h-7 w-7 rounded-full flex items-center justify-center text-white text-sm font-semibold disabled:opacity-60"
                                style={{
                                  background: "linear-gradient(135deg,#0ea5e9,#22c55e)",
                                  boxShadow: "0 10px 25px rgba(56,189,248,0.45)",
                                }}
                              >
                                {loading ? "…" : <i className="fa-solid fa-arrow-up text-[13px]" />}
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>

                    {/* ✅ 工具選單（注意：這裡一定要用 )} 結尾） */}
                    {showToolMenu && (
                      <div
                        className="absolute left-0 right-0 bottom-full mb-2 rounded-2xl border shadow-xl p-3 z-30"
                        style={{
                          backgroundColor: "var(--background)",
                          borderColor: "var(--navbar-border)",
                          color: "var(--foreground)",
                          boxShadow: "0 18px 40px rgba(15,23,42,0.18)",
                        }}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="text-xs font-semibold opacity-80">工具</div>
                          <button
                            type="button"
                            className="text-xs opacity-70 hover:opacity-100"
                            onClick={() => setShowToolMenu(false)}
                          >
                            關閉
                          </button>
                        </div>

                        <div className="flex items-center gap-2">
                          <input
                            ref={fileInputRef}
                            type="file"
                            className="hidden"
                            accept=".pdf,.txt,.csv,.doc,.docx,.ppt,.pptx,.xls,.xlsx,image/*"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) handlePickAndUploadFile(f);
                            }}
                          />
                          <button
                            type="button"
                            disabled={uploadingFile}
                            className="px-3 py-2 rounded-xl text-xs font-semibold border"
                            style={{
                              borderColor: "var(--navbar-border)",
                              backgroundColor: "rgba(148,163,184,0.12)",
                            }}
                            onClick={() => fileInputRef.current?.click()}
                          >
                            {uploadingFile ? "檔案上傳中…" : "上傳檔案（讀取並摘要）"}
                          </button>

                          <div className="text-[11px] opacity-70">
                            ✅ 打 <span className="font-mono">/s2x/upload</span>；不建索引、不汙染向量 DB
                          </div>
                        </div>

                        {activeFile?.filename ? (
                          <div className="mt-2 text-[11px] opacity-80">
                            目前追問會優先用：<span className="font-semibold">{activeFile.filename}</span>{" "}
                            <button
                              type="button"
                              className="ml-2 underline opacity-80"
                              onClick={() => setActiveFile(null)}
                            >
                              清除檔案上下文
                            </button>
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>

                  {/* Export */}
                  <div className="relative self-end">
                    <button
                      type="button"
                      onClick={() => setShowExportMenu((v) => !v)}
                      className="px-4 py-2 rounded-full text-xs font-semibold flex items-center gap-1"
                      style={{
                        backgroundColor: "#6366f1",
                        color: "#ffffff",
                        border: "2px solid #0f172a",
                        boxShadow: "0 18px 40px rgba(15,23,42,0.35)",
                      }}
                    >
                      匯出
                      <span className="text-[10px]">{showExportMenu ? "▴" : "▾"}</span>
                    </button>

                    {/* ✅ 匯出選單（這裡也一定要用 )} 結尾） */}
                    {showExportMenu && (
                      <div
                        className="absolute right-0 bottom-full mb-2 w-40 rounded-xl shadow-xl text-xs overflow-hidden z-20 border"
                        style={{
                          backgroundColor: "var(--background)",
                          borderColor: "var(--navbar-border)",
                          color: "var(--foreground)",
                          boxShadow: "0 18px 40px rgba(15,23,42,0.2)",
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => handleExport("pdf")}
                          className="w-full text-left px-3 py-2 hover:opacity-90"
                        >
                          匯出 PDF
                        </button>
                        <button
                          type="button"
                          onClick={() => handleExport("pptx")}
                          className="w-full text-left px-3 py-2 hover:opacity-90"
                        >
                          匯出 PPTX
                        </button>
                        <div
                          className="px-3 py-2 text-[10px] opacity-70 border-t"
                          style={{ borderColor: "var(--navbar-border)" }}
                        >
                          走 <span className="font-mono">/s2x/export/pdf</span> /{" "}
                          <span className="font-mono">/s2x/export/pptx</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </form>
          </div>
        </section>
      </div>
    </div>
  );
}

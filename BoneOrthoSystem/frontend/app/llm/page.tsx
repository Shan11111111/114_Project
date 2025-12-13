"use client";

import {
  FormEvent,
  KeyboardEvent,
  ChangeEvent,
  useEffect,
  useRef,
  useState,
} from "react";

type BackendMsg = {
  role: "user" | "assistant";
  type: "text" | "image";
  content?: string | null;
  url?: string | null;
  filetype?: string | null;
};

type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  type: "text" | "image";
  content?: string;
  url?: string | null;
  filetype?: string | null;
};

const MIN_HEIGHT = 28;
const MAX_HEIGHT = 120;

// ✅ 後端 base（避免你又打到 3000 變成一坨 HTML）
const API_BASE =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000";

// 你現在聊天是打這個（照你現況不改）
const CHAT_URL = `${API_BASE}/s2x/agent/chat`;

// ✅ 通用上傳（你後端 main.py 有 /upload）
const UPLOAD_URL = `${API_BASE}/upload`;

// ✅ 教材上傳（你 swagger 是 /s2/materials/upload）
const MATERIAL_UPLOAD_URL = `${API_BASE}/s2/materials/upload`;

function toAbsoluteUrl(maybeUrl?: string | null) {
  if (!maybeUrl) return null;
  if (maybeUrl.startsWith("http://") || maybeUrl.startsWith("https://"))
    return maybeUrl;
  return `${API_BASE}${maybeUrl.startsWith("/") ? "" : "/"}${maybeUrl}`;
}

function isUUID(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v.trim()
  );
}

export default function LLMPage() {
  const greeting: ChatMessage = {
    id: 1,
    role: "assistant",
    type: "text",
    content:
      "嗨，我是 GalaBone LLM。在這裡輸入你的問題，我會用教材（RAG）幫你解釋。",
  };

  const [messages, setMessages] = useState<ChatMessage[]>([greeting]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState("test-1");
  const [loading, setLoading] = useState(false);

  const [showToolMenu, setShowToolMenu] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // ✅ 工具選單：上傳狀態
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadingMaterial, setUploadingMaterial] = useState(false);

  // ✅ 教材欄位（不亂刪，你之後要接管理頁也可沿用）
  const [matTitle, setMatTitle] = useState("");
  const [matType, setMatType] = useState("pdf");
  const [matLanguage, setMatLanguage] = useState("zh-TW");
  const [matStyle, setMatStyle] = useState("edu");
  const [matUserId, setMatUserId] = useState("teacher01");
  const [matConversationId, setMatConversationId] = useState(""); // UUID 才送
  const [matBoneId, setMatBoneId] = useState<string>("");
  const [matBoneSmallId, setMatBoneSmallId] = useState<string>("");
  const [matStructureJson, setMatStructureJson] = useState("{}");

  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // ✅ 檔案 input refs
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const materialInputRef = useRef<HTMLInputElement | null>(null);

  // ✅ 用來避免 key 撞號（Date.now + idx 有時會撞）
  const msgSeqRef = useRef(1000);
  const nextId = () => {
    msgSeqRef.current += 1;
    return Date.now() + msgSeqRef.current;
  };

  const baseHeightRef = useRef<number | null>(null);
  const [isMultiLine, setIsMultiLine] = useState(false);
  const [inputBoxHeight, setInputBoxHeight] = useState(MIN_HEIGHT);

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
      if (baseHeightRef.current === null) {
        baseHeightRef.current = contentHeight;
      }
      const singleLineHeight = baseHeightRef.current;
      if (contentHeight > singleLineHeight + 2) {
        setIsMultiLine(true);
      }
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

  // ✅ 把後端 messages 轉 UI messages，並保留 greeting（避免一回覆就把開場白洗掉）
  function applyBackendMessages(serverMsgs: BackendMsg[]) {
    const mapped: ChatMessage[] = (serverMsgs || []).map((m) => {
      const absUrl = toAbsoluteUrl(m.url ?? null);
      return {
        id: nextId(),
        role: m.role,
        type: m.type,
        content: (m.content ?? "") as string,
        url: absUrl,
        filetype: m.filetype ?? null,
      };
    });

    // 若後端第一句不是 assistant greeting，就把 greeting 插回去（你 UI 才不會空虛）
    const hasGreetingLike =
      mapped.length > 0 &&
      mapped[0].role === "assistant" &&
      (mapped[0].content || "").includes("GalaBone");

    setMessages(hasGreetingLike ? mapped : [greeting, ...mapped]);
  }

  async function callChatOnce(userMsg: BackendMsg) {
    const payload = {
      session_id: sessionId,
      messages: [userMsg], // ✅ 只送本次新增的一則，避免後端 session 重複累加
    };

    const res = await fetch(CHAT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const ct = res.headers.get("content-type") || "";
    const raw = await res.text();

    if (!res.ok) {
      throw new Error(`後端錯誤 ${res.status}：${raw.slice(0, 300)}`);
    }
    if (!ct.includes("application/json")) {
      // 你打錯 URL 時，通常會回 HTML
      throw new Error(
        `回傳不是 JSON（多半是路徑打錯/打到 3000）：${raw.slice(0, 200)}`
      );
    }

    const data = JSON.parse(raw) as { messages: BackendMsg[]; actions?: any[] };
    applyBackendMessages(data.messages || []);
  }

  async function sendMessage(e?: FormEvent) {
    if (e) e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    if (!sessionId.trim()) {
      setErrorMsg("Session ID 不能是空的。");
      return;
    }

    setErrorMsg(null);

    const userLocal: ChatMessage = {
      id: nextId(),
      role: "user",
      type: "text",
      content: text,
    };

    setMessages((prev) => [...prev, userLocal]);
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

    setLoading(true);

    try {
      await callChatOnce({
        role: "user",
        type: "text",
        content: text,
      });
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err?.message ?? "呼叫後端失敗");
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: "assistant",
          type: "text",
          content:
            "⚠️ 後端暫時沒回來。請確認：後端 8000 有開、/s2x/agent/chat 存在、CORS OK、向量庫已建好。",
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

  // ✅ 工具：上傳圖片 → 後端 /upload → 再送一則 image 訊息給 chat
  async function handlePickAndSendImage(file: File) {
    setUploadingImage(true);
    setErrorMsg(null);

    try {
      // 1) 上傳檔案
      const fd = new FormData();
      fd.append("file", file);

      const res = await fetch(UPLOAD_URL, { method: "POST", body: fd });
      const ct = res.headers.get("content-type") || "";
      const raw = await res.text();

      if (!res.ok) throw new Error(`上傳失敗 ${res.status}：${raw.slice(0, 200)}`);
      if (!ct.includes("application/json"))
        throw new Error(`上傳回傳非 JSON：${raw.slice(0, 200)}`);

      const data = JSON.parse(raw) as {
        url: string;
        filetype?: string;
        filename?: string;
      };

      const absUrl = toAbsoluteUrl(data.url) || null;

      // 2) 先在 UI 放一張 user image
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: "user",
          type: "image",
          url: absUrl,
          filetype: data.filetype ?? null,
          content: "",
        },
      ]);

      // 3) 送到 chat（觸發 YOLO / 或後端圖片流程）
      setLoading(true);
      await callChatOnce({
        role: "user",
        type: "image",
        url: data.url, // ✅ 這裡送「後端相對路徑」，後端才找得到
        filetype: data.filetype ?? null,
        content: null,
      });
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err?.message ?? "圖片上傳/送出失敗");
    } finally {
      setUploadingImage(false);
      setLoading(false);
      setShowToolMenu(false);
      if (imageInputRef.current) imageInputRef.current.value = "";
    }
  }

  // ✅ 工具：上傳教材 → /s2/materials/upload（會寫 DB + 建索引）
  async function handlePickAndUploadMaterial(file: File) {
    setUploadingMaterial(true);
    setErrorMsg(null);

    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("title", matTitle || file.name);
      fd.append("type", matType);
      fd.append("language", matLanguage);
      fd.append("style", matStyle);
      fd.append("user_id", matUserId);

      // ✅ 只有 UUID 才送 conversation_id（不然你現在 sessionId=test-1 會爆）
      if (matConversationId.trim() && isUUID(matConversationId)) {
        fd.append("conversation_id", matConversationId.trim());
      }

      // ✅ optional ints：空就不要送（比送空字串安全）
      if (matBoneId.trim()) fd.append("bone_id", matBoneId.trim());
      if (matBoneSmallId.trim())
        fd.append("bone_small_id", matBoneSmallId.trim());

      fd.append("structure_json", matStructureJson || "{}");

      const res = await fetch(MATERIAL_UPLOAD_URL, { method: "POST", body: fd });
      const ct = res.headers.get("content-type") || "";
      const raw = await res.text();

      if (!res.ok) throw new Error(`教材上傳失敗 ${res.status}：${raw.slice(0, 250)}`);
      if (!ct.includes("application/json"))
        throw new Error(`教材回傳非 JSON：${raw.slice(0, 200)}`);

      const data = JSON.parse(raw) as { material_id: string; file_path: string };

      // ✅ 回饋一則系統訊息（不打擾聊天）
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: "assistant",
          type: "text",
          content: `✅ 教材已上傳並寫入資料庫：${data.material_id}\n（檔案：${data.file_path}）\n你現在可以直接問它內容，RAG 會去檢索。`,
        },
      ]);
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err?.message ?? "教材上傳失敗");
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: "assistant",
          type: "text",
          content:
            "⚠️ 教材上傳失敗。請確認：/s2/materials/upload 有掛、後端有權限寫檔、DB agent.TeachingMaterial 可寫入。",
        },
      ]);
    } finally {
      setUploadingMaterial(false);
      setShowToolMenu(false);
      if (materialInputRef.current) materialInputRef.current.value = "";
    }
  }

  // 匯出動作（之後接你們 /export router）
  function handleExport(type: "pdf" | "ppt") {
    setShowExportMenu(false);
    console.log("export:", type);
    // TODO: 接你們的 /export API
  }

  return (
    <div
      className="h-[calc(100vh-4rem)] flex overflow-hidden"
      style={{
        backgroundColor: "var(--background)",
        color: "var(--foreground)",
      }}
    >
      {/* 左側導覽列 */}
      <aside
        className="w-64 border-r flex flex-col"
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
            <span>Session ID</span>
            <input
              className="rounded-md px-2 py-[4px] text-[11px] outline-none border"
              style={{
                backgroundColor: "var(--background)",
                color: "var(--foreground)",
                borderColor: "var(--navbar-border)",
              }}
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
            />
          </label>

          <div className="text-[11px] opacity-70">
            backend: <span className="font-mono">{API_BASE}</span>
          </div>
        </div>

        <nav className="flex-1 px-2 pt-4 pb-2 space-y-4 text-sm">
          <div>
            <p className="px-3 mb-1 text-[11px] tracking-wide opacity-60">
              工作區
            </p>
            <button
              className="w-full flex items-center gap-3 px-3 py-2 rounded-md"
              style={{ backgroundColor: "rgba(148,163,184,0.15)" }}
            >
              <i className="fa-regular fa-message text-[13px]" />
              <span>LLM Console</span>
            </button>
          </div>

          <div>
            <p className="px-3 mb-1 text-[11px] tracking-wide opacity-60">
              工具與管理
            </p>
            <button className="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:bg-slate-800/10">
              <i className="fa-solid fa-wand-magic-sparkles text-[13px]" />
              <span>EduGen</span>
            </button>
            <button className="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:bg-slate-800/10">
              <i className="fa-solid fa-folder-tree text-[13px]" />
              <span>資源管理</span>
            </button>
            <button className="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:bg-slate-800/10">
              <i className="fa-regular fa-clock text-[13px]" />
              <span>對話紀錄</span>
            </button>
          </div>
        </nav>

        <div
          className="px-4 py-3 flex items-center gap-2 text-[11px] opacity-70 border-t"
          style={{ borderColor: "var(--navbar-border)" }}
        >
          <i className="fa-solid fa-gear text-[11px]" />
          <span>設定</span>
        </div>
      </aside>

      {/* 右側主畫面 */}
      <div className="flex-1 min-h-0 flex flex-col px-6 py-6 gap-4 overflow-hidden">
        <section className="flex-1 min-h-0 flex flex-col relative">
          <div className="flex items-center justify-between mb-2 text-xs opacity-70 px-1">
            <span>LLM Console（已接 S2 後端）</span>
            {errorMsg && (
              <span className="text-red-400 whitespace-pre-wrap">{errorMsg}</span>
            )}
          </div>

          {/* 聊天訊息列表 */}
          <div
            className="chat-scroll flex-1 min-h-0 overflow-y-auto space-y-3 pr-1 text-sm break-words"
            style={{ paddingBottom: inputBoxHeight + 40 }}
          >
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${
                  msg.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                <div
                  className={`max-w-[80%] rounded-2xl px-3 py-2 whitespace-pre-wrap break-words leading-relaxed
                    ${
                      msg.role === "user"
                        ? "bg-sky-500 text-white rounded-br-sm"
                        : "bg-slate-800/70 text-slate-50 rounded-bl-sm"
                    }`}
                >
                  {msg.type === "image" && msg.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={msg.url}
                      alt="image"
                      className="max-w-full rounded-xl border border-slate-700"
                    />
                  ) : (
                    msg.content
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="bg-slate-800/80 text-slate-200 text-xs rounded-2xl rounded-bl-sm px-3 py-2">
                  正在思考中…
                </div>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* 底部輸入列 */}
          <div
            className="sticky bottom-0 left-0 right-0 pt-3 pb-4"
            style={{ backgroundColor: "var(--background)" }}
          >
            <form onSubmit={sendMessage}>
              <div className="w-full flex justify-center">
                <div className="flex items-end gap-3 w-full max-w-3xl">
                  <div className="flex-1 relative">
                    <div
                      className={`
                        border px-4 py-2 shadow-lg backdrop-blur-sm
                        ${isMultiLine ? "rounded-2xl" : "rounded-full"}
                      `}
                      style={{
                        backgroundColor: "var(--navbar-bg)",
                        borderColor: "var(--navbar-border)",
                        color: "var(--foreground)",
                      }}
                    >
                      <div className="flex flex-col gap-2">
                        <div className={isMultiLine ? "" : "flex items-end gap-3"}>
                          {!isMultiLine && (
                            <button
                              type="button"
                              onClick={() => setShowToolMenu((v) => !v)}
                              className="self-end text-2xl pb-[2px]"
                              style={{ color: "var(--foreground)" }}
                            >
                              +
                            </button>
                          )}

                          <textarea
                            ref={inputRef}
                            value={input}
                            onChange={handleInputChange}
                            onKeyDown={handleKeyDown}
                            placeholder="提出任何問題⋯"
                            rows={1}
                            className={`
                              custom-scroll bg-transparent resize-none border-none outline-none
                              text-sm leading-relaxed overflow-hidden placeholder:text-slate-500
                              ${isMultiLine ? "w-full" : "flex-1 self-end"}
                            `}
                            style={{
                              color: "var(--foreground)",
                              caretColor: "var(--foreground)",
                            }}
                          />

                          {!isMultiLine && (
                            <div className="flex items-end gap-3 self-end">
                              <span className="text-[10px] text-emerald-400 pb-[3px]">
                                ●
                              </span>
                              <button
                                type="submit"
                                disabled={!input.trim() || loading}
                                className="h-7 w-7 rounded-full flex items-center justify-center text-white text-sm font-semibold disabled:opacity-60"
                                style={{
                                  background:
                                    "linear-gradient(135deg,#0ea5e9,#22c55e)",
                                  boxShadow:
                                    "0 10px 25px rgba(56,189,248,0.45)",
                                }}
                              >
                                {loading ? "…" : (
                                  <i className="fa-solid fa-arrow-up text-[13px]" />
                                )}
                              </button>
                            </div>
                          )}
                        </div>

                        {isMultiLine && (
                          <div className="flex items-center justify-between">
                            <button
                              type="button"
                              onClick={() => setShowToolMenu((v) => !v)}
                              className="text-2xl"
                              style={{ color: "var(--foreground)" }}
                            >
                              +
                            </button>

                            <div className="flex items-center gap-3">
                              <span className="text-[10px] text-emerald-400">
                                ●
                              </span>
                              <button
                                type="submit"
                                disabled={!input.trim() || loading}
                                className="h-7 w-7 rounded-full flex items-center justify-center text-white text-sm font-semibold disabled:opacity-60"
                                style={{
                                  background:
                                    "linear-gradient(135deg,#0ea5e9,#22c55e)",
                                  boxShadow:
                                    "0 10px 25px rgba(56,189,248,0.45)",
                                }}
                              >
                                {loading ? "…" : (
                                  <i className="fa-solid fa-arrow-up text-[13px]" />
                                )}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* ✅ 工具選單（不刪 showToolMenu，讓它真的有功能） */}
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
                          <div className="text-xs font-semibold opacity-80">
                            工具
                          </div>
                          <button
                            type="button"
                            className="text-xs opacity-70 hover:opacity-100"
                            onClick={() => setShowToolMenu(false)}
                          >
                            關閉
                          </button>
                        </div>

                        {/* 圖片上傳 */}
                        <div className="flex items-center gap-2 mb-3">
                          <input
                            ref={imageInputRef}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) handlePickAndSendImage(f);
                            }}
                          />
                          <button
                            type="button"
                            disabled={uploadingImage}
                            className="px-3 py-2 rounded-xl text-xs font-semibold border"
                            style={{
                              borderColor: "var(--navbar-border)",
                              backgroundColor: "rgba(148,163,184,0.12)",
                            }}
                            onClick={() => imageInputRef.current?.click()}
                          >
                            {uploadingImage ? "圖片上傳中…" : "上傳圖片並分析"}
                          </button>

                          <div className="text-[11px] opacity-70">
                            （會先走 /upload，再送 image 到 chat）
                          </div>
                        </div>

                        {/* 教材上傳 */}
                        <div className="border-t pt-3" style={{ borderColor: "var(--navbar-border)" }}>
                          <div className="text-xs font-semibold opacity-80 mb-2">
                            教材上傳（RAG）
                          </div>

                          <div className="grid grid-cols-2 gap-2 text-[11px]">
                            <label className="flex flex-col gap-1">
                              <span className="opacity-70">title</span>
                              <input
                                className="rounded-lg px-2 py-1 border outline-none"
                                style={{
                                  backgroundColor: "var(--background)",
                                  color: "var(--foreground)",
                                  borderColor: "var(--navbar-border)",
                                }}
                                value={matTitle}
                                onChange={(e) => setMatTitle(e.target.value)}
                                placeholder="不填就用檔名"
                              />
                            </label>

                            <label className="flex flex-col gap-1">
                              <span className="opacity-70">user_id</span>
                              <input
                                className="rounded-lg px-2 py-1 border outline-none"
                                style={{
                                  backgroundColor: "var(--background)",
                                  color: "var(--foreground)",
                                  borderColor: "var(--navbar-border)",
                                }}
                                value={matUserId}
                                onChange={(e) => setMatUserId(e.target.value)}
                              />
                            </label>

                            <label className="flex flex-col gap-1">
                              <span className="opacity-70">type</span>
                              <input
                                className="rounded-lg px-2 py-1 border outline-none"
                                style={{
                                  backgroundColor: "var(--background)",
                                  color: "var(--foreground)",
                                  borderColor: "var(--navbar-border)",
                                }}
                                value={matType}
                                onChange={(e) => setMatType(e.target.value)}
                              />
                            </label>

                            <label className="flex flex-col gap-1">
                              <span className="opacity-70">language</span>
                              <input
                                className="rounded-lg px-2 py-1 border outline-none"
                                style={{
                                  backgroundColor: "var(--background)",
                                  color: "var(--foreground)",
                                  borderColor: "var(--navbar-border)",
                                }}
                                value={matLanguage}
                                onChange={(e) => setMatLanguage(e.target.value)}
                              />
                            </label>

                            <label className="flex flex-col gap-1">
                              <span className="opacity-70">style</span>
                              <input
                                className="rounded-lg px-2 py-1 border outline-none"
                                style={{
                                  backgroundColor: "var(--background)",
                                  color: "var(--foreground)",
                                  borderColor: "var(--navbar-border)",
                                }}
                                value={matStyle}
                                onChange={(e) => setMatStyle(e.target.value)}
                              />
                            </label>

                            <label className="flex flex-col gap-1">
                              <span className="opacity-70">conversation_id (UUID 可選)</span>
                              <input
                                className="rounded-lg px-2 py-1 border outline-none"
                                style={{
                                  backgroundColor: "var(--background)",
                                  color: "var(--foreground)",
                                  borderColor: "var(--navbar-border)",
                                }}
                                value={matConversationId}
                                onChange={(e) => setMatConversationId(e.target.value)}
                                placeholder="留空就 NULL"
                              />
                            </label>

                            <label className="flex flex-col gap-1">
                              <span className="opacity-70">bone_id (可選)</span>
                              <input
                                className="rounded-lg px-2 py-1 border outline-none"
                                style={{
                                  backgroundColor: "var(--background)",
                                  color: "var(--foreground)",
                                  borderColor: "var(--navbar-border)",
                                }}
                                value={matBoneId}
                                onChange={(e) => setMatBoneId(e.target.value)}
                                placeholder="例如 8"
                              />
                            </label>

                            <label className="flex flex-col gap-1">
                              <span className="opacity-70">bone_small_id (可選)</span>
                              <input
                                className="rounded-lg px-2 py-1 border outline-none"
                                style={{
                                  backgroundColor: "var(--background)",
                                  color: "var(--foreground)",
                                  borderColor: "var(--navbar-border)",
                                }}
                                value={matBoneSmallId}
                                onChange={(e) => setMatBoneSmallId(e.target.value)}
                                placeholder="例如 206"
                              />
                            </label>
                          </div>

                          <label className="flex flex-col gap-1 mt-2 text-[11px]">
                            <span className="opacity-70">structure_json（可選）</span>
                            <textarea
                              className="rounded-lg px-2 py-1 border outline-none"
                              style={{
                                backgroundColor: "var(--background)",
                                color: "var(--foreground)",
                                borderColor: "var(--navbar-border)",
                              }}
                              rows={2}
                              value={matStructureJson}
                              onChange={(e) => setMatStructureJson(e.target.value)}
                            />
                          </label>

                          <div className="flex items-center gap-2 mt-3">
                            <input
                              ref={materialInputRef}
                              type="file"
                              accept=".pdf,.txt,.docx,.pptx,.xlsx,.xls"
                              className="hidden"
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) handlePickAndUploadMaterial(f);
                              }}
                            />
                            <button
                              type="button"
                              disabled={uploadingMaterial}
                              className="px-3 py-2 rounded-xl text-xs font-semibold border"
                              style={{
                                borderColor: "var(--navbar-border)",
                                backgroundColor: "rgba(99,102,241,0.14)",
                              }}
                              onClick={() => materialInputRef.current?.click()}
                            >
                              {uploadingMaterial ? "教材上傳中…" : "選擇教材並上傳"}
                            </button>

                            <div className="text-[11px] opacity-70">
                              ⚠️ 你目前後端會「上傳即建索引」。若要避免污染共用向量庫，請看我下面的後端開關建議。
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 匯出 */}
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
                      <span className="text-[10px]">
                        {showExportMenu ? "▴" : "▾"}
                      </span>
                    </button>

                    {showExportMenu && (
                      <div
                        className="absolute right-0 bottom-full mb-2 w-32 rounded-xl shadow-xl text-xs overflow-hidden z-20 border"
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
                          className="w-full text-left px-3 py-2"
                          style={{ cursor: "pointer" }}
                        >
                          匯出 PDF
                        </button>
                        <button
                          type="button"
                          onClick={() => handleExport("ppt")}
                          className="w-full text-left px-3 py-2"
                          style={{ cursor: "pointer" }}
                        >
                          匯出 PPT
                        </button>
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

"use client";

import {
  FormEvent,
  KeyboardEvent,
  ChangeEvent,
  useEffect,
  useRef,
  useState,
} from "react";

type UploadedFile = {
  id: string;
  name: string;
  size: number;
  type: string;
  url: string; // 用於預覽或下載
};

type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  files?: UploadedFile[];
};

// 假 LLM 回覆
function fakeLLMReply(prompt: string): string {
  if (prompt.length < 10) {
    return "（Demo 回覆）可以再多描述一點你的問題嗎？例如：哪一塊骨頭、哪一句報告看不懂？";
  }
  if (prompt.includes("骨折")) {
    return "（Demo 回覆）骨折就是骨頭出現裂痕或斷裂，嚴重程度從細小裂縫到完全斷開都有。通常會搭配 X 光判斷位置與型態，治療方式可能包含固定、石膏或手術。";
  }
  return `（Demo 回覆）你剛剛說：「${prompt}」。正式版本會把這段文字送到後端的大語言模型，產生真正的解釋。`;
}

const MIN_HEIGHT = 28;
const MAX_HEIGHT = 120;

export default function LLMPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 1,
      role: "assistant",
      content:
        "嗨，我是 GalaBone LLM Demo。在這裡輸入你的問題，我會用骨科知識與多模態概念幫你解釋。",
    },
  ]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState("test-1");
  const [loading, setLoading] = useState(false);
  const [showToolMenu, setShowToolMenu] = useState(false);

  // 尚未送出的檔案（像 ChatGPT 上方小卡片）
  const [pendingFiles, setPendingFiles] = useState<UploadedFile[]>([]);

  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const baseHeightRef = useRef<number | null>(null);
  const [isMultiLine, setIsMultiLine] = useState(false);
  const [inputBoxHeight, setInputBoxHeight] = useState(MIN_HEIGHT);

  // 文字多行 or 有檔案 → 展開長方形框
  const isExpanded = isMultiLine || pendingFiles.length > 0;

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
  }, []);

  // ===== 檔案處理 =====
  function handleUploadClick() {
    fileInputRef.current?.click();
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newFiles: UploadedFile[] = Array.from(files).map((file) => ({
      id: `${Date.now()}-${file.name}-${Math.random()
        .toString(36)
        .slice(2)}`,
      name: file.name,
      size: file.size,
      type: file.type,
      url: URL.createObjectURL(file),
    }));

    setPendingFiles((prev) => [...prev, ...newFiles]);

    // 讓同一個檔案可以再次被選取
    e.target.value = "";
  }

  function removePendingFile(id: string) {
    setPendingFiles((prev) => {
      const target = prev.find((f) => f.id === id);
      if (target) {
        URL.revokeObjectURL(target.url);
      }
      return prev.filter((f) => f.id !== id);
    });
  }

  // ===== 送出訊息 =====
  async function sendMessage(e?: FormEvent) {
    if (e) e.preventDefault();
    const text = input.trim();

    // 文字+檔案都沒有就不送
    if ((!text && pendingFiles.length === 0) || loading) return;

    const userMessage: ChatMessage = {
      id: Date.now(),
      role: "user",
      content: text,
      files: pendingFiles.length ? pendingFiles : undefined,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");

    if (inputRef.current) {
      const el = inputRef.current;
      el.value = "";
      el.style.height = `${MIN_HEIGHT}px`;
      el.scrollTop = 0;
    }

    // 清空 pending 檔案
    setPendingFiles((prev) => {
      prev.forEach((f) => URL.revokeObjectURL(f.url));
      return [];
    });

    baseHeightRef.current = null;
    setIsMultiLine(false);
    setInputBoxHeight(MIN_HEIGHT);

    setLoading(true);

    setTimeout(() => {
      const answerText = fakeLLMReply(text || "（已上傳檔案）");
      const botMessage: ChatMessage = {
        id: Date.now() + 1,
        role: "assistant",
        content: answerText,
      };
      setMessages((prev) => [...prev, botMessage]);
      setLoading(false);
    }, 800);
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

  function handleExport(type: "pdf" | "ppt") {
    setShowToolMenu(false);
    console.log("export:", type);
  }

  // ===== 呈現訊息底下的檔案區塊（不在泡泡裡） =====
  function renderMessageFiles(files?: UploadedFile[]) {
    if (!files || files.length === 0) return null;

    return (
      <div
        className="
          mt-2
          max-h-40              /* 高度上限，太多檔案就出現捲軸 */
          overflow-y-auto
          grid
          grid-cols-1
          sm:grid-cols-2        /* 螢幕寬一點變兩欄 */
          gap-2
          text-xs
        "
      >
        {files.map((file) => {
          const isImage = file.type.startsWith("image/");
          return (
            <div
              key={file.id}
              className="
                border rounded-xl px-2 py-2
                flex items-center gap-2
                bg-black/5
              "
              style={{ borderColor: "rgba(148,163,184,0.25)" }}
            >
              {isImage ? (
                <img
                  src={file.url}
                  alt={file.name}
                  className="w-8 h-8 object-cover rounded-lg"
                />
              ) : (
                <div className="w-8 h-8 flex items-center justify-center rounded-lg border">
                  <i className="fa-regular fa-file text-[11px]" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="truncate text-[11px]">{file.name}</div>
                <div className="opacity-60 text-[10px]">
                  {(file.size / 1024).toFixed(1)} KB
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div
      className="
        h-[calc(100vh-4rem)]
        flex overflow-hidden
        transition-colors duration-500
      "
      style={{
        backgroundColor: "var(--background)",
        color: "var(--foreground)",
      }}
    >
      {/* 左側導覽列 */}
      <aside
        className="
          w-64 border-r flex flex-col
          transition-colors duration-500
        "
        style={{
          backgroundColor: "var(--background)",
          borderColor: "var(--navbar-border)",
          color: "var(--navbar-text)",
        }}
      >
        <div
          className="px-4 pt-4 pb-3 border-b flex flex-col gap-3 transition-colors duration-500"
          style={{ borderColor: "var(--navbar-border)" }}
        >
          <div>
            <h1 className="text-lg font-semibold tracking-wide">GalaBone</h1>
            <p className="text-[11px] mt-1 opacity-70">Your Bone We Care</p>
          </div>

          <label className="flex flex-col gap-1 text-[11px] opacity-80">
            <span>Session ID</span>
            <input
              className="rounded-md px-2 py-[4px] text-[11px] outline-none border transition-colors duration-500"
              style={{
                backgroundColor: "var(--background)",
                color: "var(--foreground)",
                borderColor: "var(--navbar-border)",
              }}
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
            />
          </label>
        </div>

        <nav className="flex-1 px-2 pt-4 pb-2 space-y-4 text-sm">
          <div>
            <p className="px-3 mb-1 text-[11px] tracking-wide opacity-60">
              工作區
            </p>
            <button
              className="w-full flex items-center gap-3 px-3 py-2 rounded-md transition-colors duration-500"
              style={{
                backgroundColor: "rgba(148,163,184,0.15)",
              }}
            >
              <i className="fa-regular fa-message text-[13px]" />
              <span>LLM Console</span>
            </button>
          </div>

          <div>
            <p className="px-3 mb-1 text-[11px] tracking-wide opacity-60">
              工具與管理
            </p>
            <button className="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:bg-slate-800/10 transition-colors duration-500">
              <i className="fa-solid fa-wand-magic-sparkles text-[13px]" />
              <span>EduGen</span>
            </button>
            <button className="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:bg-slate-800/10 transition-colors duration-500">
              <i className="fa-solid fa-folder-tree text-[13px]" />
              <span>資源管理</span>
            </button>
            <button className="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:bg-slate-800/10 transition-colors duration-500">
              <i className="fa-regular fa-clock text-[13px]" />
              <span>對話紀錄</span>
            </button>
          </div>
        </nav>

        <div
          className="px-4 py-3 flex items-center gap-2 text-[11px] opacity-70 border-t transition-colors duration-500"
          style={{ borderColor: "var(--navbar-border)" }}
        >
          <i className="fa-solid fa-gear text-[11px]" />
          <span>設定</span>
        </div>
      </aside>

      {/* 右側主畫面 */}
      <div className="flex-1 min-h-0 flex flex-col px-6 py-6 gap-4 overflow-hidden llm-main-shell">
        <section className="flex-1 min-h-0 flex flex-col relative">
          <div className="flex items-center justify-between mb-2 text-xs opacity-70 px-1">
            <span>Demo 1.0 ver.（尚未接後端）</span>
          </div>

          <div
            className="chat-scroll flex-1 min-h-0 overflow-y-auto text-sm break-words"
            style={{ paddingBottom: inputBoxHeight + 40 }}
          >
            <div className="w-full flex justify-center">
              <div className="w-full max-w-3xl pr-1">
                {messages.map((msg) => {
                  const isUser = msg.role === "user";

                  return (
                    <div key={msg.id} className="mb-4">
                      <div
                        className={`flex ${
                          isUser ? "justify-end" : "justify-start"
                        }`}
                      >
                        {/* 讓泡泡 + 檔案卡片一起對齊 */}
                        <div className="flex flex-col items-stretch max-w-[min(70%,60ch)]">
                          <div
                            className={`
                              chat-bubble
                              ${
                                isUser
                                  ? "chat-bubble-user"
                                  : "chat-bubble-assistant"
                              }
                              whitespace-pre-wrap break-words leading-relaxed
                              px-4 py-3
                              rounded-2xl
                            `}
                            style={{
                              backgroundColor: isUser
                                ? "var(--chat-user-bg)"
                                : "var(--chat-assistant-bg)",
                              color: isUser
                                ? "var(--chat-user-text)"
                                : "var(--chat-assistant-text)",
                              wordBreak: "break-word",
                            }}
                          >
                            {msg.content}
                          </div>

                          {/* 檔案區塊在泡泡下方 */}
                          {renderMessageFiles(msg.files)}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {loading && (
                  <div className="flex justify-start mb-4">
                    <div
                      className={`
                        chat-bubble chat-bubble-assistant
                        text-xs px-4 py-2 max-w-[min(70%,60ch)] rounded-2xl
                      `}
                      style={{
                        backgroundColor: "var(--chat-assistant-bg)",
                        color: "var(--chat-assistant-text)",
                        wordBreak: "break-word",
                      }}
                    >
                      正在思考中…
                    </div>
                  </div>
                )}

                <div ref={chatEndRef} />
              </div>
            </div>
          </div>

          {/* 底部輸入列 */}
          <div
            className="sticky bottom-0 left-0 right-0 pt-3 pb-4 transition-colors duration-500"
            style={{ backgroundColor: "var(--background)" }}
          >
            <form onSubmit={sendMessage}>
              <div className="w-full flex justify-center">
                <div className="flex items-end gap-3 w-full max-w-3xl">
                  <div className="flex-1 relative">
                    <div
                      className={`
                        border px-4 py-2 shadow-lg backdrop-blur-sm
                        ${isExpanded ? "rounded-2xl" : "rounded-full"}
                        transition-colors duration-500
                        neon-shell
                      `}
                      style={{
                        backgroundColor: "var(--navbar-bg)",
                        borderColor: "var(--navbar-border)",
                        color: "var(--foreground)",
                      }}
                    >
                      <div className="flex flex-col gap-2">
                        {/* 待上傳檔案（像 ChatGPT 上方的小卡片） */}
                        {pendingFiles.length > 0 && (
                          <div className="flex flex-wrap gap-2 text-[11px]">
                            {pendingFiles.map((file) => (
                              <div
                                key={file.id}
                                className="flex items-center gap-2 px-2 py-1 rounded-full border bg-black/5"
                                style={{
                                  borderColor: "rgba(148,163,184,0.35)",
                                }}
                              >
                                <i className="fa-regular fa-file text-[10px]" />
                                <span className="max-w-[160px] truncate">
                                  {file.name}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => removePendingFile(file.id)}
                                  className="text-[10px] opacity-70 hover:opacity-100"
                                >
                                  ✕
                                </button>
                              </div>
                            ))}
                          </div>
                        )}

                        <div
                          className={
                            isExpanded ? "" : "flex items-center gap-3"
                          }
                        >
                          {/* 左側只剩 工具（上傳藏在工具內） */}
                          {!isExpanded && (
                            <div className="flex items-center gap-2">
                              {/* 隱藏 file input（由工具選單觸發） */}
                              <input
                                ref={fileInputRef}
                                type="file"
                                multiple
                                className="hidden"
                                onChange={handleFileChange}
                              />

                              <div className="relative">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setShowToolMenu((v) => !v)
                                  }
                                  className="flex items-center gap-1 text-xs"
                                  style={{
                                    backgroundColor: "transparent",
                                    color: "var(--foreground)",
                                  }}
                                >
                                  <i className="fa-solid fa-sliders text-[11px]" />
                                  <span>工具</span>
                                  <span className="text-[10px]">
                                    {showToolMenu ? "▴" : "▾"}
                                  </span>
                                </button>

                                {showToolMenu && (
                                  <div
                                    className="absolute left-0 bottom-full mb-2 w-40 rounded-xl shadow-xl text-xs overflow-hidden z-20 border transition-colors duration-500"
                                    style={{
                                      backgroundColor: "var(--background)",
                                      borderColor: "var(--navbar-border)",
                                      color: "var(--foreground)",
                                      boxShadow:
                                        "0 18px 40px rgba(15,23,42,0.25)",
                                    }}
                                  >
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setShowToolMenu(false);
                                        handleUploadClick();
                                      }}
                                      className="w-full text-left px-3 py-2"
                                      style={{ cursor: "pointer" }}
                                      onMouseEnter={(e) =>
                                        (e.currentTarget.style.backgroundColor =
                                          "rgba(148,163,184,0.18)")
                                      }
                                      onMouseLeave={(e) =>
                                        (e.currentTarget.style.backgroundColor =
                                          "transparent")
                                      }
                                    >
                                      上傳檔案
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleExport("pdf")}
                                      className="w-full text-left px-3 py-2"
                                      style={{ cursor: "pointer" }}
                                      onMouseEnter={(e) =>
                                        (e.currentTarget.style.backgroundColor =
                                          "rgba(148,163,184,0.18)")
                                      }
                                      onMouseLeave={(e) =>
                                        (e.currentTarget.style.backgroundColor =
                                          "transparent")
                                      }
                                    >
                                      匯出 PDF
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleExport("ppt")}
                                      className="w-full text-left px-3 py-2"
                                      style={{ cursor: "pointer" }}
                                      onMouseEnter={(e) =>
                                        (e.currentTarget.style.backgroundColor =
                                          "rgba(148,163,184,0.18)")
                                      }
                                      onMouseLeave={(e) =>
                                        (e.currentTarget.style.backgroundColor =
                                          "transparent")
                                      }
                                    >
                                      匯出 PPT
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}

                          {/* textarea */}
                          <textarea
                            ref={inputRef}
                            value={input}
                            onChange={handleInputChange}
                            onKeyDown={handleKeyDown}
                            placeholder="提出任何問題⋯"
                            rows={1}
                            className={`
                              custom-scroll
                              bg-transparent
                              resize-none
                              border-none
                              outline-none
                              text-sm
                              leading-relaxed
                              overflow-hidden
                              placeholder:text-slate-500
                              ${isExpanded ? "w-full" : "flex-1"}
                            `}
                            style={{
                              color: "var(--foreground)",
                              caretColor: "var(--foreground)",
                            }}
                          />

                          {!isExpanded && (
                            <div className="flex items-center gap-3">
                              <span className="text-[10px] text-emerald-400">
                                ●
                              </span>
                              <button
                                type="submit"
                                disabled={
                                  (!input.trim() &&
                                    pendingFiles.length === 0) ||
                                  loading
                                }
                                className="h-7 w-7 rounded-full flex items-center justify-center text-white text-sm font-semibold disabled:opacity-60"
                                style={{
                                  background:
                                    "linear-gradient(135deg,#0ea5e9,#22c55e)",
                                  boxShadow:
                                    "0 10px 25px rgba(56,189,248,0.45)",
                                }}
                              >
                                {loading ? (
                                  "…"
                                ) : (
                                  <i className="fa-solid fa-arrow-up text-[13px]" />
                                )}
                              </button>
                            </div>
                          )}
                        </div>

                        {/* 展開模式（文字多行或有檔案）下半：左側 工具 + 右側送出 */}
                        {isExpanded && (
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              {/* 多行/展開模式也需要 file input */}
                              <input
                                ref={fileInputRef}
                                type="file"
                                multiple
                                className="hidden"
                                onChange={handleFileChange}
                              />

                              <div className="relative">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setShowToolMenu((v) => !v)
                                  }
                                  className="flex items-center gap-1 text-xs"
                                  style={{
                                    backgroundColor: "transparent",
                                    color: "var(--foreground)",
                                  }}
                                >
                                  <i className="fa-solid fa-sliders text-[11px]" />
                                  <span>工具</span>
                                  <span className="text-[10px]">
                                    {showToolMenu ? "▴" : "▾"}
                                  </span>
                                </button>

                                {showToolMenu && (
                                  <div
                                    className="absolute left-0 bottom-full mb-2 w-40 rounded-xl shadow-xl text-xs overflow-hidden z-20 border transition-colors duration-500"
                                    style={{
                                      backgroundColor: "var(--background)",
                                      borderColor: "var(--navbar-border)",
                                      color: "var(--foreground)",
                                      boxShadow:
                                        "0 18px 40px rgba(15,23,42,0.25)",
                                    }}
                                  >
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setShowToolMenu(false);
                                        handleUploadClick();
                                      }}
                                      className="w-full text-left px-3 py-2"
                                      style={{ cursor: "pointer" }}
                                      onMouseEnter={(e) =>
                                        (e.currentTarget.style.backgroundColor =
                                          "rgba(148,163,184,0.18)")
                                      }
                                      onMouseLeave={(e) =>
                                        (e.currentTarget.style.backgroundColor =
                                          "transparent")
                                      }
                                    >
                                      上傳檔案
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleExport("pdf")}
                                      className="w-full text左 px-3 py-2"
                                      style={{ cursor: "pointer" }}
                                      onMouseEnter={(e) =>
                                        (e.currentTarget.style.backgroundColor =
                                          "rgba(148,163,184,0.18)")
                                      }
                                      onMouseLeave={(e) =>
                                        (e.currentTarget.style.backgroundColor =
                                          "transparent")
                                      }
                                    >
                                      匯出 PDF
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleExport("ppt")}
                                      className="w-full text-left px-3 py-2"
                                      style={{ cursor: "pointer" }}
                                      onMouseEnter={(e) =>
                                        (e.currentTarget.style.backgroundColor =
                                          "rgba(148,163,184,0.18)")
                                      }
                                      onMouseLeave={(e) =>
                                        (e.currentTarget.style.backgroundColor =
                                          "transparent")
                                      }
                                    >
                                      匯出 PPT
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center gap-3">
                              <span className="text-[10px] text-emerald-400">
                                ●
                              </span>
                              <button
                                type="submit"
                                disabled={
                                  (!input.trim() &&
                                    pendingFiles.length === 0) ||
                                  loading
                                }
                                className="h-7 w-7 rounded-full flex items-center justify-center text-white text-sm font-semibold disabled:opacity-60"
                                style={{
                                  background:
                                    "linear-gradient(135deg,#0ea5e9,#22c55e)",
                                  boxShadow:
                                    "0 10px 25px rgba(56,189,248,0.45)",
                                }}
                              >
                                {loading ? (
                                  "…"
                                ) : (
                                  <i className="fa-solid fa-arrow-up text-[13px]" />
                                )}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 右側不再額外放按鈕，已整合在輸入框內 */}
                </div>
              </div>
            </form>
          </div>
        </section>
      </div>
    </div>
  );
}

"use client";

import {
  FormEvent,
  KeyboardEvent,
  ChangeEvent,
  useEffect,
  useRef,
  useState,
} from "react";

type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
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

  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

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
  }, []);

  async function sendMessage(e?: FormEvent) {
    if (e) e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    const userMessage: ChatMessage = {
      id: Date.now(),
      role: "user",
      content: text,
    };

    setMessages((prev) => [...prev, userMessage]);
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

    setTimeout(() => {
      const answerText = fakeLLMReply(text);
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

  function handleUploadClick() {
    console.log("upload file…");
  }

  function handleExport(type: "pdf" | "ppt") {
    setShowToolMenu(false);
    console.log("export:", type);
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
      {/* 左側導覽列） */}
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
                            max-w-[min(70%,60ch)]
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
                        ${isMultiLine ? "rounded-2xl" : "rounded-full"}
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
                        <div
                          className={
                            isMultiLine ? "" : "flex items-center gap-3"
                          }
                        >
                          {/* 左側：+（上傳） + 工具 */}
                          {!isMultiLine && (
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={handleUploadClick}
                                className="text-2xl"
                                style={{ color: "var(--foreground)" }}
                              >
                                +
                              </button>

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
                                    className="absolute left-0 bottom-full mb-2 w-36 rounded-xl shadow-xl text-xs overflow-hidden z-20 border transition-colors duration-500"
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
                              ${isMultiLine ? "w-full" : "flex-1"}
                            `}
                            style={{
                              color: "var(--foreground)",
                              caretColor: "var(--foreground)",
                            }}
                          />

                          {!isMultiLine && (
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
                                {loading ? (
                                  "…"
                                ) : (
                                  <i className="fa-solid fa-arrow-up text-[13px]" />
                                )}
                              </button>
                            </div>
                          )}
                        </div>

                        {/* 多行模式時的下半：左 + 工具 + 右送出 */}
                        {isMultiLine && (
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={handleUploadClick}
                                className="text-2xl"
                                style={{ color: "var(--foreground)" }}
                              >
                                +
                              </button>

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
                                    className="absolute left-0 bottom-full mb-2 w-36 rounded-xl shadow-xl text-xs overflow-hidden z-20 border transition-colors duration-500"
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

                  {/* 右側只保留送出箭頭 */}
                </div>
              </div>
            </form>
          </div>
        </section>
      </div>
    </div>
  );
}

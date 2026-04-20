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

const MIN_HEIGHT = 28; // textarea 最小高度
const MAX_HEIGHT = 120; // textarea 最大高度，超過就捲動

export default function LLMPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 1,
      role: "assistant",
      content:
        "嗨，我是 GalaBone LLM Demo。在這裡輸入你的問題，我會用骨科知識與多模態概念幫你解釋。。",
    },
  ]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState("test-1");
  const [loading, setLoading] = useState(false);
  const [showToolMenu, setShowToolMenu] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false); // 匯出選單開關

  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // 記錄「單行」狀態下 scrollHeight 的基準值
  const baseHeightRef = useRef<number | null>(null);

  // false = 一行（超圓），true = 多行（長方形）
  const [isMultiLine, setIsMultiLine] = useState(false);
  // 聊天區底部 padding 用
  const [inputBoxHeight, setInputBoxHeight] = useState(MIN_HEIGHT);

  // --- 自動調整 textarea 高度（像 GPT 那樣） ---
  function autoResizeTextarea() {
    const el = inputRef.current;
    if (!el) return;

    const text = el.value;

    // 沒文字時：回到單行小膠囊
    if (text.trim().length === 0) {
      baseHeightRef.current = null;
      el.style.height = `${MIN_HEIGHT}px`;
      setIsMultiLine(false);
      setInputBoxHeight(MIN_HEIGHT);
      return;
    }

    // 先讓瀏覽器照內容算實際高度
    el.style.height = "auto";
    const contentHeight = el.scrollHeight;

    // 如果目前還是「單行模式」
    if (!isMultiLine) {
      // 第一次有字：記錄當下 scrollHeight 當作單行基準
      if (baseHeightRef.current === null) {
        baseHeightRef.current = contentHeight;
      }

      const singleLineHeight = baseHeightRef.current;

      // 如果已經超過單行高度一點點，就切換成多行
      if (contentHeight > singleLineHeight + 2) {
        setIsMultiLine(true); // 只會從 false -> true
      }

      // 單行模式下，高度永遠固定為膠囊高度，不跟著 contentHeight 跳
      el.style.height = `${MIN_HEIGHT}px`;
      setInputBoxHeight(MIN_HEIGHT);
      return;
    }

    // 多行模式：高度直接跟內容一樣高（最多到 MAX_HEIGHT）
    const newHeight = Math.min(contentHeight, MAX_HEIGHT);

    el.style.height = `${newHeight}px`;
    setInputBoxHeight(newHeight);
  }

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // 首次載入也跑一次，讓 placeholder 就是正確高度
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
    // 重置成單行膠囊狀態
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

  // 匯出動作（之後在這邊接真正匯出邏輯）
  function handleExport(type: "pdf" | "ppt") {
    setShowExportMenu(false);
    console.log("export:", type);
    // TODO: 接後端匯出功能
  }

  return (
    <div
      className="
        h-[calc(100vh-4rem)]
        flex overflow-hidden
      "
      style={{
        backgroundColor: "var(--background)",
        color: "var(--foreground)",
      }}
    >
      {/* 左側導覽列（ChatGPT 風格） */}
      <aside
        className="w-64 border-r flex flex-col"
        style={{
          backgroundColor: "var(--background)",
          borderColor: "var(--navbar-border)",
          color: "var(--navbar-text)",
        }}
      >
        {/* Logo 區 + Session ID */}
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
        </div>

        {/* Nav 區 */}
        <nav className="flex-1 px-2 pt-4 pb-2 space-y-4 text-sm">
          {/* 工作區（目前頁面） */}
          <div>
            <p className="px-3 mb-1 text-[11px] tracking-wide opacity-60">
              工作區
            </p>
            <button
              className="w-full flex items-center gap-3 px-3 py-2 rounded-md"
              style={{
                backgroundColor: "rgba(148,163,184,0.15)",
              }}
            >
              <i className="fa-regular fa-message text-[13px]" />
              <span>LLM Console</span>
            </button>
          </div>

          {/* 工具與管理 */}
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

        {/* 底部設定列（只留齒輪文字） */}
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
        {/* 聊天區 + 浮動輸入列 */}
        <section className="flex-1 min-h-0 flex flex-col relative">
          {/* 上方小標題 */}
          <div className="flex items-center justify-between mb-2 text-xs opacity-70 px-1">
            <span>Demo 1.0 ver.（尚未接後端）</span>
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
                  {msg.content}
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

          {/* 底部輸入列（GPT 風格） */}
          <div
            className="sticky bottom-0 left-0 right-0 pt-3 pb-4"
            style={{ backgroundColor: "var(--background)" }}
          >
            <form onSubmit={sendMessage}>
              <div className="w-full flex justify-center">
                <div className="flex items-end gap-3 w-full max-w-3xl">
                  {/* 膠囊輸入框 */}
                  <div className="flex-1 relative">
                    <div
                      className={`
                        border px-4 py-2 shadow-lg backdrop-blur-sm
                        ${isMultiLine ? "rounded-2xl" : "rounded-full"}
                      `}
                      // ⭐ 這裡改成吃全域變數：白天 = 淺灰卡片，夜間 = 深色
                      style={{
                        backgroundColor: "var(--navbar-bg)",
                        borderColor: "var(--navbar-border)",
                        color: "var(--foreground)",
                      }}
                    >
                      <div className="flex flex-col gap-2">
                        {/* 上半：單行 = 一排 + textarea + 送出；多行 = 只剩 textarea 撐滿 */}
                        <div
                          className={isMultiLine ? "" : "flex items-end gap-3"}
                        >
                          {/* 單行模式時的左側 + */}
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
                              ${isMultiLine ? "w-full" : "flex-1 self-end"}
                            `}
                            style={{
                              color: "var(--foreground)",
                              caretColor: "var(--foreground)",
                            }}
                          />

                          {/* 單行模式時的右側 綠點 + 箭頭 */}
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
                                {loading ? (
                                  "…"
                                ) : (
                                  <i className="fa-solid fa-arrow-up text-[13px]" />
                                )}
                              </button>
                            </div>
                          )}
                        </div>

                        {/* 多行模式時的下半：左 + 右 綠點 + 箭頭 */}
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

                  {/* 匯出按鈕 +「往上」展開選單 */}
                  <div className="relative self-end">
                    {/* 紫色 pill + 黑邊 */}
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
              </div>
            </form>
          </div>
        </section>
      </div>
    </div>
  );
}

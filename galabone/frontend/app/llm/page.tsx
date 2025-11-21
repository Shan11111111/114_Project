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
const MAX_HEIGHT = 120; ; // textarea 最大高度，超過就捲動

export default function LLMPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 1,
      role: "assistant",
      content:
        "嗨，我是 GalaBone LLM Demo。現在還沒接後端模型，先用模擬回覆讓你測試 UI 和互動流程。",
    },
  ]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState("test-1");
  const [loading, setLoading] = useState(false);
  const [showToolMenu, setShowToolMenu] = useState(false);

  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // ⭐ 控制泡泡形狀：false = 一行（超圓），true = 多行（長方形一點）
  const [isMultiLine, setIsMultiLine] = useState(false);
  // ⭐ 記錄輸入框高度，用來動態推開上面的聊天區（解決「巨大空白」）
  const [inputBoxHeight, setInputBoxHeight] = useState(MIN_HEIGHT);

  // --- 共用：自動調整 textarea 高度（像 GPT 那樣） ---
  function autoResizeTextarea() {
    const el = inputRef.current;
    if (!el) return;

    // 先歸零再量 scrollHeight
    el.style.height = "0px";
    const contentHeight = el.scrollHeight;

    const newHeight = Math.max(MIN_HEIGHT, Math.min(contentHeight, MAX_HEIGHT));

    el.style.height = `${newHeight}px`;
    // ⭐ 高度到 MAX 之後就顯示卷軸
    el.style.overflowY = contentHeight > MAX_HEIGHT ? "auto" : "hidden";

    // 超過一行就把泡泡改成「比較方」
    setIsMultiLine(contentHeight > MIN_HEIGHT + 4);

    // ⭐ 記錄現在輸入框高度，等一下拿來算聊天區的 paddingBottom
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
      inputRef.current.value = "";
      inputRef.current.style.height = `${MIN_HEIGHT}px`;
      inputRef.current.style.overflowY = "hidden";
      inputRef.current.scrollTop = 0;
    }
    setIsMultiLine(false); // 送出後恢復成單行膠囊
    setInputBoxHeight(MIN_HEIGHT); // ⭐ 聊天區 padding 也一起回到最小

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

  return (
    <main className="h-screen bg-slate-950 text-slate-50 flex overflow-hidden">
      {/* 左側導覽列 */}
      <aside className="w-60 bg-slate-900 border-r border-slate-800 flex flex-col">
        <div className="px-5 py-4 border-b border-slate-800">
          <h1 className="text-xl font-bold tracking-wide">GalaBone</h1>
          <p className="text-xs text-slate-400 mt-1">
            BoneVision · LLM · EduGen
          </p>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 text-sm">
          <button className="w-full text-left px-3 py-2 rounded-lg text-slate-200 hover:bg-slate-800">
            BoneVision
          </button>
          <button className="w-full text-left px-3 py-2 rounded-lg bg-sky-600/80 text-white font-semibold">
            LLM Assistant
          </button>
          <button className="w-full text-left px-3 py-2 rounded-lg text-slate-200 hover:bg-slate-800">
            EduGen
          </button>
          <button className="w-full text-left px-3 py-2 rounded-lg text-slate-200 hover:bg-slate-800">
            Resource
          </button>
          <button className="w-full text-left px-3 py-2 rounded-lg text-slate-200 hover:bg-slate-800">
            Settings
          </button>
        </nav>

        <div className="px-4 py-3 border-t border-slate-800 text-[11px] text-slate-400">
          Session：{sessionId}
        </div>
      </aside>

      {/* 右側主畫面 */}
      <div className="flex-1 min-h-0 flex flex-col px-6 py-6 gap-4 overflow-hidden">
        {/* Header */}
        <header className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">GalaBone LLM Console</h2>
            <p className="text-xs text-slate-400 mt-1">
              在這裡輸入你的問題，我會用骨科知識與多模態概念幫你解釋。
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-400">Session ID：</span>
            <input
              className="bg-slate-900 border border-slate-700 rounded-md px-2 py-[4px] text-xs outline-none focus:border-sky-500 w-32"
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
            />
          </div>
        </header>

        {/* 聊天區 + 浮動輸入列 */}
        <section className="flex-1 min-h-0 flex flex-col relative">
          {/* 上方小標題 */}
          <div className="flex items-center justify-between mb-2 text-xs text-slate-400 px-1">
            <span>對話紀錄 · LLM 回覆</span>
            <span>Demo mode（尚未接後端）</span>
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
          <div className="sticky bottom-0 left-0 right-0 bg-gradient-to-t from-slate-950 via-slate-950/95 to-transparent pt-3 pb-4">
            <form onSubmit={sendMessage}>
              {/* 先用一層 wrapper 控制整體寬度 */}
              <div className="w-full flex justify-center">
                {/* max-w-3xl = 約 768px，想更寬就改成 max-w-4xl / w-[900px] */}
                <div className="flex items-end gap-3 w-full max-w-3xl">
                  {/* 膠囊輸入框：用 flex-1 在這個容器裡分配剩餘寬度 */}
                  <div className="flex-1 relative">
                    <div
                      className={`
                        bg-[#0f172a]
                        border border-slate-700
                        px-4 py-2
                        shadow-lg shadow-slate-900/50
                        backdrop-blur-sm
                        ${isMultiLine ? "rounded-2xl" : "rounded-full"}
                      `}
                    >
                      {/* 這一層：上面永遠是 textarea；下面在多行時才出現按鈕列 */}
                      <div className="flex flex-col gap-2">
                        {/* 上半：單行 = 一排 + textarea + 送出；多行 = 只剩 textarea */}
                        <div
                          className={
                            isMultiLine ? "" : "flex items-end gap-3"
                          }
                        >
                          {/* 單行模式時的左側 + */}
                          {!isMultiLine && (
                            <button
                              type="button"
                              onClick={() => setShowToolMenu((v) => !v)}
                              className="self-end text-2xl text-slate-400 hover:text-slate-200 pb-[2px]"
                            >
                              +
                            </button>
                          )}

                          {/* textarea（永遠同一顆元件） */}
                          <textarea
                            ref={inputRef}
                            value={input}
                            onChange={handleInputChange}
                            onKeyDown={handleKeyDown}
                            placeholder="提出任何問題⋯"
                            className={` 
                              custom-scroll
                              bg-transparent
                              resize-none
                              border-none
                              outline-none
                              text-sm
                              text-slate-50
                              placeholder:text-slate-500
                              leading-relaxed
                              ${
                                isMultiLine
                                  ? "w-full"
                                  : "flex-1 self-end"
                              }
                            `}
                          />

                          {/* 單行模式時的右側 綠點 + 箭頭 */}
                          {!isMultiLine && (
                            <div className="flex items-end gap-3 self-end">
                              <span className="text-[10px] text-emerald-200 pb-[3px]">
                                ●
                              </span>
                              <button
                                type="submit"
                                disabled={!input.trim() || loading}
                                className="h-7 w-7 rounded-full bg-sky-400 flex items-center justify-center text-white text-sm font-semibold disabled:opacity-60"
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
                              className="text-2xl text-slate-400 hover:text-slate-200"
                            >
                              +
                            </button>

                            <div className="flex items-center gap-3">
                              <span className="text-[10px] text-emerald-200">
                                ●
                              </span>
                              <button
                                type="submit"
                                disabled={!input.trim() || loading}
                                className="h-7 w-7 rounded-full bg-sky-400 flex items-center justify-center text-white text-sm font-semibold disabled:opacity-60"
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

                  {/* 匯出按鈕 */}
                  <button
                    type="button"
                    className="self-end px-4 py-2 rounded-full bg-slate-800 text-slate-200 hover:bg-slate-700 text-xs border border-slate-700"
                  >
                    匯出 PDF
                  </button>
                  <button
                    type="button"
                    className="self-end px-4 py-2 rounded-full bg-indigo-600 text-white hover:bg-indigo-500 text-xs border border-indigo-500"
                  >
                    匯出 PPT
                  </button>
                </div>
              </div>
            </form>
          </div>
        </section>
      </div>
    </main>
  );
}

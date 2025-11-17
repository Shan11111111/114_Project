"use client";

import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";

type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
};

// 假 LLM 回覆：之後要接後端再把這段換掉就好
function fakeLLMReply(prompt: string): string {
  if (prompt.length < 10) {
    return "（Demo 回覆）可以再多描述一點你的問題嗎？例如：哪一塊骨頭、哪一句報告看不懂？";
  }
  if (prompt.includes("骨折")) {
    return "（Demo 回覆）骨折就是骨頭出現裂痕或斷裂，嚴重程度從細小裂縫到完全斷開都有。通常會搭配 X 光判斷位置與型態，治療方式可能包含固定、石膏或手術。";
  }
  return `（Demo 回覆）你剛剛說：「${prompt}」。正式版本會把這段文字送到後端的大語言模型，產生真正的解釋。`;
}

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
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

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

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50 flex">
      {/* 左側導覽列（深色 + icon 風格） */}
      <aside className="w-60 bg-slate-900 border-r border-slate-800 flex flex-col">
        <div className="px-5 py-4 border-b border-slate-800">
          <h1 className="text-xl font-bold tracking-wide">GalaBone</h1>
          <p className="text-xs text-slate-400 mt-1">
            BoneVision · LLM · EduGen
          </p>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 text-sm">
          <button className="w-full text-left px-3 py-2 rounded-lg text-slate-200 hover:bg-slate-800">
            🦴 BoneVision
          </button>
          <button className="w-full text-left px-3 py-2 rounded-lg bg-sky-600/80 text-white font-semibold">
            💬 LLM Assistant
          </button>
          <button className="w-full text-left px-3 py-2 rounded-lg text-slate-200 hover:bg-slate-800">
            📚 EduGen
          </button>
          <button className="w-full text-left px-3 py-2 rounded-lg text-slate-200 hover:bg-slate-800">
            ⚙️ Settings
          </button>
        </nav>

        <div className="px-4 py-3 border-t border-slate-800 text-[11px] text-slate-400">
          Session：{sessionId}
        </div>
      </aside>

      {/* 右側主畫面：套用你一開始喜歡的那種 LLM Console 風格 */}
      <div className="flex-1 flex flex-col px-6 py-6 gap-4">
        {/* Header */}
        <header className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold">GalaBone LLM Console</h2>
            <p className="text-xs text-slate-400 mt-1">
              在這裡輸入你的問題，我會用骨科知識與多模態概念幫你解釋。
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-400">Session ID：</span>
            <input
              className="bg-slate-900 border border-slate-700 rounded-md px-2 py-[3px] text-xs outline-none focus:border-sky-500 w-32"
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
            />
          </div>
        </header>

        {/* 中間聊天卡片（深色卡 + 氣泡） */}
        <section className="flex-1 flex flex-col gap-3">
          <div className="flex-1 bg-slate-900/80 border border-slate-800 rounded-2xl px-4 py-3 flex flex-col">
            <div className="flex items-center justify-between mb-2 text-xs text-slate-400">
              <span>對話紀錄 · LLM 回覆</span>
              <span>Demo mode（尚未接後端）</span>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 pr-1 text-sm">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${
                    msg.role === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  <div
                    className={`max-w-[80%] rounded-2xl px-3 py-2 whitespace-pre-wrap leading-relaxed
                    ${
                      msg.role === "user"
                        ? "bg-sky-500 text-white rounded-br-sm"
                        : "bg-slate-800 text-slate-50 rounded-bl-sm border border-slate-700"
                    }`}
                  >
                    {msg.content}
                  </div>
                </div>
              ))}

              {loading && (
                <div className="flex justify-start">
                  <div className="bg-slate-800 text-slate-200 text-xs rounded-2xl rounded-bl-sm px-3 py-2">
                    正在思考中…
                  </div>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>
          </div>

          {/* 底部輸入區 + 右下功能按鈕（送出 / 上傳 / 匯出） */}
          <form
            onSubmit={sendMessage}
            className="mt-3 border-t border-slate-800 pt-3"
          >
            <div className="flex items-center gap-3">
              {/* 膠囊輸入框 */}
              <div className="flex-1 bg-[#0f172a] border border-slate-700 rounded-full px-4 py-2 flex items-center gap-3 shadow-sm">
                {/* 左邊 + 號 */}
                <button
                  type="button"
                  className="text-xl text-slate-400 hover:text-slate-200 translate-y-[1px]"
                >
                  +
                </button>

                {/* 中間輸入區 */}
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="提出任何問題⋯"
                  rows={1}
                  className="flex-1 bg-transparent resize-none border-none outline-none text-sm text-slate-50 placeholder:text-slate-500 max-h-32"
                />

                {/* 小綠點 */}
                <span className="text-[12px] text-emerald-300">●</span>

                {/* 麥克風（可替換） */}
                <button
                  type="button"
                  className="text-sm text-slate-400 hover:text-slate-200"
                >
                  🎤
                </button>
              </div>

              {/* 右邊功能按鈕 */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="px-4 py-2 rounded-full bg-slate-800 text-slate-200 hover:bg-slate-700 text-xs border border-slate-700"
                >
                  上傳檔案
                </button>

                <button
                  type="button"
                  className="px-4 py-2 rounded-full bg-slate-800 text-slate-200 hover:bg-slate-700 text-xs border border-slate-700"
                >
                  匯出 PDF
                </button>

                <button
                  type="button"
                  className="px-4 py-2 rounded-full bg-indigo-600 text-white hover:bg-indigo-500 text-xs border border-indigo-500"
                >
                  匯出 PPT
                </button>
              </div>

              {/* 送出按鈕（圓形） */}
              <button
                type="submit"
                disabled={!input.trim() || loading}
                className="h-11 w-11 rounded-full bg-sky-500 flex items-center justify-center text-white text-sm font-semibold disabled:opacity-60"
              >
                {loading ? "…" : "↗"}
              </button>
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}

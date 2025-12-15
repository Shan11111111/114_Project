"use client";

import {
  FormEvent,
  KeyboardEvent,
  ChangeEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  memo,
} from "react";

type UploadedFile = {
  id: string;
  name: string;
  size: number;
  type: number | string;
  url: string;
};

type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  files?: UploadedFile[];
};

type ViewKey = "llm" | "edugen" | "assets";

type HistoryThread = {
  id: string;
  title: string;
  updatedAt: string;
  preview: string;
  messageCount: number;
};

type HistoryMessage = {
  id: string;
  threadId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
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

// ============================================================
// ✅ HistoryOverlay 獨立元件：
// - 搜尋狀態在元件內，不會讓整個 LLMPage 每個字都 rerender
// - IME 用 composingRef 同步判斷，刪字不會被中斷
// - 用 startTransition 把 filter 丟到低優先度，輸入更順
// - query 透過 ref 持久化：關掉再開還在
// - ✅ inline rename：右側標題可直接編輯（Enter 存、Esc 取消、Blur 存）
// ============================================================
const HistoryOverlay = memo(function HistoryOverlay({
  isOpen,
  onClose,
  historyThreads,
  historyMessages,
  activeThreadId,
  onSelectThread,
  onLoadThreadToMain,
  onNewThread,
  onRenameThread,
  NAV_ACTIVE_BG,
  NAV_HOVER_BG,
  persistedQueryRef,
}: {
  isOpen: boolean;
  onClose: () => void;
  historyThreads: HistoryThread[];
  historyMessages: HistoryMessage[];
  activeThreadId: string;
  onSelectThread: (threadId: string) => void;
  onLoadThreadToMain: (threadId: string) => void;
  onNewThread: () => void;
  onRenameThread: (threadId: string, nextTitle: string) => void;
  NAV_ACTIVE_BG: string;
  NAV_HOVER_BG: string;
  persistedQueryRef: React.MutableRefObject<string>;
}) {
  const historyInputRef = useRef<HTMLInputElement | null>(null);
  const historyLiveValueRef = useRef<string>(persistedQueryRef.current || "");
  const composingRef = useRef(false);

  const [query, setQuery] = useState<string>(persistedQueryRef.current || "");
  const [isPending, startTransition] = useTransition();

  // ✅ inline rename state (最小侵入)
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  // 建 index（一次）
  const threadContentIndex = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of historyMessages) {
      const prev = map.get(m.threadId) ?? "";
      map.set(m.threadId, prev + "\n" + m.content);
    }
    return map;
  }, [historyMessages]);

  function threadMatches(t: HistoryThread, qLower: string) {
    if (!qLower) return true;
    const metaText = `${t.title}\n${t.preview}\n${t.updatedAt}`.toLowerCase();
    const msgText = (threadContentIndex.get(t.id) ?? "").toLowerCase();
    return metaText.includes(qLower) || msgText.includes(qLower);
  }

  const filteredThreads = useMemo(() => {
    // 組字中不 filter（避免 IME 卡頓）
    if (composingRef.current) return historyThreads;

    const q = (query || "").trim().toLowerCase();
    if (!q) return historyThreads;

    return historyThreads.filter((t) => threadMatches(t, q));
  }, [query, historyThreads, threadContentIndex]);

  function clearAll() {
    historyLiveValueRef.current = "";
    persistedQueryRef.current = "";
    if (historyInputRef.current) historyInputRef.current.value = "";
    startTransition(() => setQuery(""));
    requestAnimationFrame(() => historyInputRef.current?.focus());
  }

  // 打開時：把 ref 值塞回 input（避免視覺「被清空」）
  useEffect(() => {
    if (!isOpen) return;
    const id = requestAnimationFrame(() => {
      if (historyInputRef.current) {
        historyInputRef.current.value = historyLiveValueRef.current || "";
      }
      historyInputRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [isOpen]);

  // ESC 關閉（你原本邏輯保留；rename 時按 Esc 會被 input 自己吃掉，不影響）
  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  // ===== inline rename helpers（只作用在右側標題）=====
  function beginRename() {
    const t = historyThreads.find((x) => x.id === activeThreadId);
    setRenameValue(t?.title ?? "");
    setIsRenaming(true);
  }

  function commitRename() {
    const next = renameValue.trim();
    if (next) onRenameThread(activeThreadId, next);
    setIsRenaming(false);
  }

  function cancelRename() {
    setIsRenaming(false);
  }

  useEffect(() => {
    if (!isOpen) return;
    if (!isRenaming) return;
    const id = requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
    return () => cancelAnimationFrame(id);
  }, [isOpen, isRenaming]);

  if (!isOpen) return null;

  const currentThread = historyThreads.find((t) => t.id === activeThreadId);
  const threadMessages = historyMessages.filter(
    (m) => m.threadId === activeThreadId
  );
  const showClear = (historyLiveValueRef.current || "").trim().length > 0;

  return (
    <div className="fixed inset-0 z-[60]">
      <div
        className="absolute inset-0"
        style={{ backgroundColor: "rgba(0,0,0,0.35)" }}
        onClick={onClose}
      />

      <div className="absolute inset-0 flex items-start justify-center p-3 md:p-6">
        <div
          className="w-full max-w-5xl h-[88vh] md:h-[82vh] rounded-2xl border overflow-hidden shadow-2xl flex flex-col"
          style={{
            backgroundColor: "var(--navbar-bg)",
            borderColor: "var(--navbar-border)",
            color: "var(--foreground)",
            backdropFilter: "blur(12px)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* header */}
          <div
            className="px-4 py-3 border-b flex items-center justify-between"
            style={{ borderColor: "rgba(148,163,184,0.20)" }}
          >
            <div>
              <div className="text-sm font-semibold">對話紀錄</div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                className="w-9 h-9 rounded-xl flex items-center justify-center transition"
                style={{
                  border: "1px solid rgba(148,163,184,0.18)",
                  backgroundColor: "transparent",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.backgroundColor = NAV_HOVER_BG)
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.backgroundColor = "transparent")
                }
                onClick={onClose}
                title="關閉"
                aria-label="Close"
              >
                <i className="fa-solid fa-xmark text-[14px] opacity-70" />
              </button>
            </div>
          </div>

          {/* content */}
          <div className="flex-1 min-h-0 grid grid-cols-12 gap-4 p-4">
            {/* left */}
            <div
              className="col-span-12 md:col-span-4 min-h-0 rounded-2xl border overflow-hidden flex flex-col"
              style={{ borderColor: "rgba(148,163,184,0.20)" }}
            >
              <div
                className="p-3 border-b"
                style={{ borderColor: "rgba(148,163,184,0.20)" }}
              >
                {/* ✅ 搜尋框：固定 2px 粗，不會 focus 變粗 */}
                <div
                  className="flex items-center gap-2 rounded-xl px-3 py-2"
                  style={{
                    border: "2px solid rgba(148,163,184,0.25)",
                    backgroundColor: "rgba(148,163,184,0.10)",
                  }}
                >
                  <input
                    ref={historyInputRef}
                    type="text"
                    placeholder="搜尋對話紀錄"
                    defaultValue={historyLiveValueRef.current}
                    className="flex-1 bg-transparent outline-none text-sm"
                    style={{ color: "var(--foreground)" }}
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    onCompositionStart={() => {
                      composingRef.current = true;
                    }}
                    onCompositionEnd={(e) => {
                      composingRef.current = false;
                      const v = e.currentTarget.value || "";
                      historyLiveValueRef.current = v;
                      persistedQueryRef.current = v;

                      startTransition(() => setQuery(v));
                    }}
                    onChange={(e) => {
                      const v = e.currentTarget.value;
                      historyLiveValueRef.current = v;
                      persistedQueryRef.current = v;

                      // ✅ 組字中完全不 setState，避免輸入/刪除被打斷
                      if (composingRef.current) return;

                      startTransition(() => setQuery(v));
                    }}
                  />

                  {showClear && (
                    <button
                      type="button"
                      className="w-8 h-8 rounded-lg flex items-center justify-center"
                      style={{ backgroundColor: "transparent" }}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={clearAll}
                      title="清除"
                      aria-label="Clear"
                    >
                      <i className="fa-solid fa-xmark text-[12px] opacity-70" />
                    </button>
                  )}
                </div>

                {/* 小提示：讓你知道目前在做低優先度更新（可刪） */}
                <div className="mt-2 text-[10px] opacity-50">
                  {isPending ? "更新中…" : " "}
                </div>
              </div>

              {/* ✅ 固定捲軸寬度，避免結果變少左右晃 */}
              <div
                className="min-h-0 overflow-y-scroll p-2"
                style={{ scrollbarGutter: "stable" as any }}
              >
                {filteredThreads.length === 0 ? (
                  <div className="p-4 text-sm opacity-60">沒有符合的對話</div>
                ) : (
                  filteredThreads.map((t) => {
                    const active = t.id === activeThreadId;
                    return (
                      <button
                        type="button"
                        key={t.id}
                        tabIndex={-1}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => onSelectThread(t.id)}
                        className="w-full text-left p-3 rounded-xl transition mb-2"
                        style={{
                          backgroundColor: active
                            ? NAV_ACTIVE_BG
                            : "transparent",
                        }}
                        onMouseEnter={(e) => {
                          if (active) return;
                          e.currentTarget.style.backgroundColor = NAV_HOVER_BG;
                        }}
                        onMouseLeave={(e) => {
                          if (active) return;
                          e.currentTarget.style.backgroundColor = "transparent";
                        }}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-sm font-medium truncate">
                            {t.title}
                          </div>
                          <div className="text-[11px] opacity-60 shrink-0">
                            {t.updatedAt}
                          </div>
                        </div>
                        <div className="text-[12px] opacity-70 mt-1 line-clamp-1">
                          {t.preview}
                        </div>
                        <div className="text-[11px] opacity-50 mt-2">
                          {t.messageCount} 則訊息
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {/* right */}
            <div
              className="col-span-12 md:col-span-8 min-h-0 rounded-2xl border overflow-hidden flex flex-col"
              style={{ borderColor: "rgba(148,163,184,0.20)" }}
            >
              <div
                className="px-4 py-3 border-b flex items-center justify-between"
                style={{ borderColor: "rgba(148,163,184,0.20)" }}
              >
                <div className="min-w-0">
                  {/* ✅ 標題 inline rename（不影響其他區塊） */}
                  {isRenaming ? (
                    <input
                      ref={renameInputRef}
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      className="w-full bg-transparent outline-none text-sm font-semibold"
                      style={{
                        color: "var(--foreground)",
                        borderBottom: "1px solid rgba(148,163,184,0.35)",
                        paddingBottom: 2,
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          commitRename();
                        }
                        if (e.key === "Escape") {
                          e.preventDefault();
                          cancelRename();
                        }
                      }}
                      onBlur={() => commitRename()}
                    />
                  ) : (
                    <div
                      className="text-sm font-semibold truncate cursor-text"
                      title="點一下可重新命名"
                      onClick={beginRename}
                      onDoubleClick={beginRename}
                    >
                      {currentThread?.title || "未選擇對話"}
                    </div>
                  )}

                  <div className="text-[11px] opacity-60">
                    {currentThread?.updatedAt || ""}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {/* ✅ 原本 ←返回 改成 重新命名（開啟 inline edit） */}
                  <button
                    type="button"
                    className="text-xs px-3 py-2 rounded-lg transition"
                    style={{ backgroundColor: "transparent" }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.backgroundColor = NAV_HOVER_BG)
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.backgroundColor = "transparent")
                    }
                    onClick={beginRename}
                    title="重新命名此對話"
                  >
                    重新命名
                  </button>

                  {/* ✅ 原本 匯出（假） 改成 繼續聊天（回主畫面） */}
                  <button
                    type="button"
                    className="text-xs px-3 py-2 rounded-lg transition"
                    style={{ backgroundColor: "transparent" }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.backgroundColor = NAV_HOVER_BG)
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.backgroundColor = "transparent")
                    }
                    onClick={() => onLoadThreadToMain(activeThreadId)}
                    title="回到主畫面並繼續聊天"
                  >
                    繼續聊天
                  </button>
                </div>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
                {threadMessages.length === 0 ? (
                  <div className="text-sm opacity-60">這個對話目前沒有訊息</div>
                ) : (
                  threadMessages.map((m) => {
                    const isUser = m.role === "user";
                    return (
                      <div
                        key={m.id}
                        className={`flex ${
                          isUser ? "justify-end" : "justify-start"
                        }`}
                      >
                        <div
                          className="max-w-[min(78%,65ch)] rounded-2xl px-4 py-3 text-sm leading-relaxed"
                          style={{
                            backgroundColor: isUser
                              ? "var(--chat-user-bg)"
                              : "var(--chat-assistant-bg)",
                            color: isUser
                              ? "var(--chat-user-text)"
                              : "var(--chat-assistant-text)",
                          }}
                        >
                          <div className="whitespace-pre-wrap break-words">
                            {m.content}
                          </div>
                          <div className="text-[11px] opacity-60 mt-2 text-right">
                            {m.createdAt}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          <div
            className="px-4 py-3 border-t text-[11px] opacity-60"
            style={{ borderColor: "rgba(148,163,184,0.20)" }}
          >
            提示：按 ESC 可關閉
          </div>
        </div>
      </div>
    </div>
  );
});

export default function LLMPage() {
  // ===== navbar 狀態 =====
  const [isNavCollapsed, setIsNavCollapsed] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  // ✅ 目前頁面
  const [activeView, setActiveView] = useState<ViewKey>("llm");

  // ✅ History overlay
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  // ✅ 搜尋字詞持久化（不觸發 rerender）
  const historyPersistedQueryRef = useRef<string>("");

  // ===== chat 狀態 =====
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 1,
      role: "assistant",
      content:
        "嗨，我是 GalaBone LLM Demo。在這裡輸入你的問題，我會用骨科知識與多模態概念幫你解釋。",
    },
  ]);

  // ✅ 主輸入框：受控（中文/英文）
  const [draftText, setDraftText] = useState("");

  const [loading, setLoading] = useState(false);
  const [showToolMenu, setShowToolMenu] = useState(false);

  const [pendingFiles, setPendingFiles] = useState<UploadedFile[]>([]);

  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const baseHeightRef = useRef<number | null>(null);
  const [isMultiLine, setIsMultiLine] = useState(false);
  const [inputBoxHeight, setInputBoxHeight] = useState(MIN_HEIGHT);

  const isExpanded = isMultiLine || pendingFiles.length > 0;

  // ✅ 假的 thread 清單（改成可更新：只為了 rename，不影響其他行為）
  const [historyThreads, setHistoryThreads] = useState<HistoryThread[]>([
    {
      id: "t-001",
      title: "骨折分類與處置",
      updatedAt: "今天 21:10",
      preview: "骨折就是骨頭出現裂痕或斷裂…",
      messageCount: 8,
    },
    {
      id: "t-002",
      title: "L/R Mark 與左右判斷",
      updatedAt: "昨天 17:42",
      preview: "手部 X 光只有一隻手時，可以用…",
      messageCount: 12,
    },
    {
      id: "t-003",
      title: "資料庫 Bone_Info 對應規則",
      updatedAt: "12/10 13:05",
      preview: "Cervical_Vertebrae → Cervical vertebrae…",
      messageCount: 6,
    },
  ]);

  // ✅ 假的 messages
  const [historyMessages] = useState<HistoryMessage[]>([
    // t-001
    {
      id: "m-001",
      threadId: "t-001",
      role: "user",
      content: "骨折是什麼？會怎麼治療？",
      createdAt: "21:08",
    },
    {
      id: "m-002",
      threadId: "t-001",
      role: "assistant",
      content:
        "骨折是骨頭出現裂痕或斷裂，嚴重程度可從細小裂縫到完全斷開。常用 X 光判斷位置與型態，治療可能包含固定、石膏或手術。",
      createdAt: "21:09",
    },
    {
      id: "m-003",
      threadId: "t-001",
      role: "user",
      content: "那粉碎性骨折跟一般骨折差在哪？",
      createdAt: "21:09",
    },
    {
      id: "m-004",
      threadId: "t-001",
      role: "assistant",
      content:
        "粉碎性骨折通常代表骨頭裂成多塊，穩定性更差，常需要更積極的固定方式（例如手術內固定）才能恢復對位與功能。",
      createdAt: "21:10",
    },

    // t-002
    {
      id: "m-005",
      threadId: "t-002",
      role: "user",
      content: "很多手部 X 光只有一隻手，怎麼判斷左右？",
      createdAt: "17:40",
    },
    {
      id: "m-006",
      threadId: "t-002",
      role: "assistant",
      content:
        "最穩的做法是把片上的 L/R Marker 當成 meta 訊息；若沒有 marker，可再搭配解剖特徵（例如拇指方向、尺橈骨相對位置）做 fallback。",
      createdAt: "17:41",
    },

    // t-003
    {
      id: "m-007",
      threadId: "t-003",
      role: "user",
      content: "辨識出的名字跟資料庫不一樣怎麼辦？",
      createdAt: "13:03",
    },
    {
      id: "m-008",
      threadId: "t-003",
      role: "assistant",
      content:
        "可以做一層 mapping（dictionary / table），把 YOLO class 名稱標準化成 DB 的 bone_en（例如底線換空白、大小寫、特例對應）。",
      createdAt: "13:04",
    },
  ]);

  const [activeThreadId, setActiveThreadId] = useState<string>("t-001");

  // ✅ 統一 hover/active 顏色
  const NAV_ACTIVE_BG = "rgba(148,163,184,0.16)";
  const NAV_HOVER_BG = "rgba(148,163,184,0.10)";

  // ✅ rename：只更新 title（最小改動）
  function renameThread(threadId: string, nextTitle: string) {
    const title = nextTitle.trim();
    if (!title) return;

    setHistoryThreads((prev) =>
      prev.map((t) => (t.id === threadId ? { ...t, title } : t))
    );
  }

  // =========================
  // thread → 主畫面 messages
  // =========================
  function buildChatMessagesFromThread(threadId: string): ChatMessage[] {
    const threadMsgs = historyMessages
      .filter((m) => m.threadId === threadId)
      .map((m, idx) => ({
        id: Date.now() + idx,
        role: m.role,
        content: m.content,
      }));

    if (threadMsgs.length === 0) {
      return [
        {
          id: 1,
          role: "assistant",
          content:
            "嗨，我是 GalaBone LLM Demo。在這裡輸入你的問題，我會用骨科知識與多模態概念幫你解釋。",
        },
      ];
    }

    return threadMsgs;
  }

  function resetMainInputBox() {
    setDraftText("");
    baseHeightRef.current = null;
    setIsMultiLine(false);
    setInputBoxHeight(MIN_HEIGHT);

    if (inputRef.current) {
      inputRef.current.style.height = `${MIN_HEIGHT}px`;
      inputRef.current.scrollTop = 0;
    }
  }

  function loadThreadToMain(threadId: string) {
    setActiveThreadId(threadId);
    setActiveView("llm");
    setMessages(buildChatMessagesFromThread(threadId));

    resetMainInputBox();

    setPendingFiles((prev) => {
      prev.forEach((f) => URL.revokeObjectURL(f.url));
      return [];
    });

    setIsHistoryOpen(false);
    setTimeout(() => inputRef.current?.focus(), 60);
  }

  function newThread() {
    const newId = `t-${Date.now()}`;
    setActiveThreadId(newId);
    setActiveView("llm");

    setMessages([
      {
        id: Date.now(),
        role: "assistant",
        content:
          "嗨，我是 GalaBone LLM Demo。在這裡輸入你的問題，我會用骨科知識與多模態概念幫你解釋。",
      },
    ]);

    resetMainInputBox();

    setPendingFiles((prev) => {
      prev.forEach((f) => URL.revokeObjectURL(f.url));
      return [];
    });

    setIsHistoryOpen(false);
    setTimeout(() => inputRef.current?.focus(), 60);
  }

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
    if (activeView !== "llm") return;
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, activeView]);

  useEffect(() => {
    requestAnimationFrame(() => autoResizeTextarea());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftText, isMultiLine]);

  // 點外面自動關 tool menu
  useEffect(() => {
    function onDown(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-tool-menu-root]")) setShowToolMenu(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  // ===== 檔案處理 =====
  function handleUploadClick() {
    fileInputRef.current?.click();
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newFiles: UploadedFile[] = Array.from(files).map((file) => ({
      id: `${Date.now()}-${file.name}-${Math.random().toString(36).slice(2)}`,
      name: file.name,
      size: file.size,
      type: file.type,
      url: URL.createObjectURL(file),
    }));

    setPendingFiles((prev) => [...prev, ...newFiles]);
    e.target.value = "";
  }

  function removePendingFile(id: string) {
    setPendingFiles((prev) => {
      const t = prev.find((f) => f.id === id);
      if (t) URL.revokeObjectURL(t.url);
      return prev.filter((f) => f.id !== id);
    });
  }

  // ===== 送出訊息 =====
  async function sendMessage(e?: FormEvent) {
    if (e) e.preventDefault();

    const text = draftText.trim();
    if ((!text && pendingFiles.length === 0) || loading) return;

    const userMessage: ChatMessage = {
      id: Date.now(),
      role: "user",
      content: text,
      files: pendingFiles.length ? pendingFiles : undefined,
    };

    setMessages((prev) => [...prev, userMessage]);

    resetMainInputBox();

    setPendingFiles((prev) => {
      prev.forEach((f) => URL.revokeObjectURL(f.url));
      return [];
    });

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
    // IME 組字中不要送出
    // @ts-ignore
    if (e.nativeEvent?.isComposing) return;

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function handleExport(type: "pdf" | "ppt") {
    setShowToolMenu(false);
    console.log("export:", type);
  }

  // ===== Tool menu =====
  function ToolMenuItem({
    iconClass,
    label,
    onClick,
  }: {
    iconClass: string;
    label: string;
    onClick: () => void;
  }) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="w-full text-left px-3 py-[8px] flex items-center gap-2"
        style={{ cursor: "pointer" }}
        onMouseEnter={(e) =>
          (e.currentTarget.style.backgroundColor = NAV_HOVER_BG)
        }
        onMouseLeave={(e) =>
          (e.currentTarget.style.backgroundColor = "transparent")
        }
      >
        <span className="w-5 h-5 flex items-center justify-center shrink-0">
          <i className={`${iconClass} text-[12px] opacity-70`} />
        </span>
        <span className="leading-none text-[12px]">{label}</span>
      </button>
    );
  }

  function ToolMenuDivider() {
    return (
      <div
        className="mx-3 my-1 h-px"
        style={{ backgroundColor: "rgba(148,163,184,0.22)" }}
      />
    );
  }

  function ToolMenu() {
    return (
      <div
        className="absolute left-0 bottom-full mb-2 w-36 rounded-xl overflow-hidden z-30 border"
        style={{
          backgroundColor: "var(--background)",
          borderColor: "var(--navbar-border)",
          color: "var(--foreground)",
          boxShadow: "0 18px 40px rgba(15,23,42,0.18)",
        }}
      >
        <ToolMenuItem
          iconClass="fa-solid fa-cloud-arrow-up"
          label="上傳檔案"
          onClick={() => {
            setShowToolMenu(false);
            handleUploadClick();
          }}
        />
        <ToolMenuDivider />
        <ToolMenuItem
          iconClass="fa-solid fa-file-pdf"
          label="匯出 PDF"
          onClick={() => handleExport("pdf")}
        />
        <ToolMenuItem
          iconClass="fa-solid fa-file-powerpoint"
          label="匯出 PPT"
          onClick={() => handleExport("ppt")}
        />
      </div>
    );
  }

  // ===== message files =====
  function renderMessageFiles(files?: UploadedFile[]) {
    if (!files || files.length === 0) return null;

    return (
      <div className="mt-2 max-h-40 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
        {files.map((file) => {
          const isImage =
            typeof file.type === "string" && file.type.startsWith("image/");
          return (
            <div
              key={file.id}
              className="border rounded-xl px-2 py-2 flex items-center gap-2 bg-black/5"
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

  // ===== Sidebar UI =====
  function SideIconButton({
    iconClass,
    label,
    active,
    onClick,
  }: {
    iconClass: string;
    label: string;
    active?: boolean;
    onClick?: () => void;
  }) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="w-11 h-11 rounded-xl flex items-center justify-center transition"
        style={{ backgroundColor: active ? NAV_ACTIVE_BG : "transparent" }}
        onMouseEnter={(e) => {
          if (active) return;
          e.currentTarget.style.backgroundColor = NAV_HOVER_BG;
        }}
        onMouseLeave={(e) => {
          if (active) return;
          e.currentTarget.style.backgroundColor = "transparent";
        }}
        title={label}
      >
        <i className={`${iconClass} text-[18px] opacity-75`} />
      </button>
    );
  }

  function SideRow({
    iconClass,
    label,
    active,
    onClick,
  }: {
    iconClass: string;
    label: string;
    active?: boolean;
    onClick?: () => void;
  }) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="w-full flex items-center gap-3 px-3 py-2 rounded-lg transition"
        style={{ backgroundColor: active ? NAV_ACTIVE_BG : "transparent" }}
        onMouseEnter={(e) => {
          if (active) return;
          e.currentTarget.style.backgroundColor = NAV_HOVER_BG;
        }}
        onMouseLeave={(e) => {
          if (active) return;
          e.currentTarget.style.backgroundColor = "transparent";
        }}
      >
        <i className={`${iconClass} text-[16px] opacity-75`} />
        <span>{label}</span>
      </button>
    );
  }

  function SideThreadItem({
    title,
    meta,
    active,
    onClick,
  }: {
    title: string;
    meta?: string;
    active?: boolean;
    onClick: () => void;
  }) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="w-full text-left px-3 py-2 rounded-lg transition"
        style={{ backgroundColor: active ? NAV_ACTIVE_BG : "transparent" }}
        onMouseEnter={(e) => {
          if (active) return;
          e.currentTarget.style.backgroundColor = NAV_HOVER_BG;
        }}
        onMouseLeave={(e) => {
          if (active) return;
          e.currentTarget.style.backgroundColor = "transparent";
        }}
        title={title}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="text-[13px] font-medium truncate">{title}</div>
          {meta && (
            <div className="text-[11px] opacity-60 shrink-0">{meta}</div>
          )}
        </div>
      </button>
    );
  }

  function openHistory() {
    setIsHistoryOpen(true);
    // ✅ 不清空：你要字留在搜尋欄
  }

  function PlaceholderView({ title }: { title: string }) {
    return (
      <section className="flex-1 min-h-0 flex flex-col">
        <div className="mb-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="text-[11px] opacity-60">（先放佔位，之後再補功能）</p>
        </div>
        <div
          className="flex-1 rounded-2xl border flex items-center justify-center text-sm opacity-70"
          style={{ borderColor: "rgba(148,163,184,0.20)" }}
        >
          這裡是「{title}」頁面（假頁面）
        </div>
      </section>
    );
  }

  return (
    <div
      className="h-[calc(100vh-4rem)] flex overflow-hidden transition-colors duration-500 relative"
      style={{
        backgroundColor: "var(--background)",
        color: "var(--foreground)",
      }}
    >
      <HistoryOverlay
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        historyThreads={historyThreads}
        historyMessages={historyMessages}
        activeThreadId={activeThreadId}
        onSelectThread={(id) => setActiveThreadId(id)}
        onLoadThreadToMain={(id) => loadThreadToMain(id)}
        onNewThread={() => newThread()}
        onRenameThread={renameThread}
        NAV_ACTIVE_BG={NAV_ACTIVE_BG}
        NAV_HOVER_BG={NAV_HOVER_BG}
        persistedQueryRef={historyPersistedQueryRef}
      />

      <button
        type="button"
        className="md:hidden absolute left-3 top-3 z-40 w-9 h-9 rounded-xl flex items-center justify-center bg-white/60 backdrop-blur"
        style={{ border: "1px solid rgba(148,163,184,0.18)" }}
        onClick={() => setIsMobileNavOpen(true)}
        aria-label="Open sidebar"
        title="開啟導覽列"
      >
        <i className="fa-solid fa-bars text-[14px] opacity-70" />
      </button>

      {/* Desktop sidebar */}
      <div className="hidden md:block">
        <aside
          className={`h-full flex flex-col border-r transition-all duration-300 ease-out ${
            isNavCollapsed ? "w-[72px]" : "w-64"
          }`}
          style={{
            backgroundColor: "rgba(148,163,184,0.06)",
            borderColor: "rgba(148,163,184,0.20)",
            color: "var(--navbar-text)",
          }}
        >
          {/* Header */}
          <div
            className="border-b"
            style={{ borderColor: "rgba(148,163,184,0.20)" }}
          >
            <div
              className={`flex items-start justify-between ${
                isNavCollapsed ? "px-3 pt-3 pb-3" : "px-4 pt-4 pb-3"
              }`}
            >
              {!isNavCollapsed ? (
                <div>
                  <h1 className="text-lg font-semibold tracking-wide">
                    GalaBone
                  </h1>
                  <p className="text-[11px] mt-1 opacity-70">
                    Your Bone We Care
                  </p>
                </div>
              ) : (
                <div className="h-9" />
              )}

              <button
                type="button"
                onClick={() => setIsNavCollapsed((v) => !v)}
                title={isNavCollapsed ? "展開導覽列" : "收合導覽列"}
                className="w-11 h-11 rounded-xl flex items-center justify-center transition"
                style={{
                  border: "1px solid rgba(148,163,184,0.18)",
                  backgroundColor: "transparent",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.backgroundColor = NAV_HOVER_BG)
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.backgroundColor = "transparent")
                }
              >
                <i
                  className={`fa-solid ${
                    isNavCollapsed ? "fa-chevron-right" : "fa-chevron-left"
                  } text-[14px] opacity-70 transition-transform duration-200 ease-out group-hover:rotate-180`}
                />
              </button>
            </div>
          </div>

          {/* Nav */}
          <nav
            className={`flex-1 min-h-0 ${
              isNavCollapsed ? "px-2 pt-3" : "px-3 pt-4"
            }`}
          >
            {!isNavCollapsed ? (
              <div className="h-full min-h-0 flex flex-col gap-2 text-sm">
                <div className="space-y-1">
                  <SideRow
                    iconClass="fa-regular fa-message"
                    label="新對話"
                    active={activeView === "llm"}
                    onClick={() => newThread()}
                  />
                </div>

                <div className="space-y-1">
                  <SideRow
                    iconClass="fa-solid fa-wand-magic-sparkles"
                    label="EduGen"
                    active={activeView === "edugen"}
                    onClick={() => setActiveView("edugen")}
                  />
                  <SideRow
                    iconClass="fa-solid fa-folder-tree"
                    label="資源管理"
                    active={activeView === "assets"}
                    onClick={() => setActiveView("assets")}
                  />
                  <SideRow
                    iconClass="fa-regular fa-clock"
                    label="對話紀錄"
                    active={isHistoryOpen}
                    onClick={() => openHistory()}
                  />
                </div>

                <div className="min-h-0 flex-1 flex flex-col">
                  <div className="flex items-center justify-between px-1 mb-2">
                    <p className="text-[11px] tracking-wide opacity-60">
                      最近對話
                    </p>
                    <button
                      type="button"
                      className="text-[11px] opacity-60 hover:opacity-90 transition"
                      onClick={() => openHistory()}
                      title="搜尋與管理對話"
                    >
                      搜尋
                    </button>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto space-y-1 pr-1">
                    {historyThreads.slice(0, 8).map((t) => (
                      <SideThreadItem
                        key={t.id}
                        title={t.title}
                        meta={t.updatedAt}
                        active={activeThreadId === t.id}
                        onClick={() => loadThreadToMain(t.id)}
                      />
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 pt-2">
                <SideIconButton
                  iconClass="fa-regular fa-message"
                  label="新對話"
                  active={activeView === "llm"}
                  onClick={() => newThread()}
                />
                <SideIconButton
                  iconClass="fa-solid fa-wand-magic-sparkles"
                  label="EduGen"
                  active={activeView === "edugen"}
                  onClick={() => setActiveView("edugen")}
                />
                <SideIconButton
                  iconClass="fa-solid fa-folder-tree"
                  label="資源管理"
                  active={activeView === "assets"}
                  onClick={() => setActiveView("assets")}
                />
                <SideIconButton
                  iconClass="fa-regular fa-clock"
                  label="對話紀錄"
                  active={isHistoryOpen}
                  onClick={() => openHistory()}
                />
              </div>
            )}
          </nav>

          <div
            className={`border-t ${isNavCollapsed ? "px-2 py-3" : "px-4 py-3"}`}
            style={{ borderColor: "rgba(148,163,184,0.20)" }}
          >
            {isNavCollapsed ? (
              <div className="flex justify-center">
                <SideIconButton iconClass="fa-solid fa-gear" label="設定" />
              </div>
            ) : (
              <button
                type="button"
                className="w-full flex items-center gap-2 text-[12px] opacity-75 hover:opacity-100 transition"
              >
                <i className="fa-solid fa-gear text-[12px] opacity-80" />
                <span>設定</span>
              </button>
            )}
          </div>
        </aside>
      </div>

      {/* Mobile drawer */}
      {isMobileNavOpen && (
        <div className="md:hidden fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setIsMobileNavOpen(false)}
          />
          <div
            className="absolute left-0 top-0 bottom-0 w-[78%] max-w-[320px] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <aside
              className="h-full w-full border-r flex flex-col"
              style={{
                backgroundColor: "rgba(148,163,184,0.06)",
                borderColor: "rgba(148,163,184,0.20)",
                color: "var(--navbar-text)",
              }}
            >
              <div
                className="px-4 pt-4 pb-3 border-b"
                style={{ borderColor: "rgba(148,163,184,0.20)" }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h1 className="text-lg font-semibold tracking-wide">
                      GalaBone
                    </h1>
                    <p className="text-[11px] mt-1 opacity-70">
                      Your Bone We Care
                    </p>
                  </div>
                  <button
                    type="button"
                    className="w-9 h-9 rounded-xl flex items-center justify-center transition"
                    style={{
                      border: "1px solid rgba(148,163,184,0.18)",
                      backgroundColor: "transparent",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.backgroundColor = NAV_HOVER_BG)
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.backgroundColor = "transparent")
                    }
                    onClick={() => setIsMobileNavOpen(false)}
                    title="關閉導覽列"
                  >
                    <i className="fa-solid fa-xmark text-[14px] opacity-70" />
                  </button>
                </div>
              </div>

              <nav className="flex-1 min-h-0 px-3 pt-4 text-sm space-y-2 overflow-y-auto">
                <div className="space-y-1">
                  <SideRow
                    iconClass="fa-regular fa-message"
                    label="新對話"
                    active={activeView === "llm"}
                    onClick={() => {
                      newThread();
                      setIsMobileNavOpen(false);
                    }}
                  />
                </div>

                <div className="space-y-1">
                  <SideRow
                    iconClass="fa-solid fa-wand-magic-sparkles"
                    label="EduGen"
                    active={activeView === "edugen"}
                    onClick={() => {
                      setActiveView("edugen");
                      setIsMobileNavOpen(false);
                    }}
                  />
                  <SideRow
                    iconClass="fa-solid fa-folder-tree"
                    label="資源管理"
                    active={activeView === "assets"}
                    onClick={() => {
                      setActiveView("assets");
                      setIsMobileNavOpen(false);
                    }}
                  />
                  <SideRow
                    iconClass="fa-regular fa-clock"
                    label="對話紀錄"
                    active={isHistoryOpen}
                    onClick={() => {
                      setIsMobileNavOpen(false);
                      openHistory();
                    }}
                  />
                </div>

                <div className="pt-2">
                  <div className="flex items-center justify-between px-1 mb-2">
                    <p className="text-[11px] tracking-wide opacity-60">
                      最近對話
                    </p>
                    <button
                      type="button"
                      className="text-[11px] opacity-60 hover:opacity-90 transition"
                      onClick={() => {
                        setIsMobileNavOpen(false);
                        openHistory();
                      }}
                    >
                      搜尋
                    </button>
                  </div>
                  <div className="space-y-1">
                    {historyThreads.slice(0, 8).map((t) => (
                      <SideThreadItem
                        key={t.id}
                        title={t.title}
                        meta={t.updatedAt}
                        active={activeThreadId === t.id}
                        onClick={() => {
                          loadThreadToMain(t.id);
                          setIsMobileNavOpen(false);
                        }}
                      />
                    ))}
                  </div>
                </div>
              </nav>

              <div
                className="px-4 py-3 border-t"
                style={{ borderColor: "rgba(148,163,184,0.20)" }}
              >
                <button
                  type="button"
                  className="w-full flex items-center gap-2 text-[12px] opacity-75 hover:opacity-100 transition"
                >
                  <i className="fa-solid fa-gear text-[12px] opacity-80" />
                  <span>設定</span>
                </button>
              </div>
            </aside>
          </div>
        </div>
      )}

      {/* Main */}
      <div className="flex-1 min-h-0 flex flex-col px-6 py-6 gap-4 overflow-hidden llm-main-shell">
        {activeView === "edugen" ? (
          <PlaceholderView title="EduGen" />
        ) : activeView === "assets" ? (
          <PlaceholderView title="資源管理" />
        ) : (
          <section className="flex-1 min-h-0 flex flex-col relative">
            <div className="flex items-center justify-between mb-2 text-xs opacity-70 px-1" />

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
                          <div className="flex flex-col items-stretch max-w-[min(70%,60ch)]">
                            <div
                              className="whitespace-pre-wrap break-words leading-relaxed px-4 py-3 rounded-2xl"
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
                            {renderMessageFiles(msg.files)}
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {loading && (
                    <div className="flex justify-start mb-4">
                      <div
                        className="text-xs px-4 py-2 max-w-[min(70%,60ch)] rounded-2xl"
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

            <div
              className="sticky bottom-0 left-0 right-0 pt-3 pb-4 transition-colors duration-500"
              style={{ backgroundColor: "var(--background)" }}
            >
              <form onSubmit={sendMessage}>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={handleFileChange}
                />

                <div className="w-full flex justify-center">
                  <div className="flex items-end gap-3 w-full max-w-3xl">
                    <div className="flex-1 relative">
                      <div
                        className={`relative border px-4 py-2 shadow-lg backdrop-blur-sm ${
                          isExpanded ? "rounded-2xl" : "rounded-full"
                        } transition-colors duration-500 neon-shell`}
                        style={{
                          backgroundColor: "var(--navbar-bg)",
                          borderColor: "var(--navbar-border)",
                          color: "var(--foreground)",
                        }}
                        data-tool-menu-root
                      >
                        {showToolMenu && <ToolMenu />}

                        <div className="flex flex-col gap-2">
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
                            {!isExpanded && (
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => setShowToolMenu((v) => !v)}
                                  className="flex items-center gap-1 text-xs"
                                  style={{
                                    backgroundColor: "transparent",
                                    color: "var(--foreground)",
                                  }}
                                >
                                  <i className="fa-solid fa-sliders text-[11px] opacity-75" />
                                  <span>工具</span>
                                  <span className="text-[10px]">
                                    {showToolMenu ? "▴" : "▾"}
                                  </span>
                                </button>
                              </div>
                            )}

                            <textarea
                              ref={inputRef}
                              value={draftText}
                              onChange={(e) => {
                                setDraftText(e.target.value);
                                requestAnimationFrame(() =>
                                  autoResizeTextarea()
                                );
                              }}
                              onKeyDown={handleKeyDown}
                              placeholder="提出任何問題⋯"
                              rows={1}
                              className={`custom-scroll bg-transparent resize-none border-none outline-none text-sm leading-relaxed overflow-hidden placeholder:text-slate-500 ${
                                isExpanded ? "w-full" : "flex-1"
                              }`}
                              style={{
                                color: "var(--foreground)",
                                caretColor: "var(--foreground)",
                              }}
                              autoComplete="off"
                              autoCorrect="off"
                              spellCheck={false}
                            />

                            {!isExpanded && (
                              <div className="flex items-center gap-3">
                                <span className="text-[10px] text-emerald-400">
                                  ●
                                </span>
                                <button
                                  type="submit"
                                  disabled={
                                    (!draftText.trim() &&
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

                          {isExpanded && (
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => setShowToolMenu((v) => !v)}
                                  className="flex items-center gap-1 text-xs"
                                  style={{
                                    backgroundColor: "transparent",
                                    color: "var(--foreground)",
                                  }}
                                >
                                  <i className="fa-solid fa-sliders text-[11px] opacity-75" />
                                  <span>工具</span>
                                  <span className="text-[10px]">
                                    {showToolMenu ? "▴" : "▾"}
                                  </span>
                                </button>
                              </div>

                              <div className="flex items-center gap-3">
                                <span className="text-[10px] text-emerald-400">
                                  ●
                                </span>
                                <button
                                  type="submit"
                                  disabled={
                                    (!draftText.trim() &&
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
                  </div>
                </div>
              </form>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

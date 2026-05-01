export type AppLocale = "zh-TW" | "en-US";

export const DEFAULT_LOCALE: AppLocale = "zh-TW";

export const LOCALE_LABELS: Record<AppLocale, string> = {
  "zh-TW": "繁體中文",
  "en-US": "English",
};

export const messages: Record<AppLocale, Record<string, string>> = {
  "zh-TW": {
    newChat: "新對話",
    history: "對話紀錄",
    recentChats: "最近對話",
    search: "搜尋",
    settings: "設定",
    resourceManagement: "資源管理",
    ragMode: "RAG 模式",
    askPlaceholder: "提出任何問題⋯",
    tools: "工具",
    uploadFile: "上傳檔案",
    exportPdf: "匯出 PDF",
    exportPpt: "匯出 PPT",
    thinking: "正在思考中…",
    reference: "參考資料",
    relatedFeatures: "相關功能",
    followUpQuestions: "延伸學習問題",
    close: "關閉",
    rename: "重新命名",
    continueChat: "繼續聊天",
    noMatchedChats: "沒有符合的對話",
    noMessages: "這個對話目前沒有訊息",
    language: "語言",
    welcomeText: `嗨，我是 GalaBone LLM 知識小助手。

我們的目標是成為骨科醫護的好幫手，幫你快速理解醫療報告、病歷記錄，甚至是 X 光影像裡的骨頭狀況。
依據：各大醫院刊登衛教之文件、PubMed 文獻、以及我們團隊整理的骨科專業資料庫。

使用說明：
1. 你可以直接輸入醫療報告裡的文字，或是病歷記錄的內容，我會盡力幫你解釋。
2. 如果你有 X 光影像的分析結果，也可以輸入給我。
3. GalaBone 的回覆僅供學習與輔助理解，醫療決策仍應諮詢專業醫護人員。
4. 請勿輸入任何敏感個資或真實姓名。
5. 如果你有任何建議或回饋，歡迎告訴我們。`,
  },

  "en-US": {
    newChat: "New chat",
    history: "Chat history",
    recentChats: "Recent chats",
    search: "Search",
    settings: "Settings",
    resourceManagement: "Resource management",
    ragMode: "RAG mode",
    askPlaceholder: "Ask anything…",
    tools: "Tools",
    uploadFile: "Upload file",
    exportPdf: "Export PDF",
    exportPpt: "Export PPT",
    thinking: "Thinking…",
    reference: "References",
    relatedFeatures: "Related features",
    followUpQuestions: "Follow-up questions",
    close: "Close",
    rename: "Rename",
    continueChat: "Continue chat",
    noMatchedChats: "No matching conversations",
    noMessages: "This conversation has no messages yet",
    language: "Language",
    welcomeText: `Hi, I’m GalaBone, your orthopedic knowledge assistant.

GalaBone helps users understand medical reports, clinical notes, and bone-related findings from X-ray analysis.
Its knowledge sources include hospital health education materials, PubMed literature, and the orthopedic knowledge base organized by our team.

Instructions:
1. You can enter medical report text or clinical note content, and I will help explain it.
2. You may also provide X-ray detection results, such as bone names or suspected findings.
3. GalaBone is intended for learning and auxiliary explanation only. Medical decisions should still be made with healthcare professionals.
4. Please do not enter sensitive personal information or real names.
5. Feedback is welcome.`,
  },
};

export function getSavedLocale(): AppLocale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;

  const saved = localStorage.getItem("galabone_locale") as AppLocale | null;

  if (saved === "zh-TW" || saved === "en-US") {
    return saved;
  }

  return DEFAULT_LOCALE;
}

export function saveLocale(locale: AppLocale) {
  if (typeof window !== "undefined") {
    localStorage.setItem("galabone_locale", locale);
  }
}
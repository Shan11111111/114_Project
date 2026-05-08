export type AppLocale = "zh-TW" | "en-US";

export const DEFAULT_LOCALE: AppLocale = "zh-TW";

export const LOCALE_LABELS: Record<AppLocale, string> = {
  "zh-TW": "繁體中文",
  "en-US": "English",
};

export const messages: Record<AppLocale, Record<string, string>> = {
  "zh-TW": {
    "common.language": "語言",

    "nav.home": "首頁",
    "nav.boneDetection": "骨骼辨識",
    "nav.boneKnowledge": "骨骼知識庫",
    "nav.boneModel3d": "3D 骨骼模型",
    "nav.materials": "教材管理",
    "nav.accountManagement": "帳號管理",
    "nav.accountCenter": "帳戶中心",
    "nav.loginRegister": "登入 / 註冊",
    "nav.logout": "登出",
    "nav.menu": "選單",
    "nav.unnamedUser": "未命名使用者",
    "nav.switchToEnglish": "切換英文",
    "nav.switchToChinese": "切換中文",

    /* LLM */

    "llm.newChat": "新對話",
    "llm.history": "對話紀錄",
    "llm.historyTitle": "對話紀錄",
    "llm.recentChats": "最近對話",
    "llm.search": "搜尋",
    "llm.searchHistory": "搜尋對話紀錄",
    "llm.searchAndManageChats": "搜尋與管理對話",
    "llm.settings": "設定",
    "llm.resourceManagement": "資源管理",
    "llm.ragMode": "RAG 模式",
    "llm.askPlaceholder": "提出任何問題⋯",
    "llm.tools": "工具",
    "llm.uploadFile": "上傳檔案",
    "llm.exportPdf": "匯出 PDF",
    "llm.exportPpt": "匯出 PPT",
    "llm.thinking": "正在思考中…",
    "llm.reference": "參考資料",
    "llm.relatedFeatures": "相關功能",
    "llm.followUpQuestions": "延伸學習問題",
    "llm.chatHistory": "對話紀錄",
    "llm.close": "關閉",
    "llm.clear": "清除",
    "llm.more": "更多",
    "llm.share": "分享",
    "llm.delete": "刪除",
    "llm.rename": "重新命名",
    "llm.renameConversation": "重新命名",
    "llm.continueChat": "繼續聊天",
    "llm.noMatchedChats": "沒有符合的對話",
    "llm.noMessages": "這個對話目前沒有訊息",
    "llm.noConversationSelected": "未選擇對話",
    "llm.updating": "更新中…",
    "llm.messages": "則訊息",
    "llm.backToList": "返回列表",
    "llm.pressEscToClose": "提示：按 ESC 可關閉",
    "llm.language": "語言",
    "welcomeText": `嗨，我是 GalaBone LLM 知識小助手。

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
    "common.language": "Language",

    "nav.home": "Home",
    "nav.boneDetection": "Detection",
    "nav.boneKnowledge": "Knowledge Base",
    "nav.boneModel3d": "3D Model",
    "nav.materials": "Materials",
    "nav.accountManagement": "Account Management",
    "nav.accountCenter": "Account Center",
    "nav.loginRegister": "Login / Register",
    "nav.logout": "Logout",
    "nav.menu": "Menu",
    "nav.unnamedUser": "Unnamed User",
    "nav.switchToEnglish": "Switch to English",
    "nav.switchToChinese": "Switch to Chinese",

    /* LLM */
    "llm.newChat": "New chat",
    "llm.history": "Chat history",
    "llm.historyTitle": "Chat history",
    "llm.recentChats": "Recent chats",
    "llm.search": "Search",
    "llm.searchHistory": "Search conversations",
    "llm.searchAndManageChats": "Search and manage chats",
    "llm.settings": "Settings",
    "llm.resourceManagement": "Resource management",
    "llm.ragMode": "RAG mode",
    "llm.askPlaceholder": "Ask anything...",
    "llm.tools": "Tools",
    "llm.uploadFile": "Upload file",
    "llm.exportPdf": "Export PDF",
    "llm.exportPpt": "Export PPT",
    "llm.thinking": "Thinking…",
    "llm.reference": "References",
    "llm.relatedFeatures": "Related features",
    "llm.followUpQuestions": "Follow-up questions",
    "llm.chatHistory": "Chat history",
    "llm.close": "Close",
    "llm.clear": "Clear",
    "llm.more": "More",
    "llm.share": "Share",
    "llm.delete": "Delete",
    "llm.rename": "Rename",
    "llm.renameConversation": "Rename",
    "llm.continueChat": "Continue chat",
    "llm.noMatchedChats": "No matching conversations",
    "llm.noMessages": "This conversation has no messages yet",
    "llm.noConversationSelected": "No conversation selected",
    "llm.updating": "Updating...",
    "llm.messages": "messages",
    "llm.backToList": "Back to list",
    "llm.pressEscToClose": "Tip: Press ESC to close",
    "llm.language": "Language",
    "welcomeText": `Hi, I’m GalaBone, your orthopedic knowledge assistant.

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
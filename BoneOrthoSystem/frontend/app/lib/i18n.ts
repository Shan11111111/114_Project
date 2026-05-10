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
    "nav.boneDetection": "進階X光骨骼辨識",
    "nav.boneKnowledge": "知識小罐頭",
    "nav.boneModel3d": "3D 骨骼模型",
    "nav.materials": "教材管理",
    "nav.accountManagement": "帳號管理",
    "nav.accountCenter": "帳號登入面板",
    "nav.loginRegister": "登入 / 註冊",
    "nav.logout": "登出",
    "nav.menu": "選單",
    "nav.unnamedUser": "未命名使用者",
    "nav.switchToEnglish": "切換英文",
    "nav.switchToChinese": "切換中文",

    /* LLM */

    "llm.newChat": "開啟新的對話回憶",
    "llm.history": "和小罐頭的對話紀錄",
    "llm.historyTitle": "我們的對話紀錄",
    "llm.recentChats": "最近對話",
    "llm.search": "搜尋",
    "llm.searchHistory": "搜尋對話紀錄",
    "llm.searchAndManageChats": "搜尋與管理對話",
    "llm.settings": "設定",
    "llm.resourceManagement": "(未來) 資源管理",
    "llm.ragMode": "RAG 模式",
    "llm.askPlaceholder": "提出任何問題⋯",
    "llm.tools": "工具",
    "llm.uploadFile": "上傳檔案拿摘要",
    "llm.exportPdf": "專屬聊天回憶 PDF",
    "llm.exportPpt": "專屬聊天回憶 PPT",
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
    "welcomeText": `我聽 Bone寶 說，你是我們系統的新住民！
我是知識小罐頭 GalaBone RAG，很高興認識你。

小罐頭想陪你在 206 根骨骼學習上走得更開心。你可以問我骨骼相關的小知識，也可以上傳文字型檔案，例如 PDF、CSV，我會幫你快速整理摘要，不用再被長長的文件追著跑。

小罐頭也可以幫你出小測驗，看看你對骨骼位置、功能、分類、影像判讀或臨床注意事項理解到哪裡。

小罐頭不會亂講話回你。我的回答會盡量依據：
1. 各大醫院刊登的衛教文件
2. PubMed 文獻
3. 輔大醫院授權的去識別化臨床醫囑表
4. GalaBone 團隊整理的骨科知識資料庫

如果沒有找到相關資訊，小罐頭會老實說找不到，不會硬凹。

使用小罐頭的說明：
0. 事前準備：請先依據需求選擇語言，中文或英文。
1. 你可以問我骨骼相關知識，我會用比較好懂的方式解釋給你聽。
2. 你可以點擊左下角工具箱，上傳 PDF、CSV 等文字型檔案，小罐頭可以幫你快速抓摘要與重點。
3. 你可以請小罐頭幫你出題，檢查你對骨骼知識的理解程度。
4. 小罐頭會根據你的問題提供功能按鈕，例如小測驗、查看 3D 模型、延伸學習問題、範例影像庫等。
5. 小罐頭和 Bone寶 會記得你的對話內容，方便你持續學習和複習，也可以查看對話紀錄回顧之前學過的內容。
6. 左下角工具箱也偷偷放了聊天回憶的 PDF 和 PPT 匯出功能，讓你可以保存對話紀錄，之後複習或分享。
7. 小罐頭會盡力提供正確資訊，但有時候可能找不到資料或無法回答，這時候請不要生氣，小罐頭也很無奈啊。

小罐頭想和你約兩個小約定：
1. 請勿輸入任何他人的敏感個資或真實姓名，小罐頭只想記住你的學習脈絡就好。
2. 小罐頭是用來學習和輔助說明的，醫療決策還是要和醫療專業人員討論後再做出喔。`,

    /*bonevision */
    "bonevision.dataSettings": "資料與設定",
    "bonevision.uploadXray": "上傳 X 光影像",
    "bonevision.sampleGallery": "查看範例影像庫",
    "bonevision.startDetect": "開始辨識（模型）",
    "bonevision.detecting": "辨識中...",
    "bonevision.history": "歷史紀錄",
    "bonevision.previewResult": "影像預覽與結果",
    "bonevision.noImage": "尚未上傳圖片，請先選擇一張 X 光影像。",
    "bonevision.detectedCount": "已偵測到",
    "bonevision.boneBoxes": "個骨骼框",
    "bonevision.detectedParts": "辨識出的部位",
    "bonevision.noResult": "尚未有偵測結果，請上傳圖片並點選「開始辨識（模型）」。",
    "bonevision.onlyCurrentBox": "只顯示目前框",
    "bonevision.showAllBoxes": "顯示全部框",
    "bonevision.detectedPart": "辨識部位",
    "bonevision.subLabel": "節數 / 小類",
    "bonevision.boneName": "骨頭名稱",
    "bonevision.region": "部位區域",
    "bonevision.description": "說明",
    "bonevision.queryKnowledge": "查詢知識庫",
    "bonevision.view3dModel": "查看此部位 3D 模型",
    "bonevision.chooseFile": "選擇檔案",
    "bonevision.noFileSelected": "未選擇任何檔案",

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

    /* bonevision */
    "bonevision.dataSettings": "Data & Settings",
    "bonevision.uploadXray": "Upload X-ray Image",
    "bonevision.sampleGallery": "View Sample Gallery",
    "bonevision.startDetect": "Start Detection",
    "bonevision.detecting": "Detecting...",
    "bonevision.history": "History",
    "bonevision.previewResult": "Image Preview & Results",
    "bonevision.noImage": "No image uploaded. Please choose an X-ray image first.",
    "bonevision.detectedCount": "Detected",
    "bonevision.boneBoxes": "bone boxes",
    "bonevision.detectedParts": "Detected Parts",
    "bonevision.noResult": "No detection results yet. Please upload an image and click Start Detection.",
    "bonevision.onlyCurrentBox": "Show current box only",
    "bonevision.showAllBoxes": "Show all boxes",
    "bonevision.detectedPart": "Detected Part",
    "bonevision.subLabel": "Segment / Subtype",
    "bonevision.boneName": "Bone Name",
    "bonevision.region": "Region",
    "bonevision.description": "Description",
    "bonevision.queryKnowledge": "Query Knowledge Base",
    "bonevision.view3dModel": "View 3D Model",
    "bonevision.chooseFile": "Choose File",
    "bonevision.noFileSelected": "No file selected",

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
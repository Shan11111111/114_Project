from pathlib import Path
import uuid

from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from dotenv import load_dotenv  

from .models import ChatRequest, ChatResponse, ChatMessage, Action
from .state.sessions import get_session, append_messages
from .tools.rag_tool import answer_with_rag
from .tools.yolo_tool import analyze_image
from .tools.doc_tool import extract_text_and_summary
from .routers.export import router as export_router

from .db import get_connection


BASE_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BASE_DIR.parent
load_dotenv(PROJECT_ROOT / ".env")

FRONTEND_DIR = BASE_DIR / "frontend"
UPLOAD_DIR = BASE_DIR / "data" / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Bone AI Agent")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 前端頁面
if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")

# 上傳檔案靜態服務
app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")

# 匯出 PDF/PPTX router
app.include_router(export_router)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    """
    通用上傳端點：
    - 圖片：只存檔，交由前端再呼叫 /agent/chat 觸發 YOLO
    - 文件：讀內容 + 做摘要，交由前端顯示，並再送一則「摘要訊息」給 /agent/chat
    """
    ext = (file.filename or "").split(".")[-1].lower()
    fname = f"{uuid.uuid4().hex}.{ext}"
    fpath = UPLOAD_DIR / fname

    data = await file.read()
    with open(fpath, "wb") as f:
        f.write(data)

    file_url = f"/uploads/{fname}"
    result = {
        "url": file_url,
        "filetype": ext,
        "filename": file.filename,
    }

    if ext in {"pdf", "pptx", "txt", "docx", "xlsx", "xls"}:
        text, summary = extract_text_and_summary(fpath, ext)
        result["text"] = text
        result["summary"] = summary

    return result


@app.post("/agent/chat", response_model=ChatResponse)
def agent_chat(req: ChatRequest):
    """
    - user + image → YOLO + 回傳標記圖 & 說明
    - user + text  → RAG 回答
    - assistant + text（例如檔案摘要）→ 只寫進 session，不回覆（前端已經顯示）
    """
    session = get_session(req.session_id)
    append_messages(session, req.messages)

    last = req.messages[-1]
    actions: list[Action] = []

    # 圖片 YOLO
    if last.type == "image" and last.role == "user":
        session["current_image_url"] = last.url
        if last.url:
            yolo_res = analyze_image(last.url)
            boxed_url = yolo_res["boxed_url"]
            dets = yolo_res["detections"]

            labels = ", ".join(d["bone"] for d in dets)
            explain = (
                f"偵測到的骨頭為 {labels}"
                if labels
                else "這張圖未偵測到特定骨頭。"
            )

            img_msg = ChatMessage(role="assistant", type="image", url=boxed_url)
            txt_msg = ChatMessage(role="assistant", type="text", content=explain)

            session["messages"].append(img_msg)
            session["messages"].append(txt_msg)

            bones = [d["bone"] for d in dets]
            if bones:
                actions.append(
                    Action(
                        type="highlight_bones",
                        target_model=session.get("current_model_id"),
                        bones=bones,
                        image_url=boxed_url,
                    )
                )

    # 文字（只有 user 才觸發回答）
    elif last.type == "text" and last.role == "user":
        user_q = last.content or ""
        ans_text, _ = answer_with_rag(user_q, session)
        reply = ChatMessage(role="assistant", type="text", content=ans_text)
        session["messages"].append(reply)

    # 如果 last.role 是 assistant（例如檔案摘要），這裡就不多回一句，單純把訊息留在 session

    return ChatResponse(messages=session["messages"], actions=actions)

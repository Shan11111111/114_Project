from typing import Dict, Any, List
from ..models import ChatMessage

# 最簡單的 in-memory session store
# 之後你可以換成 Redis / DB
SESSIONS: Dict[str, Dict[str, Any]] = {}


def get_session(session_id: str) -> Dict[str, Any]:
    if session_id not in SESSIONS:
        SESSIONS[session_id] = {
            "messages": [],      # List[ChatMessage]
            "files": {
                "images": [],    # 之後可放 {url, id}...
                "docs": [],
            },
            "current_image_url": None,
            "current_model_id": "default_model",
        }
    return SESSIONS[session_id]


def append_messages(session: Dict[str, Any], new_msgs: List[ChatMessage]) -> None:
    session["messages"].extend(new_msgs)

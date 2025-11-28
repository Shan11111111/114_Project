// src/api/annotation.js

// 共用主機的後端位置：
// - 開發時你可以先用 "http://127.0.0.1:8001"
// - 放到共用主機時改成 "http://<SERVER_IP>:8001"
const API_BASE = "http://127.0.0.1:8001";

function handleResponse(res) {
  if (!res.ok) {
    return res.json().then((data) => {
      const msg = data?.detail || `HTTP ${res.status}`;
      throw new Error(msg);
    });
  }
  return res.json();
}

// 列出 ImageCase
export async function fetchImageCases() {
  const res = await fetch(`${API_BASE}/annotation/images`);
  return handleResponse(res);
}

// 單一影像詳細資料
export async function fetchImageDetail(imageCaseId) {
  const res = await fetch(`${API_BASE}/annotation/image/${imageCaseId}`);
  const data = await handleResponse(res);

  // image_url 是 /static/... 時補成完整網址
  if (data.image_url && data.image_url.startsWith("/")) {
    data.image_url = `${API_BASE}${data.image_url}`;
  }
  return data;
}

// 儲存人工標註
export async function saveAnnotations(imageCaseId, boxes) {
  const res = await fetch(
    `${API_BASE}/annotation/image/${imageCaseId}/annotations`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(boxes),
    }
  );
  return handleResponse(res);
}

// 上傳圖片
export async function uploadImage(file) {
  const form = new FormData();
  form.append("file", file);
  form.append("user_id", "demo_user");
  form.append("source", "upload_web");

  const res = await fetch(`${API_BASE}/annotation/upload`, {
    method: "POST",
    body: form,
  });
  const data = await handleResponse(res);

  if (data.image_url && data.image_url.startsWith("/")) {
    data.image_url = `${API_BASE}${data.image_url}`;
  }
  return data;
}

// Bone / SmallBone 名稱
export async function fetchBoneOptions() {
  const res = await fetch(`${API_BASE}/annotation/bones`);
  return handleResponse(res);
}

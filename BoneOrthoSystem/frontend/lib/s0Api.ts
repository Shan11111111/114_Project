// frontend/lib/s0Api.ts
const API_BASE = process.env.NEXT_PUBLIC_API_BASE;

async function getJson(path: string) {
  const res = await fetch(`${API_BASE}${path}`, {
    // 如果之後有需要帶 cookie / auth 再加
  });
  if (!res.ok) {
    throw new Error(`API ${path} failed: ${res.status}`);
  }
  return res.json();
}

async function postJson(path: string, body: any) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`API ${path} failed: ${res.status}`);
  }
  return res.json();
}

export const s0Api = {
  getBigBones: () => getJson("/s0/big-bones"),
  getSmallBones: (boneId: number) =>
    getJson(`/s0/small-bones?boneId=${boneId}`),
  getAnnotations: (caseId: number) =>
    getJson(`/s0/annotations/${caseId}`),
  saveAnnotations: (payload: any) =>
    postJson("/s0/annotations/save", payload),
};

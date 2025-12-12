// frontend/lib/s0Api.ts
const API_BASE = process.env.NEXT_PUBLIC_API_BASE;

// --- 共用 fetch ---
async function getJson(path: string) {
  const res = await fetch(`${API_BASE}${path}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
  return res.json();
}

async function postJson(path: string, body: any) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
  return res.json();
}

// --- 型別 ---
export type BigBone = {
  boneId: number;
  boneZh: string;
  boneEn: string;
};

export type SmallBone = {
  smallBoneId: number;
  smallBoneZh: string;
  smallBoneEn: string;
};

export type ImageCase = {
  imageCaseId: number;
  imageUrl: string;
  thumbnailUrl: string;
  createdAt: string;
};

// --- API 介面 ---
export const s0Api = {
  async getBigBones(): Promise<BigBone[]> {
    const raw = await getJson("/s0/big-bones");
    return raw.map((b: any) => ({
      boneId: b.bone_id ?? b.boneId,
      boneZh: b.bone_zh ?? b.boneZh,
      boneEn: b.bone_en ?? b.boneEn,
    }));
  },

  async getSmallBones(boneId: number): Promise<SmallBone[]> {
    const raw = await getJson(`/s0/small-bones?boneId=${boneId}`);
    return raw.map((s: any) => ({
      smallBoneId: s.small_bone_id ?? s.smallBoneId,
      smallBoneZh: s.small_bone_zh ?? s.smallBoneZh,
      smallBoneEn: s.small_bone_en ?? s.smallBoneEn,
    }));
  },

  async getPendingCases(): Promise<ImageCase[]> {
    const raw = await getJson("/s0/cases/pending");
    return raw.map((c: any) => {
      const imageUrl = c.image_url ?? c.imageUrl;
      const thumb = c.thumbnail_url ?? c.thumbnailUrl ?? imageUrl;
      return {
        imageCaseId: c.image_case_id ?? c.imageCaseId,
        imageUrl,
        thumbnailUrl: thumb,
        createdAt: c.created_at ?? c.createdAt ?? "",
      };
    });
  },

  getAnnotations(caseId: number) {
    return getJson(`/s0/annotations/${caseId}`);
  },

  saveAnnotations(payload: any) {
    return postJson("/s0/annotations/save", payload);
  },
};

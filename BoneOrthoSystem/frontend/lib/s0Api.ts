// frontend/lib/s0Api.ts
const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://127.0.0.1:8000";

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
  serialNumber: number | null;
  place: string | null;
  note: string | null;
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
    return (raw || []).map((b: any) => ({
      boneId: b.boneId ?? b.bone_id ?? b.BoneId,
      boneZh: b.boneZh ?? b.bone_zh ?? b.BoneZh,
      boneEn: b.boneEn ?? b.bone_en ?? b.BoneEn,
    }));
  },

  async getSmallBones(boneId: number): Promise<SmallBone[]> {
    const raw = await getJson(`/s0/small-bones?boneId=${boneId}`);
    return (raw || []).map((s: any) => ({
      smallBoneId: s.smallBoneId ?? s.small_bone_id ?? s.SmallBoneId,
      smallBoneZh: s.smallBoneZh ?? s.small_bone_zh ?? s.SmallBoneZh,
      smallBoneEn: s.smallBoneEn ?? s.small_bone_en ?? s.SmallBoneEn,
      serialNumber:
        s.serialNumber ?? s.serial_number ?? s.SerialNumber ?? null,
      place: s.place ?? s.Place ?? null,
      note: s.note ?? s.Note ?? null,
    }));
  },

  // 從 /s0/cases/pending 撈「真的」 ImageCase
  async getPendingCases(): Promise<ImageCase[]> {
    const raw = await getJson("/s0/cases/pending");

    return (raw || []).map((c: any) => {
      // 後端現在會給 imageUrl / thumbnailUrl，
      // 但也把 snake_case / PascalCase 都一起兼容
      const imageUrl =
        c.imageUrl ??
        c.image_url ??
        c.thumbnailUrl ??
        c.thumbnail_url ??
        c.ImageUrl ??
        null;

      const thumbnailUrl =
        c.thumbnailUrl ??
        c.thumbnail_url ??
        c.ThumbnailUrl ??
        imageUrl ??
        "";

      return {
        imageCaseId:
          c.imageCaseId ?? c.image_case_id ?? c.ImageCaseId,
        imageUrl: imageUrl ?? "",
        thumbnailUrl,
        createdAt:
          c.createdAt ??
          c.created_at ??
          c.CreatedAt ??
          "",
      };
    });
  },

  // 這裡包 try/catch，後端炸掉就回 []，不要讓整頁爆紅
  async getAnnotations(caseId: number): Promise<any[]> {
    try {
      const data = await getJson(`/s0/annotations/${caseId}`);
      return data ?? [];
    } catch (err) {
      console.error("[S0] getAnnotations error:", err);
      return [];
    }
  },

  saveAnnotations(payload: any) {
    return postJson("/s0/annotations/save", payload);
  },
};

// ----- S2 Dr.Bone -----
export async function askAgentFromS0(payload: {
  imageCaseId: number;
  boneId: number | null;
  smallBoneId: number | null;
  question: string;
}): Promise<string> {
  const res = await fetch(`${API_BASE}/s2/from-s0/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    // 多抓一點資訊幫你 debug（像現在 404）
    let extra = "";
    try {
      extra = await res.text();
    } catch {
      // ignore
    }
    throw new Error(`S2 ask failed: ${res.status} ${extra}`);
  }

  const data = await res.json();
  return data.answer as string;
}

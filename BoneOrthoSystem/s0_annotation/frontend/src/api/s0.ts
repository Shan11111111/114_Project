// src/api/s0.ts
import axios from "axios";

const BASE = "http://localhost:8000"; // 如果之後有反向代理就改這裡

// --------- 型別定義 ---------

export interface BigBone {
  boneId: number;
  nameZh: string;
  nameEn: string;
  region?: string | null;
}

export interface SmallBone {
  smallBoneId: number;
  boneId: number;
  nameZh: string;
  nameEn: string;
  serialNumber?: string | null;
  place?: string | null;
  note?: string | null;
}

export interface BBoxPayload {
  boneId?: number | null;
  smallBoneId?: number | null;
  x_min: number;
  y_min: number;
  x_max: number;
  y_max: number;
}

export interface AnnotationResponse {
  annotationId: number;
  imageCaseId: number;
  boneId?: number | null;
  smallBoneId?: number | null;
  x_min: number;
  y_min: number;
  x_max: number;
  y_max: number;
}

// --------- API 函式 ---------

export async function fetchBigBones(): Promise<BigBone[]> {
  const res = await axios.get<BigBone[]>(`${BASE}/s0/big-bones`);
  return res.data;
}

export async function fetchSmallBones(boneId: number): Promise<SmallBone[]> {
  const res = await axios.get<SmallBone[]>(
    `${BASE}/s0/small-bones`,
    { params: { boneId } }
  );
  return res.data;
}

export async function saveAnnotations(
  imageCaseId: number,
  boxes: BBoxPayload[],
): Promise<void> {
  await axios.post(`${BASE}/s0/annotations/save`, {
    imageCaseId,
    boxes,
  });
}

export async function loadAnnotations(
  imageCaseId: number,
): Promise<AnnotationResponse[]> {
  const res = await axios.get<AnnotationResponse[]>(
    `${BASE}/s0/annotations/${imageCaseId}`,
  );
  return res.data;
}

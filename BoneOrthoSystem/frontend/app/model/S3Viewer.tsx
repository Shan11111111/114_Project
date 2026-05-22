// frontend/app/model/S3Viewer.tsx
'use client';

import { useLocale } from "../context/LocaleContext";

import Bone2DPanel from './Bone2DPanel';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// import { useSearchParams } from 'next/navigation';
import { useSearchParams, useRouter } from "next/navigation";
import { Canvas, useThree } from '@react-three/fiber';
import {
  Environment,
  OrbitControls,
  useGLTF,
  GizmoHelper,
  GizmoViewport,
} from '@react-three/drei';
import * as THREE from 'three';
// import { EffectComposer, Outline } from '@react-three/postprocessing';


import "./3d_mobile.css";

const API_BASE = '';

// 目前先停用完整 bones.glb，避免 WebGL Context Lost。
// 之後拆成部位 GLB 後，再改成依人體部位載入對應模型。
const ENABLE_BONE_GLB = false;

/** =========================
 *  Utils
 *  ========================= */

function normalizeMeshName(meshName: string) {
  let s = (meshName || '').replace(/_/g, ' ').trim();

  // Blender 匯出/複製物件常見：Trapezium.R.001、Lunate.L.002
  // 要先修成 Trapezium.R / Lunate.L，否則 2D 圖會判不到左右。
  s = s.replace(/\.(L|R)\.\d{3}$/i, '.$1');

  while (s.endsWith('.')) s = s.slice(0, -1).trim();

  s = s.replace(/\.LL$/i, '.L').replace(/\.RR$/i, '.R');

  if (
    s.length > 1 &&
    (s.endsWith('L') || s.endsWith('R')) &&
    !s.endsWith('.L') &&
    !s.endsWith('.R')
  ) {
    s = s.slice(0, -1) + '.' + s.slice(-1);
  }

  return s;
}

function v3(m: THREE.Vector3) {
  return [m.x, m.y, m.z] as [number, number, number];
}
function e3(m: THREE.Euler) {
  return [m.x, m.y, m.z] as [number, number, number];
}

type BoneTeachingInfo = {
  TeachingId?: number | null;
  BoneId?: number | null;
  SmallBoneId?: number | null;
  RegionPath?: string | null;
  ListHint?: string | null;
  IntroText?: string | null;
  StructureFunctionText?: string | null;
  LearningText?: string | null;
  SuggestedQuestions?: string | null;
  TeachingLevel?: 'basic' | 'key' | 'advanced' | string | null;
};

type BoneInfo = {
  small_bone_id: number;
  bone_id: number;
  bone_zh: string;
  bone_en: string;
  bone_region?: string | null;
  bone_desc?: string | null;
  teaching?: BoneTeachingInfo | null;
};

type BoneListItem = {
  mesh_name: string;
  small_bone_id: number;
  bone_id: number;
  bone_zh: string;
  bone_en: string;
  bone_region?: string | null;
  bone_desc?: string | null;
  teaching?: BoneTeachingInfo | null;
};

function normalizeTeachingInfo(input: any): BoneTeachingInfo | null {
  if (!input || typeof input !== 'object') return null;

  const teaching: BoneTeachingInfo = {
    TeachingId: input.TeachingId ?? input.teaching_id ?? input.teachingId ?? null,
    BoneId: input.BoneId ?? input.bone_id ?? input.boneId ?? null,
    SmallBoneId: input.SmallBoneId ?? input.small_bone_id ?? input.smallBoneId ?? null,
    RegionPath: input.RegionPath ?? input.region_path ?? input.regionPath ?? null,
    ListHint: input.ListHint ?? input.list_hint ?? input.listHint ?? null,
    IntroText: input.IntroText ?? input.intro_text ?? input.introText ?? null,
    StructureFunctionText:
      input.StructureFunctionText ??
      input.structure_function_text ??
      input.structureFunctionText ??
      null,
    LearningText: input.LearningText ?? input.learning_text ?? input.learningText ?? null,
    SuggestedQuestions:
      input.SuggestedQuestions ??
      input.suggested_questions ??
      input.suggestedQuestions ??
      null,
    TeachingLevel:
      input.TeachingLevel ??
      input.teaching_level ??
      input.teachingLevel ??
      null,
  };

  const hasAny = Object.values(teaching).some((v) => v !== null && String(v).trim() !== '');
  return hasAny ? teaching : null;
}

function parseSuggestedQuestions(raw?: string | null): string[] {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 4);
    }
  } catch {
    // fallback below
  }

  return String(raw)
    .split(/\n|[、,，;；]/g)
    .map((x) => x.replace(/^[-•\d.、\s]+/, '').trim())
    .filter(Boolean)
    .slice(0, 4);
}

function hasTeachingText(teaching?: BoneTeachingInfo | null) {
  return Boolean(
    teaching?.IntroText ||
    teaching?.StructureFunctionText ||
    teaching?.LearningText ||
    teaching?.SuggestedQuestions
  );
}

/** =========================
 *  Regions
 *  ========================= */

type RegionKey = 'skull' | 'spine' | 'thorax' | 'upper' | 'lower' | 'pelvis' | 'other';

const REGION_LABEL: Record<RegionKey, string> = {
  skull: '頭顱骨',
  spine: '脊椎',
  thorax: '胸廓（肋骨/胸骨）',
  upper: '上肢',
  lower: '下肢',
  pelvis: '骨盆',
  other: '其他',
};

function toRegionKey(region?: string | null): RegionKey {
  const r = (region ?? '').toLowerCase();

  if (
    r.includes('cranial') ||
    r.includes('facial') ||
    r.includes('skull') ||
    r.includes('頭顱')
  ) {
    return 'skull';
  }

  if (
    r.includes('spine') ||
    r.includes('vertebra') ||
    r.includes('脊椎')
  ) {
    return 'spine';
  }

  if (
    r.includes('thorax') ||
    r.includes('rib') ||
    r.includes('stern') ||
    r.includes('胸') ||
    r.includes('肋')
  ) {
    return 'thorax';
  }

  if (
    r.includes('upper') ||
    r.includes('arm') ||
    r.includes('上肢') ||
    r.includes('手')
  ) {
    return 'upper';
  }

  if (
    r.includes('lower') ||
    r.includes('leg') ||
    r.includes('下肢') ||
    r.includes('足')
  ) {
    return 'lower';
  }

  if (
    r.includes('pelvis') ||
    r.includes('hip') ||
    r.includes('骨盆')
  ) {
    return 'pelvis';
  }

  return 'other';
}

/** =========================
 *  Body-part GLB loading
 *  ========================= */
type BodyPartKey =
  | 'full_skeleton'
  | 'right_wrist'
  | 'left_wrist'
  | 'right_hand'
  | 'left_hand'
  | 'right_upper_limb'
  | 'left_upper_limb'
  | 'right_lower_limb'
  | 'left_lower_limb'
  | 'right_foot'
  | 'left_foot'
  | 'spine'
  | 'thorax'
  | 'pelvis'
  | 'skull';

const BODY_PART_MODEL_URL: Record<BodyPartKey, string> = {
  // skeleton_30_40_keep_names.glb 是中面數完整骨架，且保留 BoneDB 對應用的 mesh_name；不使用舊 bones.glb。
  full_skeleton: '/models/skeleton_30_40_v3_keep_names.glb?v=1',

  // ?v=4 用來強制瀏覽器與 useGLTF 重新抓最新 GLB，避免吃到舊快取。
  right_wrist: '/models/body-parts/right_wrist.glb?v=4',
  left_wrist: '/models/body-parts/left_wrist.glb?v=4',
  right_hand: '/models/body-parts/right_hand.glb?v=4',
  left_hand: '/models/body-parts/left_hand.glb?v=4',
  right_upper_limb: '/models/body-parts/right_upper_limb.glb?v=4',
  left_upper_limb: '/models/body-parts/left_upper_limb.glb?v=4',
  right_lower_limb: '/models/body-parts/right_lower_limb.glb?v=4',
  left_lower_limb: '/models/body-parts/left_lower_limb.glb?v=4',
  right_foot: '/models/body-parts/right_foot.glb?v=4',
  left_foot: '/models/body-parts/left_foot.glb?v=4',
  spine: '/models/body-parts/spine.glb?v=4',
  thorax: '/models/body-parts/thorax.glb?v=4',
  pelvis: '/models/body-parts/pelvis.glb?v=4',
  skull: '/models/body-parts/skull.glb?v=5',
};

const BODY_PART_LABEL: Record<BodyPartKey, { zh: string; en: string }> = {
  full_skeleton: { zh: '完整骨架', en: 'Full Skeleton' },
  right_wrist: { zh: '右手腕', en: 'Right Wrist' },
  left_wrist: { zh: '左手腕', en: 'Left Wrist' },
  right_hand: { zh: '右手', en: 'Right Hand' },
  left_hand: { zh: '左手', en: 'Left Hand' },
  right_upper_limb: { zh: '右上肢', en: 'Right Upper Limb' },
  left_upper_limb: { zh: '左上肢', en: 'Left Upper Limb' },
  right_lower_limb: { zh: '右下肢', en: 'Right Lower Limb' },
  left_lower_limb: { zh: '左下肢', en: 'Left Lower Limb' },
  right_foot: { zh: '右足部', en: 'Right Foot' },
  left_foot: { zh: '左足部', en: 'Left Foot' },
  spine: { zh: '脊椎', en: 'Spine' },
  thorax: { zh: '胸廓', en: 'Thorax' },
  pelvis: { zh: '骨盆', en: 'Pelvis' },
  skull: { zh: '頭顱', en: 'Skull' },
};

const BODY_PART_BUTTONS: BodyPartKey[] = [
  'full_skeleton',
  'right_wrist',
  'left_wrist',
  'right_hand',
  'left_hand',
  'right_upper_limb',
  'left_upper_limb',
  'spine',
  'thorax',
  'pelvis',
  'right_lower_limb',
  'left_lower_limb',
  'right_foot',
  'left_foot',
];

const BODY_PART_VIEW_SCALE: Record<BodyPartKey, number> = {
  full_skeleton: 0.85,

  right_wrist: 3.8,
  left_wrist: 3.8,

  right_hand: 2.6,
  left_hand: 2.6,

  right_foot: 2.4,
  left_foot: 2.4,

  right_upper_limb: 1.4,
  left_upper_limb: 1.4,

  right_lower_limb: 1.35,
  left_lower_limb: 1.35,

  spine: 1.45,
  thorax: 1.2,
  pelvis: 1.35,
  skull: 0.75,
};

function getBodyPartForMeshName(meshName: string, region?: string | null): BodyPartKey | null {
  const rawNorm = normalizeMeshName(meshName);
  const norm = normalizeSearchText(rawNorm);
  const side = parseSide(meshName).side;
  const r = normalizeSearchText(region);
  const sidePrefix = side === 'L' ? 'left' : side === 'R' ? 'right' : null;

  // 中軸骨：不分左右
  if (/^c[1-7]$/i.test(rawNorm) || /^t([1-9]|1[0-2])$/i.test(rawNorm) || /^l[1-5]$/i.test(rawNorm)) return 'spine';
  if (norm.includes('rib') || norm.includes('sternum')) return 'thorax';
  if (norm.includes('hipbone') || norm.includes('sacrum') || norm.includes('coccyx')) return 'pelvis';

  if (
    r.includes('skull') ||
    r.includes('cranial') ||
    r.includes('facial') ||
    r.includes('頭顱') ||
    norm.includes('skull') ||
    norm.includes('mandible') ||
    norm.includes('maxilla') ||
    norm.includes('frontal') ||
    norm.includes('parietal') ||
    norm.includes('occipital') ||
    norm.includes('temporal') ||
    norm.includes('sphenoid') ||
    norm.includes('zygomatic') ||
    norm.includes('nasal') ||
    norm.includes('palatine') ||
    norm.includes('vomer') ||
    norm.includes('hyoid') ||
    // 聽小骨 Auditory Ossicles：砧骨 Incus、錘骨 Malleus、鐙骨 Stapes
    norm.includes('incus') ||
    norm.includes('malleus') ||
    norm.includes('stapes')
  ) {
    return 'skull';
  }

  // 足部一定要先判斷。腳趾有 Second_Middle / Third_Middle，不能被 middle 誤判為手指。
  const isFoot = [
    'metatarsal',
    'hallux',
    'second',
    'third',
    'fourth',
    'fifth',
    'cuboid',
    'cuneiform',
    'navicular',
    'calcaneus',
    'talus',
  ].some((k) => norm.includes(k));
  if (isFoot && sidePrefix) return `${sidePrefix}_foot` as BodyPartKey;

  // 腕骨只載 wrist.glb，不再載整隻 hand.glb。
  const isWrist = [
    'scaphoid',
    'lunate',
    'triquetrum',
    'pisiform',
    'trapezium',
    'trapezoid',
    'capitate',
    'hamate',
  ].some((k) => norm.includes(k));
  if (isWrist && sidePrefix) return `${sidePrefix}_wrist` as BodyPartKey;

  // 掌骨與手指才載 hand.glb。
  const isHand = [
    'metacarpal',
    'thumb',
    'index',
    'middle',
    'ring',
    'little',
  ].some((k) => norm.includes(k));
  if (isHand && sidePrefix) return `${sidePrefix}_hand` as BodyPartKey;

  const isUpper = ['scapula', 'scapulae', 'clavicle', 'humeri', 'humerus', 'ulnae', 'ulna', 'radii', 'radius'].some((k) => norm.includes(k));
  if (isUpper && sidePrefix) return `${sidePrefix}_upper_limb` as BodyPartKey;

  const isLower = ['femora', 'femur', 'tibiae', 'tibia', 'fibulae', 'fibula', 'patellae', 'patella'].some((k) => norm.includes(k));
  if (isLower && sidePrefix) return `${sidePrefix}_lower_limb` as BodyPartKey;

  return null;
}

/** =========================
 *  Semantic search for S3 bone list
 *  ========================= */

function normalizeSearchText(value?: string | number | null) {
  if (value === null || value === undefined) return "";

  return String(value)
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[()（）【】\[\]{}]/g, "")
    .replace(/[，,。.!！?？、:：;；]/g, "")
    .trim();
}

const S3_SEARCH_STOP_WORDS = [
  "我要",
  "我想",
  "想看",
  "幫我",
  "請",
  "顯示",
  "查詢",
  "搜尋",
  "找",
  "相關",
  "骨頭",
  "骨骼",
  "模型",
  "3d",
  "三d",
  "的",
  "一下",
  "看看",
  "可以看",
  "給我",
];

function removeS3SearchStopWords(keyword: string) {
  let q = normalizeSearchText(keyword);

  S3_SEARCH_STOP_WORDS.forEach((word) => {
    const w = normalizeSearchText(word);
    if (w) q = q.replaceAll(w, "");
  });

  return q;
}

/**
 * 使用者口語查詢 → 可能對應的正式骨名 / 英文 / mesh 關鍵字
 */
function expandS3SemanticTerms(keyword: string): string[] {
  const rawQ = normalizeSearchText(keyword);
  const q = removeS3SearchStopWords(keyword);

  const terms = new Set<string>();

  if (rawQ) terms.add(rawQ);
  if (q) terms.add(q);

  const add = (...items: string[]) => {
    items.forEach((item) => {
      const n = normalizeSearchText(item);
      if (n) terms.add(n);
    });
  };

  const hasAny = (...items: string[]) => {
    return items.some((item) => {
      const n = normalizeSearchText(item);
      return n && (rawQ.includes(n) || q.includes(n));
    });
  };

  // 頭顱
  if (hasAny("頭", "頭部", "頭骨", "頭顱", "腦袋", "skull")) {
    add("顱骨", "skull", "cranial", "cranium");
  }

  // 聽小骨：砧骨、錘骨、鐙骨
  if (hasAny("聽小骨", "聽骨", "耳小骨", "ossicle", "ossicles", "auditoryossicles")) {
    add("聽小骨", "auditoryossicles", "ossicles", "incus", "malleus", "stapes");
  }

  if (hasAny("砧骨", "incus", "anvil")) {
    add("砧骨", "incus", "anvil", "auditoryossicles");
  }

  if (hasAny("錘骨", "槌骨", "malleus", "hammer")) {
    add("錘骨", "槌骨", "malleus", "hammer", "auditoryossicles");
  }

  if (hasAny("鐙骨", "stapes", "stirrup")) {
    add("鐙骨", "stapes", "stirrup", "auditoryossicles");
  }

  // 脊椎總類：使用者打「脊椎」時，要能找到 C/T/L 全部系列
  if (hasAny("脊椎", "脊柱", "椎骨", "spine", "vertebra", "vertebrae")) {
    add(
      "脊椎",
      "脊柱",
      "椎骨",
      "vertebra",
      "vertebrae",
      "spine",
      "cervical",
      "thoracic",
      "lumbar",
      "c1", "c2", "c3", "c4", "c5", "c6", "c7",
      "t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8", "t9", "t10", "t11", "t12",
      "l1", "l2", "l3", "l4", "l5"
    );
  }
  // 頸椎：脖子第三根、C3、頸部
  if (hasAny("脖子", "頸部", "頸椎", "neck", "cervical", "cspine")) {
    add("頸椎", "cervical", "cervicalvertebra", "c1", "c2", "c3", "c4", "c5", "c6", "c7");
  }

  // 胸椎：上背、背部上段
  if (hasAny("胸椎", "上背", "胸背", "背部上段", "thoracic", "tspine")) {
    add("胸椎", "thoracic", "thoracicvertebra", "t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8", "t9", "t10", "t11", "t12");
  }

  // 腰椎：腰、下背
  if (hasAny("腰", "腰部", "腰椎", "下背", "下背部", "lowerback", "lumbar", "lspine")) {
    add("腰椎", "lumbar", "lumbarvertebra", "l1", "l2", "l3", "l4", "l5");
  }

  // 胸廓
  if (hasAny("肋骨", "肋", "rib", "ribs")) {
    add("肋骨", "rib", "ribs");
  }

  if (hasAny("胸骨", "胸口中間", "胸前中間", "sternum", "breastbone")) {
    add("胸骨", "sternum");
  }

  if (hasAny("鎖骨", "肩膀前面", "胸前上方", "clavicle", "collarbone")) {
    add("鎖骨", "clavicle");
  }

  if (hasAny("肩胛骨", "肩胛", "肩膀後面", "背後肩膀", "scapula", "shoulderblade")) {
    add("肩胛骨", "scapula");
  }

  // 上肢
  if (hasAny("上臂", "手臂上段", "肱骨", "humerus", "upperarm")) {
    add("肱骨", "humerus");
  }

  if (hasAny("小指側", "小拇指側", "前臂內側", "尺骨", "ulna", "ulnar")) {
    add("尺骨", "ulna", "ulnar");
  }

  if (hasAny("拇指側", "大拇指側", "前臂外側", "橈骨", "radius", "radial")) {
    add("橈骨", "radius", "radial");
  }

  if (hasAny("手腕", "腕部", "腕骨", "carpal", "carpals", "wrist")) {
    add("腕骨", "carpal", "scaphoid", "lunate", "triquetrum", "pisiform", "trapezium", "trapezoid", "capitate", "hamate");
  }

  if (hasAny("手掌", "掌骨", "掌部", "metacarpal", "palm")) {
    add("掌骨", "metacarpal");
  }

  if (hasAny("手指", "指頭", "指骨", "finger", "phalanges", "phalanx")) {
    add("指骨", "phalanges", "phalanx");
  }

  // 下肢
  if (hasAny("骨盆", "髖", "屁股", "pelvis", "hip")) {
    add("骨盆", "髖骨", "pelvis", "hip");
  }

  if (hasAny("大腿", "大腿骨", "股骨", "femur", "thigh")) {
    add("股骨", "femur");
  }

  if (hasAny("膝蓋", "髕骨", "patella", "kneecap")) {
    add("髕骨", "patella");
  }

  if (hasAny("小腿前側", "小腿內側", "脛骨", "tibia", "shin")) {
    add("脛骨", "tibia");
  }

  if (hasAny("小腿外側", "腓骨", "fibula")) {
    add("腓骨", "fibula");
  }

  if (hasAny("腳踝", "踝", "距骨", "talus", "ankle")) {
    add("距骨", "talus", "ankle");
  }

  if (hasAny("腳跟", "跟骨", "heel", "calcaneus")) {
    add("跟骨", "calcaneus");
  }

  if (hasAny("腳掌", "蹠骨", "metatarsal", "foot")) {
    add("蹠骨", "metatarsal");
  }

  if (hasAny("腳趾", "趾骨", "toe", "phalanges")) {
    add("趾骨", "phalanges", "phalanx");
  }

  // 第幾根 / 第幾節口語補強
  const ordinalMatch = keyword.match(/第([一二三四五六七八九十\d]+)[根節個顆]?/);
  if (ordinalMatch) {
    const rawNo = ordinalMatch[1];

    const zhToNum: Record<string, string> = {
      一: "1",
      二: "2",
      三: "3",
      四: "4",
      五: "5",
      六: "6",
      七: "7",
      八: "8",
      九: "9",
      十: "10",
    };

    const no = zhToNum[rawNo] ?? rawNo;

    if (hasAny("脖子", "頸", "頸椎")) add(`c${no}`, `頸椎${no}`, `第${rawNo}頸椎`);
    if (hasAny("胸椎", "上背", "胸背")) add(`t${no}`, `胸椎${no}`, `第${rawNo}胸椎`);
    if (hasAny("腰", "腰椎", "下背")) add(`l${no}`, `腰椎${no}`, `第${rawNo}腰椎`);
    if (hasAny("手指", "指骨", "指頭")) add(`第${rawNo}指`, `finger${no}`, `metacarpal${no}`);
    if (hasAny("腳趾", "趾骨")) add(`第${rawNo}趾`, `toe${no}`, `metatarsal${no}`);
  }

  return Array.from(terms);
}

function scoreS3BoneByKeyword(item: BoneListItem, keyword: string) {
  const rawQ = normalizeSearchText(keyword);
  const q = removeS3SearchStopWords(keyword);
  if (!rawQ && !q) return 1;

  const terms = expandS3SemanticTerms(keyword);

  const zh = normalizeSearchText(item.bone_zh);
  const en = normalizeSearchText(item.bone_en);
  const mesh = normalizeSearchText(item.mesh_name);
  const meshPretty = normalizeSearchText(normalizeMeshName(item.mesh_name));
  const region = normalizeSearchText(item.bone_region);
  const desc = normalizeSearchText(item.bone_desc);


  const haystack = [zh, en, mesh, meshPretty, region, desc]
    .filter(Boolean)
    .join(" ");

  let score = 0;

  const navKey = getNavKeyForBoneItem(item);
  const meshPrettyRaw = normalizeMeshName(item.mesh_name);
  const series = meshToSeries(meshPrettyRaw);

  const queryHasAny = (...items: string[]) => {
    return items.some((item) => {
      const n = normalizeSearchText(item);
      return n && (rawQ.includes(n) || q.includes(n));
    });
  };

  // 使用者通常會用「部位」搜尋，不會知道精確骨名。
  // 這裡補上大類語意搜尋：頭、胸背、上肢、骨盆、下肢、脊椎。
  if (queryHasAny("頭", "頭部", "頭頸", "頭頸部", "脖子", "頸部", "head", "neck")) {
    if (navKey === "head-neck") score = Math.max(score, 55);
  }

  if (queryHasAny("胸", "胸部", "胸背", "胸背部", "背", "背部", "肋骨", "胸骨", "thorax", "back", "rib", "sternum")) {
    if (navKey === "thorax-back") score = Math.max(score, 55);
  }

  if (queryHasAny("上肢", "手", "手臂", "肩膀", "肩", "手腕", "手掌", "手指", "upperlimb", "arm", "hand", "wrist", "shoulder")) {
    if (navKey === "upper-limb") score = Math.max(score, 55);
  }

  if (queryHasAny("骨盆", "髖", "屁股", "pelvis", "hip")) {
    if (navKey === "pelvis") score = Math.max(score, 55);
  }

  if (queryHasAny("下肢", "腳", "腿", "大腿", "小腿", "膝蓋", "腳踝", "腳掌", "腳趾", "lowerlimb", "leg", "foot", "ankle", "knee")) {
    if (navKey === "lower-limb") score = Math.max(score, 55);
  }

  // 「脊椎」是特殊情況：頸椎在頭頸部，胸椎/腰椎在胸背部，
  // 所以不能只靠 navKey，要直接看 mesh 是否是 C/T/L 系列。
  if (queryHasAny("脊椎", "脊柱", "椎骨", "spine", "vertebra", "vertebrae")) {
    if (series) score = Math.max(score, 80);
  }

  // 1. 中文骨名完全命中，最高
  if (zh && (rawQ === zh || q === zh)) {
    score = Math.max(score, 140);
  }

  // 2. 英文骨名完全命中
  if (en && (rawQ === en || q === en)) {
    score = Math.max(score, 130);
  }

  // 3. Mesh 名稱完全命中，例如 C3、L5、Talus
  if (meshPretty && (rawQ === meshPretty || q === meshPretty)) {
    score = Math.max(score, 125);
  }

  // 4. 語意展開詞命中
  for (const term of terms) {
    const t = normalizeSearchText(term);
    if (!t) continue;

    if (zh === t || en === t || mesh === t || meshPretty === t) {
      score = Math.max(score, 120);
    } else if (zh.includes(t) || en.includes(t) || mesh.includes(t) || meshPretty.includes(t)) {
      score = Math.max(score, 90);
    } else if (haystack.includes(t)) {
      score = Math.max(score, 60);
    }
  }

  // 5. 原始 query 直接命中
  if (q.length >= 2 && haystack.includes(q)) {
    score = Math.max(score, 70);
  }

  // 6. 部位 / 描述命中，給低分，避免太廣
  if (q.length >= 2 && ((region && region.includes(q)) || (desc && desc.includes(q)))) {
    score = Math.max(score, 35);
  }

  // 7. 特別處理：第幾根 / 第幾節
  const ordinalMatch = keyword.match(/第([一二三四五六七八九十\d]+)[根節個顆]?/);
  if (ordinalMatch) {
    const rawNo = ordinalMatch[1];

    const zhToNum: Record<string, string> = {
      一: "1",
      二: "2",
      三: "3",
      四: "4",
      五: "5",
      六: "6",
      七: "7",
      八: "8",
      九: "9",
      十: "10",
    };

    const no = zhToNum[rawNo] ?? rawNo;

    if ((rawQ.includes("脖子") || rawQ.includes("頸")) && meshPretty === `c${no}`) {
      score = Math.max(score, 160);
    }

    if ((rawQ.includes("胸椎") || rawQ.includes("上背") || rawQ.includes("胸背")) && meshPretty === `t${no}`) {
      score = Math.max(score, 160);
    }

    if ((rawQ.includes("腰") || rawQ.includes("下背")) && meshPretty === `l${no}`) {
      score = Math.max(score, 160);
    }
  }

  return score;
}
/** =========================
 *  Side parsing
 *  ========================= */

type SideKey = 'L' | 'R' | 'C';

function parseSide(meshName: string): { base: string; side: SideKey } {
  const norm = normalizeMeshName(meshName);

  if (norm.endsWith('.L')) return { base: norm.slice(0, -2), side: 'L' };
  if (norm.endsWith('.R')) return { base: norm.slice(0, -2), side: 'R' };

  const lower = norm.toLowerCase();
  if (lower.endsWith(' left')) return { base: norm.slice(0, -5), side: 'L' };
  if (lower.endsWith(' right')) return { base: norm.slice(0, -6), side: 'R' };

  return { base: norm, side: 'C' };
}

/** =========================
 *  Pretty labels
 *  ========================= */

const HAND_DIGIT_ZH: Record<string, string> = {
  Thumb: '拇指',
  Index: '食指',
  Middle: '中指',
  Ring: '無名指',
  Little: '小指',
};

const FOOT_DIGIT_ZH: Record<string, string> = {
  Hallux: '拇趾',
  Second: '第二趾',
  Third: '第三趾',
  Fourth: '第四趾',
  Fifth: '第五趾',
  fifth: '第五趾',
};

const SEG_ZH: Record<string, string> = {
  Proximal: '近節',
  Middle: '中節',
  Distal: '遠節',
};

function romanToInt(roman: string): number | null {
  const r = roman.toUpperCase();
  if (r === 'I') return 1;
  if (r === 'II') return 2;
  if (r === 'III') return 3;
  if (r === 'IV') return 4;
  if (r === 'V') return 5;
  return null;
}

function cleanBaseKey(base: string) {
  return (base || '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function lowerKey(s: string) {
  return cleanBaseKey(s).toLowerCase();
}

const BASE_NAME_MAP_LOWER: Record<string, { zh: string; en: string }> = {
  // ---- Tarsals 跗骨 ----
  [lowerKey('Talus')]: { zh: '距骨', en: 'Talus' },
  [lowerKey('Calcaneus')]: { zh: '跟骨', en: 'Calcaneus' },
  [lowerKey('Navicular')]: { zh: '舟狀骨', en: 'Navicular' },
  [lowerKey('Cuboid')]: { zh: '立方骨', en: 'Cuboid' },

  // 楔狀骨（多種寫法）
  [lowerKey('Medial cuneiform')]: { zh: '內側楔狀骨', en: 'Medial cuneiform' },
  [lowerKey('Intermediate cuneiform')]: { zh: '中間楔狀骨', en: 'Intermediate cuneiform' },
  [lowerKey('Lateral cuneiform')]: { zh: '外側楔狀骨', en: 'Lateral cuneiform' },

  [lowerKey('Cuneiform Medial')]: { zh: '內側楔狀骨', en: 'Medial cuneiform' },
  [lowerKey('Cuneiform Intermediate')]: { zh: '中間楔狀骨', en: 'Intermediate cuneiform' },
  [lowerKey('Cuneiform Lateral')]: { zh: '外側楔狀骨', en: 'Lateral cuneiform' },

  [lowerKey('CuneiformMedial')]: { zh: '內側楔狀骨', en: 'Medial cuneiform' },
  [lowerKey('CuneiformIntermediate')]: { zh: '中間楔狀骨', en: 'Intermediate cuneiform' },
  [lowerKey('CuneiformLateral')]: { zh: '外側楔狀骨', en: 'Lateral cuneiform' },

  [lowerKey('Cuneiform 1')]: { zh: '內側楔狀骨', en: 'Medial cuneiform' },
  [lowerKey('Cuneiform 2')]: { zh: '中間楔狀骨', en: 'Intermediate cuneiform' },
  [lowerKey('Cuneiform 3')]: { zh: '外側楔狀骨', en: 'Lateral cuneiform' },
  [lowerKey('Cuneiform1')]: { zh: '內側楔狀骨', en: 'Medial cuneiform' },
  [lowerKey('Cuneiform2')]: { zh: '中間楔狀骨', en: 'Intermediate cuneiform' },
  [lowerKey('Cuneiform3')]: { zh: '外側楔狀骨', en: 'Lateral cuneiform' },

  // ---- Carpals 腕骨 ----
  [lowerKey('Scaphoid')]: { zh: '舟狀骨', en: 'Scaphoid' },
  [lowerKey('Lunate')]: { zh: '月狀骨', en: 'Lunate' },
  [lowerKey('Triquetrum')]: { zh: '三角骨', en: 'Triquetrum' },
  [lowerKey('Pisiform')]: { zh: '豆狀骨', en: 'Pisiform' },
  [lowerKey('Trapezium')]: { zh: '大多角骨', en: 'Trapezium' },
  [lowerKey('Trapezoid')]: { zh: '小多角骨', en: 'Trapezoid' },
  [lowerKey('Capitate')]: { zh: '頭狀骨', en: 'Capitate' },
  [lowerKey('Hamate')]: { zh: '鉤狀骨', en: 'Hamate' },

  // ---- Auditory ossicles 聽小骨 ----
  [lowerKey('Incus')]: { zh: '砧骨', en: 'Incus' },
  [lowerKey('Malleus')]: { zh: '錘骨', en: 'Malleus' },
  [lowerKey('Stapes')]: { zh: '鐙骨', en: 'Stapes' },
};

function lookupBaseName(baseRaw: string): { zh: string; en: string } | null {
  const base = cleanBaseKey(baseRaw);
  const k0 = lowerKey(base);
  if (BASE_NAME_MAP_LOWER[k0]) return BASE_NAME_MAP_LOWER[k0];

  {
    const m = base.match(/^(Medial|Intermediate|Lateral)\s+Cuneiform$/i);
    if (m) {
      const kk = lowerKey(`${m[1]} cuneiform`);
      if (BASE_NAME_MAP_LOWER[kk]) return BASE_NAME_MAP_LOWER[kk];
    }
  }
  {
    const m = base.match(/^Cuneiform\s+(Medial|Intermediate|Lateral)$/i);
    if (m) {
      const kk = lowerKey(`cuneiform ${m[1]}`);
      if (BASE_NAME_MAP_LOWER[kk]) return BASE_NAME_MAP_LOWER[kk];
    }
  }
  {
    const compact = base.replace(/\s+/g, '');
    const kk = lowerKey(compact);
    if (BASE_NAME_MAP_LOWER[kk]) return BASE_NAME_MAP_LOWER[kk];
  }
  {
    const m = base.replace(/\s+/g, '').match(/^(medial|intermediate|lateral)cuneiform$/i);
    if (m) {
      const kk = lowerKey(`${m[1]} cuneiform`);
      if (BASE_NAME_MAP_LOWER[kk]) return BASE_NAME_MAP_LOWER[kk];
    }
  }
  return null;
}

function toZhNumber(n: number): string {
  const zh = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

  if (n <= 10) return zh[n];
  if (n < 20) return `十${zh[n - 10]}`;
  return String(n);
}

function vertebraZh(prefix: '頸椎' | '胸椎' | '腰椎', code: string): string {
  const m = code.match(/^[CTL](\d{1,2})$/i);
  if (!m) return `${prefix} ${code}`;
  return `第${toZhNumber(Number(m[1]))}${prefix}（${code.toUpperCase()}）`;
}


function prettyForBase(base: string, fallbackZh: string, fallbackEn: string): { zh: string; en: string; tag?: string } {
  const mapped = lookupBaseName(base);
  if (mapped) return { zh: mapped.zh, en: mapped.en };

  const key = cleanBaseKey(base);

  {
    const m = key.match(/^(Thumb|Index|Middle|Ring|Little)[ _](Proximal|Middle|Distal)$/);
    if (m) {
      const digit = m[1];
      const seg = m[2];
      const digitZh = HAND_DIGIT_ZH[digit] ?? digit;
      const segZh = SEG_ZH[seg] ?? seg;
      return { zh: `${digitZh}${segZh}指骨`, en: `${digit} ${seg} phalanx`, tag: `${digitZh} · ${segZh}` };
    }
  }

  {
    const m = key.match(/^(Hallux|Second|Third|Fourth|Fifth|fifth)[ _](Proximal|Middle|Distal)$/);
    if (m) {
      const digit = m[1];
      const seg = m[2];
      const digitZh = FOOT_DIGIT_ZH[digit] ?? digit;
      const segZh = SEG_ZH[seg] ?? seg;
      return { zh: `${digitZh}${segZh}趾骨`, en: `${digit} ${seg} phalanx`, tag: `${digitZh} · ${segZh}` };
    }
  }

  {
    const m = key.match(/^Metacarpal\s?(I{1,3}|IV|V)$/i);
    if (m) {
      const n = romanToInt(m[1]);
      if (n) return { zh: `第${toZhNumber(n)}掌骨`, en: `Metacarpal ${n}` };
    }
  }

  {
    const m = key.match(/^Metatarsal\s?(I{1,3}|IV|V)$/i);
    if (m) {
      const n = romanToInt(m[1]);
      if (n) return { zh: `第${toZhNumber(n)}蹠骨`, en: `Metatarsal ${n}` };
    }
  }

  {
    const m = key.match(/^Rib(\d{1,2})$/i);
    if (m) {
      const n = Number(m[1]);
      if (!Number.isNaN(n)) return { zh: `第${toZhNumber(n)}肋骨`, en: `Rib ${n}` };
    }
  }

  if (/^C\d{1,2}$/i.test(key)) {
    const code = key.toUpperCase();
    return { zh: vertebraZh('頸椎', code), en: `Cervical vertebra ${code}` };
  }

  if (/^T\d{1,2}$/i.test(key)) {
    const code = key.toUpperCase();
    return { zh: vertebraZh('胸椎', code), en: `Thoracic vertebra ${code}` };
  }

  if (/^L\d{1,2}$/i.test(key)) {
    const code = key.toUpperCase();
    return { zh: vertebraZh('腰椎', code), en: `Lumbar vertebra ${code}` };
  }

  return { zh: fallbackZh || key, en: fallbackEn || key };
}

function getTeachingLevelMeta(level?: string | null, isEn?: boolean) {
  if (level === 'advanced') {
    return {
      label: isEn ? 'Depth View' : '進階觀察',
      desc: isEn
        ? 'These bones are deeper in position, more structurally complex, or easier to confuse with nearby bones. Suitable for advanced observation and comparison.'
        : '這類骨頭位置較深、形狀較特殊，或容易和附近骨頭混淆，適合進一步比較與觀察。',
      bg: 'rgba(168,85,247,0.14)',
      color: '#7e22ce',
      border: 'rgba(168,85,247,0.22)',
    };
  }

  if (level === 'key') {
    return {
      label: isEn ? 'Vital Bone' : '重點骨頭',
      desc: isEn
        ? 'These bones are important for support, movement, recognition, and clinical learning, providing more complete structural and functional explanations.'
        : '這類骨頭和支撐、活動、常見辨認或臨床學習較有關，提供較完整的結構、功能與定位說明。',
      bg: 'rgba(59,130,246,0.14)',
      color: '#1d4ed8',
      border: 'rgba(59,130,246,0.22)',
    };
  }

  return {
    label: isEn ? 'Basic Knowledge' : '基礎認識',
    desc: isEn
      ? 'Provides a basic introduction to this bone, suitable for building foundational understanding.'
      : '提供這塊骨頭的基本介紹，適合先建立整體概念。',
    bg: 'rgba(100,116,139,0.12)',
    color: '#475569',
    border: 'rgba(100,116,139,0.2)',
  };
}

/** =========================
 *  Outline fallback: EdgesGeometry
 *  ========================= */
function SelectedEdges({
  geometry,
  position,
  rotation,
  scale,
}: {
  geometry: THREE.BufferGeometry;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}) {
  const edges = useMemo(() => new THREE.EdgesGeometry(geometry, 12), [geometry]);
  useEffect(() => () => edges.dispose(), [edges]);

  return (
    <lineSegments
      geometry={edges}
      position={position}
      rotation={rotation}
      scale={[scale[0] * 1.002, scale[1] * 1.002, scale[2] * 1.002]}
      renderOrder={999}
    >
      <lineBasicMaterial color={0x38bdf8} linewidth={2} />
    </lineSegments>);
}

/** =========================
 *  3D Model
 *  ========================= */

type BoneModelProps = {
  url: string;
  selectedNormSet: Set<string>;
  visibleNormSet?: Set<string> | null; // ✅ 新增：null = 全顯示
  onSelectMesh?: (meshName: string) => void;
  onRegistryReady?: (registry: Record<string, THREE.Mesh>) => void;
};

function BoneModel({ url, selectedNormSet, visibleNormSet, onSelectMesh, onRegistryReady }: BoneModelProps) {
  const { scene } = useGLTF(url) as any;
  const [hovered, setHovered] = useState<string | null>(null);
  const [targetMeshNames, setTargetMeshNames] = useState<string[]>([]);

  const registryRef = useRef<Record<string, THREE.Mesh>>({});

  const meshes = useMemo(() => {
    const list: THREE.Mesh[] = [];
    scene.traverse((obj: any) => {
      if (obj?.isMesh) list.push(obj);
    });
    return list;
  }, [scene]);

  useEffect(() => {
    onRegistryReady?.(registryRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meshes]);

  useEffect(() => {
    return () => {
      document.body.style.cursor = 'auto';
    };
  }, []);

  return (
    <group>
      {meshes.map((mesh) => {
        const rawName = mesh.name || 'noname';
        const normName = normalizeMeshName(rawName);

        const isHovered = hovered === rawName;
        const isSelected = selectedNormSet.has(normName);
        const isVisible = !visibleNormSet || visibleNormSet.has(normName); // ✅ 新增

        const pos = v3(mesh.position);
        const rot = e3(mesh.rotation);
        const scl = v3(mesh.scale);

        return (
          <group key={rawName}>
            <mesh
              visible={isVisible} // ✅ 新增
              geometry={mesh.geometry}
              position={pos}
              rotation={rot}
              scale={scl}
              ref={(el) => {
                if (el) registryRef.current[normName] = el;
              }}
              onPointerOver={() => {
                setHovered(rawName);
                document.body.style.cursor = 'pointer';
              }}
              onPointerOut={() => {
                setHovered(null);
                document.body.style.cursor = 'auto';
              }}
              onClick={(e) => {
                e.stopPropagation();
                onSelectMesh?.(rawName);
              }}
            >
              <meshStandardMaterial
                attach="material"
                color={isSelected ? "#f8fafc" : "#cbd5e1"}
                roughness={0.7}
                metalness={0.02}
                side={THREE.DoubleSide}
                polygonOffset
                polygonOffsetFactor={1}
                polygonOffsetUnits={1}
                emissive={
                  isSelected
                    ? new THREE.Color(0.1, 0.25, 0.4)
                    : isHovered
                      ? new THREE.Color(0.15, 0.2, 0.25)
                      : new THREE.Color(0, 0, 0)
                }
              />                                  </mesh>

            {isSelected && isVisible ? (
              <SelectedEdges geometry={mesh.geometry} position={pos} rotation={rot} scale={scl} />
            ) : null}
          </group>
        );
      })}
    </group>
  );
}

/** =========================
 *  Controls
 *  ========================= */
function Controls({
  controlsRef,
  cameraRef,
}: {
  controlsRef: React.MutableRefObject<any>;
  cameraRef: React.MutableRefObject<THREE.Camera | null>;
}) {
  const { camera, gl } = useThree();

  useEffect(() => {
    cameraRef.current = camera;
    gl.domElement.style.touchAction = 'none';
  }, [camera, gl, cameraRef]);

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      rotateSpeed={0.85}
      zoomSpeed={1.0}
      panSpeed={0.8}
      enableRotate
      enableZoom
      enablePan
      screenSpacePanning={true}
      mouseButtons={{
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN,
      }}
    />
  );
}

/** =========================
 *  Spine series
 *  ========================= */

type SeriesKind = 'cervical' | 'thoracic' | 'lumbar';

function seriesMeta(series: SeriesKind) {
  if (series === 'cervical')
    return { zh: '頸椎', en: 'Cervical vertebrae', order: ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'] };
  if (series === 'thoracic')
    return {
      zh: '胸椎',
      en: 'Thoracic vertebrae',
      order: ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12'],
    };
  return { zh: '腰椎', en: 'Lumbar vertebrae', order: ['L1', 'L2', 'L3', 'L4', 'L5'] };
}

function meshToSeries(norm: string): SeriesKind | null {
  if (/^C[1-7]$/.test(norm)) return 'cervical';
  if (/^T([1-9]|1[0-2])$/.test(norm)) return 'thoracic';
  if (/^L[1-5]$/.test(norm)) return 'lumbar';
  return null;
}

function getBoneItemSortValue(item?: BoneListItem | null): number {
  if (!item) return 999999;

  const norm = normalizeMeshName(item.mesh_name);

  const c = norm.match(/^C([1-7])$/);
  if (c) return 1900 + Number(c[1]);

  const t = norm.match(/^T([1-9]|1[0-2])$/);
  if (t) return 2000 + Number(t[1]);

  const l = norm.match(/^L([1-5])$/);
  if (l) return 2100 + Number(l[1]);

  const rib = norm.match(/^Rib(\d{1,2})$/i);
  if (rib) return 2500 + Number(rib[1]);

  return Number(item.small_bone_id ?? 999999);
}

function getCardSortValue(card: Card): number {
  if (card.kind === 'series') {
    if (card.series === 'cervical') return 1900;
    if (card.series === 'thoracic') return 2000;
    if (card.series === 'lumbar') return 2100;
    return 999999;
  }

  return Math.min(
    getBoneItemSortValue(card.C),
    getBoneItemSortValue(card.L),
    getBoneItemSortValue(card.R)
  );
}

/** =========================
 *  Cards
 *  ========================= */

type LRCard = {
  kind: 'lr';
  regionKey: RegionKey;
  base: string;
  displayZh: string;
  displayEn: string;
  tag?: string;
  L?: BoneListItem;
  R?: BoneListItem;
  C?: BoneListItem;
};

type SeriesCard = {
  kind: 'series';
  regionKey: 'spine';
  series: SeriesKind;
  displayZh: string;
  displayEn: string;
  order: string[];
  items: Record<string, BoneListItem>;
};

type Card = LRCard | SeriesCard;

function buildCardsForRegion(
  items: BoneListItem[],
  regionKey: RegionKey,
  scoreByMesh?: Map<string, number>
): Card[] {

  let rest = items;
  const seriesCards: SeriesCard[] = [];

  if (regionKey === 'spine') {
    const buckets: Record<SeriesKind, Record<string, BoneListItem>> = {
      cervical: {},
      thoracic: {},
      lumbar: {},
    };

    for (const it of items) {
      const norm = normalizeMeshName(it.mesh_name);
      const s = meshToSeries(norm);
      if (s) buckets[s][norm] = it;
    }

    rest = items.filter((it) => !meshToSeries(normalizeMeshName(it.mesh_name)));

    (['cervical', 'thoracic', 'lumbar'] as SeriesKind[]).forEach((sk) => {
      const meta = seriesMeta(sk);
      const dict = buckets[sk];
      const order = meta.order.filter((k) => !!dict[k]);
      if (!order.length) return;

      const itemsMap: Record<string, BoneListItem> = {};
      order.forEach((k) => (itemsMap[k] = dict[k]));

      seriesCards.push({
        kind: 'series',
        regionKey: 'spine',
        series: sk,
        displayZh: meta.zh,
        displayEn: meta.en,
        order,
        items: itemsMap,
      });
    });
  }

  const m = new Map<string, LRCard>();

  for (const it of rest) {
    const { base, side } = parseSide(it.mesh_name);

    if (!m.has(base)) {
      const pretty = prettyForBase(base, it.bone_zh, it.bone_en);
      m.set(base, {
        kind: 'lr',
        regionKey,
        base,
        displayZh: pretty.zh,
        displayEn: pretty.en,
        tag: pretty.tag,
      });
    }

    const g = m.get(base)!;
    if (side === 'L') g.L = it;
    else if (side === 'R') g.R = it;
    else g.C = it;
  }

  const cards = [...seriesCards, ...Array.from(m.values())];

  const getCardScore = (card: Card) => {
    if (!scoreByMesh) return 0;

    if (card.kind === "series") {
      return Math.max(
        ...Object.values(card.items).map(
          (item) => scoreByMesh.get(normalizeMeshName(item.mesh_name)) ?? 0
        ),
        0
      );
    }

    return Math.max(
      card.L ? scoreByMesh.get(normalizeMeshName(card.L.mesh_name)) ?? 0 : 0,
      card.R ? scoreByMesh.get(normalizeMeshName(card.R.mesh_name)) ?? 0 : 0,
      card.C ? scoreByMesh.get(normalizeMeshName(card.C.mesh_name)) ?? 0 : 0
    );
  };

  return cards.sort((a, b) => {
    const scoreDiff = getCardScore(b) - getCardScore(a);
    if (scoreDiff !== 0) return scoreDiff;

    return getCardSortValue(a) - getCardSortValue(b);
  });
}

/** =========================
 *  Selection Mode
 *  ========================= */

type SelectedMode =
  | { kind: 'none' }
  | { kind: 'mesh'; meshName: string }
  | { kind: 'series'; series: SeriesKind };

type PanelMode = 'bone';

type NavGroupKey =
  | 'head-neck'
  | 'thorax-back'
  | 'upper-limb'
  | 'pelvis'
  | 'lower-limb'
  | 'other';

type NavGroup = {
  key: NavGroupKey;
  labelZh: string;
  labelEn: string;
};

const NAV_GROUPS: NavGroup[] = [
  { key: 'head-neck', labelZh: '頭頸部', labelEn: 'Head & Neck' },
  { key: 'thorax-back', labelZh: '胸背部', labelEn: 'Thorax & Back' },
  { key: 'upper-limb', labelZh: '上肢', labelEn: 'Upper Limb' },
  { key: 'pelvis', labelZh: '骨盆', labelEn: 'Pelvis' },
  { key: 'lower-limb', labelZh: '下肢', labelEn: 'Lower Limb' },
  { key: 'other', labelZh: '其他', labelEn: 'Other' },
];

function isNavGroupKey(value: unknown): value is NavGroupKey {
  return (
    value === 'head-neck' ||
    value === 'thorax-back' ||
    value === 'upper-limb' ||
    value === 'pelvis' ||
    value === 'lower-limb' ||
    value === 'other'
  );
}

function getNavKeyForBoneItem(item: BoneListItem): NavGroupKey {
  const boneId = Number(item.bone_id);

  if (boneId >= 1 && boneId <= 19) return 'head-neck';
  if (boneId === 20 || boneId === 21 || boneId === 24 || boneId === 25) return 'thorax-back';
  if (boneId === 22 || boneId === 23 || boneId === 34) return 'pelvis';
  if (boneId >= 26 && boneId <= 33) return 'upper-limb';
  if (boneId >= 35 && boneId <= 41) return 'lower-limb';

  const rk = toRegionKey(item.bone_region);

  if (rk === 'skull') return 'head-neck';
  if (rk === 'upper') return 'upper-limb';
  if (rk === 'lower') return 'lower-limb';
  if (rk === 'pelvis') return 'pelvis';
  if (rk === 'thorax') return 'thorax-back';

  if (rk === 'spine') {
    const norm = normalizeMeshName(item.mesh_name);
    const series = meshToSeries(norm);
    if (series === 'cervical') return 'head-neck';
    return 'thorax-back';
  }

  return 'other';
}

function getNavKeyForCard(card: Card): NavGroupKey {
  if (card.kind === 'series') {
    if (card.series === 'cervical') return 'head-neck';
    return 'thorax-back';
  }

  const item = card.C || card.L || card.R;
  if (!item) return 'other';

  return getNavKeyForBoneItem(item);
}

type BroadS3SearchKind =
  | 'spine-all'
  | 'head-neck'
  | 'thorax-back'
  | 'upper-limb'
  | 'pelvis'
  | 'lower-limb';

function getBroadS3SearchKind(keyword: string): BroadS3SearchKind | null {
  const q = removeS3SearchStopWords(keyword);

  const hasAny = (...items: string[]) =>
    items.some((item) => {
      const n = normalizeSearchText(item);
      return n && q.includes(n);
    });

  // 注意順序：脊椎要先判斷，不然「頸椎」可能被頭頸吃掉
  if (hasAny('脊椎', '脊柱', '椎骨', 'spine', 'vertebra', 'vertebrae')) {
    return 'spine-all';
  }

  if (hasAny('頭頸部', '頭頸', '頭部', '頭', '脖子', '頸部', 'head', 'neck')) {
    return 'head-neck';
  }

  if (hasAny('胸背部', '胸背', '胸部', '胸', '背部', '背', '肋骨', '胸骨', 'thorax', 'back', 'rib', 'sternum')) {
    return 'thorax-back';
  }

  if (hasAny('上肢', '手臂', '手腕', '手掌', '手指', '肩膀', '肩', '手', 'upperlimb', 'arm', 'hand', 'wrist', 'shoulder')) {
    return 'upper-limb';
  }

  if (hasAny('骨盆', '髖', '屁股', 'pelvis', 'hip')) {
    return 'pelvis';
  }

  if (hasAny('下肢', '大腿', '小腿', '膝蓋', '腳踝', '腳掌', '腳趾', '腳', '腿', 'lowerlimb', 'leg', 'foot', 'ankle', 'knee')) {
    return 'lower-limb';
  }

  return null;
}

function matchBroadS3Search(item: BoneListItem, kind: BroadS3SearchKind) {
  const norm = normalizeMeshName(item.mesh_name);
  const series = meshToSeries(norm);

  if (kind === 'spine-all') {
    return Boolean(series);
  }

  return getNavKeyForBoneItem(item) === kind;
}


/** =========================
 *  Flatten bone-list response
 * ========================= */
function flattenBoneListPayload(payload: any): BoneListItem[] {
  const root = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
  const out: BoneListItem[] = [];

  for (const g of root) {
    if (g?.mesh_name && g?.small_bone_id != null) {
      out.push({
        mesh_name: String(g.mesh_name),
        small_bone_id: Number(g.small_bone_id),
        bone_id: Number(g.bone_id ?? 0),
        bone_zh: String(g.bone_zh ?? ''),
        bone_en: String(g.bone_en ?? ''),
        bone_region: g.bone_region ?? null,
        bone_desc: g.bone_desc ?? null,
        teaching: normalizeTeachingInfo(g.teaching),
      });
      continue;
    }

    const parent = {
      bone_id: Number(g?.bone_id ?? 0),
      bone_zh: String(g?.bone_zh ?? g?.key ?? ''),
      bone_en: String(g?.bone_en ?? ''),
      bone_region: g?.bone_region ?? null,
      bone_desc: g?.bone_desc ?? null,
    };

    const pushSide = (s: any) => {
      if (!s?.mesh_name) return;
      const sid = s?.small_bone_id ?? s?.small_boneId ?? s?.small_boneID ?? s?.smallBoneId ?? s?.small_bone_id;
      if (sid == null) return;

      out.push({
        mesh_name: String(s.mesh_name),
        small_bone_id: Number(sid),
        bone_id: parent.bone_id,
        bone_zh: parent.bone_zh,
        bone_en: parent.bone_en,
        bone_region: parent.bone_region,
        bone_desc: parent.bone_desc,
        teaching: normalizeTeachingInfo(s.teaching ?? g?.teaching),
      });
    };

    pushSide(g?.left);
    pushSide(g?.right);
    pushSide(g?.center);

    if (Array.isArray(g?.items)) {
      for (const s of g.items) pushSide(s);
    }
  }

  const seen = new Set<string>();
  return out.filter((x) => {
    const k = normalizeMeshName(x.mesh_name);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}


const S3_VIEWER_STATE_KEY = 'galabone_s3_viewer_state_v2';

type StoredS3ViewerState = {
  selectedBodyPart?: BodyPartKey | null;
  selectedMode?: SelectedMode;
  panelMode?: PanelMode;
  q?: string;
  openGroups?: NavGroupKey[];
  sidebarOpen?: boolean;
};

function isBodyPartKey(value: unknown): value is BodyPartKey {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(BODY_PART_MODEL_URL, value);
}

function isPanelMode(value: unknown): value is PanelMode {
  return value === 'bone';
}

function isRegionKey(value: unknown): value is RegionKey {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(REGION_LABEL, value);
}

function isStoredSelectedMode(value: unknown): value is SelectedMode {
  if (!value || typeof value !== 'object') return false;
  const v = value as any;

  if (v.kind === 'none') return true;
  if (v.kind === 'mesh') return typeof v.meshName === 'string' && v.meshName.length > 0;
  if (v.kind === 'series') return v.series === 'cervical' || v.series === 'thoracic' || v.series === 'lumbar';

  return false;
}

function readStoredS3ViewerState(): StoredS3ViewerState {
  if (typeof window === 'undefined') return {};

  try {
    const raw = window.sessionStorage.getItem(S3_VIEWER_STATE_KEY);
    if (!raw) return {};

    const parsed = JSON.parse(raw) as StoredS3ViewerState;
    const out: StoredS3ViewerState = {};

    if (parsed.selectedBodyPart === null || isBodyPartKey(parsed.selectedBodyPart)) {
      out.selectedBodyPart = parsed.selectedBodyPart;
    }

    if (isStoredSelectedMode(parsed.selectedMode)) {
      out.selectedMode = parsed.selectedMode;
    }

    if (isPanelMode(parsed.panelMode)) {
      out.panelMode = parsed.panelMode;
    }

    if (typeof parsed.q === 'string') {
      out.q = parsed.q;
    }

    if (Array.isArray(parsed.openGroups)) {
      out.openGroups = parsed.openGroups.filter(isNavGroupKey);
    }

    if (typeof parsed.sidebarOpen === 'boolean') {
      out.sidebarOpen = parsed.sidebarOpen;
    }

    return out;
  } catch {
    return {};
  }
}

export default function S3Viewer() {
  const { locale } = useLocale();
  const isEn = locale === "en-US";
  const router = useRouter();
  const [isNavigating, setIsNavigating] = useState(false);
  const [navigatingText, setNavigatingText] = useState("");

  const searchParams = useSearchParams();
  const targetBone = searchParams.get("bone") || "";
  const targetMesh = searchParams.get("mesh") || "";
  const targetBoneId = searchParams.get("boneId");

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.sessionStorage.removeItem(S3_VIEWER_STATE_KEY);
  }, []);

  const [selectedMode, setSelectedMode] = useState<SelectedMode>({ kind: 'none' });
  const [selectedBodyPart, setSelectedBodyPart] = useState<BodyPartKey | null>('full_skeleton');
  const currentBodyPartScale = selectedBodyPart ? BODY_PART_VIEW_SCALE[selectedBodyPart] : 1.2;

  const selectedMeshName = selectedMode.kind === 'mesh' ? selectedMode.meshName : null;
  const selectedSeries = selectedMode.kind === 'series' ? selectedMode.series : null;

  const [boneInfo, setBoneInfo] = useState<BoneInfo | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [teachingLevelHelpOpen, setTeachingLevelHelpOpen] = useState(false);
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);

  const [boneList, setBoneList] = useState<BoneListItem[]>([]);
  const [q, setQ] = useState('');
  const [panelMode] = useState<PanelMode>('bone');

  const [openGroups, setOpenGroups] = useState<NavGroupKey[]>([]);
  const openSet = useMemo(() => new Set(openGroups), [openGroups]);

  const meshRegistryRef = useRef<Record<string, THREE.Mesh>>({});
  const controlsRef = useRef<any>(null);
  const cameraRef = useRef<THREE.Camera | null>(null);
  const [registryTick, setRegistryTick] = useState(0);
  const sidebarScrollRef = useRef<HTMLElement | null>(null);

  //抽屜式
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const SIDEBAR_WIDTH = 340;
  const SIDEBAR_PEEK = 0; // 收合時完全藏起來

  // Solo / Isolate 模式：null = 顯示目前部位包全部 mesh；Set = 只顯示指定 mesh。
  const [soloNormSet, setSoloNormSet] = useState<Set<string> | null>(null);
  const soloActive = soloNormSet != null;

  const shouldRenderBoneModel =
    ENABLE_BONE_GLB &&
    (soloNormSet === null || (soloNormSet instanceof Set && soloNormSet.size > 0));

  const [showHint, setShowHint] = useState(false);
  const [showControlHelp, setShowControlHelp] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [canvasRevision, setCanvasRevision] = useState(0);
  const didInitialModelFitRef = useRef(false);

  // 右側 2D 人體部位圖：只控制整個 panel 顯示/隱藏，不改 Bone2DPanel 尺寸與座標。
  const [show2DPanel, setShow2DPanel] = useState(true);
  /* useEffect(() => {
     if (typeof window === 'undefined') return;
 
     const payload: StoredS3ViewerState = {
       selectedBodyPart,
       selectedMode,
       panelMode,
       q,
       openGroups,
       sidebarOpen,
     };
 
     window.sessionStorage.setItem(S3_VIEWER_STATE_KEY, JSON.stringify(payload));
   }, [selectedBodyPart, selectedMode, panelMode, q, openGroups, sidebarOpen]);*/

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth <= 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/s3/bone-list`);
        if (!res.ok) throw new Error(await res.text());
        const json = await res.json();
        setBoneList(flattenBoneListPayload(json));
      } catch (e) {
        console.error('bone-list fetch failed:', e);
      }
    })();
  }, []);

  {/*useEffect(() => {
    const timer = setTimeout(() => setShowHint(false), 3500);
    return () => clearTimeout(timer);
  }, []);*/}

  const focusOnMesh = useCallback((meshName: string) => {
    const norm = normalizeMeshName(meshName);
    const mesh = meshRegistryRef.current[norm];
    const controls = controlsRef.current;
    const camera = cameraRef.current as any;
    if (!mesh || !controls || !camera) return;

    const box = new THREE.Box3().setFromObject(mesh);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);

    const prevTarget = controls.target.clone();
    const dir = new THREE.Vector3().subVectors(camera.position, prevTarget).normalize();

    const distance = Math.max(0.8, maxDim * 2.6);
    controls.target.copy(center);
    camera.position.copy(center.clone().add(dir.multiplyScalar(distance)));
    controls.update();
  }, []);

  const focusOnNormList = useCallback((norms: string[]) => {
    const controls = controlsRef.current;
    const camera = cameraRef.current as any;
    if (!controls || !camera) return;

    const meshes = norms.map((n) => meshRegistryRef.current[n]).filter(Boolean) as THREE.Mesh[];
    if (!meshes.length) return;

    const box = new THREE.Box3();
    meshes.forEach((m) => box.expandByObject(m));

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);

    const prevTarget = controls.target.clone();
    const dir = new THREE.Vector3().subVectors(camera.position, prevTarget).normalize();

    const distance = Math.max(1.2, maxDim * 2.2);
    controls.target.copy(center);
    camera.position.copy(center.clone().add(dir.multiplyScalar(distance)));
    controls.update();
  }, []);

  const focusOnLoadedModel = useCallback(() => {
    const controls = controlsRef.current;
    const camera = cameraRef.current as any;
    if (!controls || !camera) return;

    const meshes = Object.values(meshRegistryRef.current).filter(Boolean) as THREE.Mesh[];
    if (!meshes.length) return;

    const box = new THREE.Box3();
    meshes.forEach((m) => box.expandByObject(m));

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const distanceMultiplier = selectedBodyPart === 'full_skeleton' ? 1.45 : 2.8;
    const minDistance = selectedBodyPart === 'full_skeleton' ? 0.9 : 1.4;
    const distance = Math.max(minDistance, maxDim * distanceMultiplier);

    controls.target.copy(center);
    camera.position.set(center.x, center.y, center.z + distance);
    camera.near = Math.max(0.001, distance / 100);
    camera.far = Math.max(1000, distance * 100);
    camera.updateProjectionMatrix?.();
    controls.update();
  }, [selectedBodyPart]);

  useEffect(() => {
    if (!selectedBodyPart) return;

    requestAnimationFrame(() => {
      // 第一次載入/刷新時，先用整個模型自動取景，避免 sessionStorage 還原 selectedMeshName 後鏡頭直接貼到單顆骨頭。
      if (!didInitialModelFitRef.current) {
        didInitialModelFitRef.current = true;
        focusOnLoadedModel();
        return;
      }

      if (selectedMeshName) focusOnMesh(selectedMeshName);
      else focusOnLoadedModel();
    });
  }, [selectedBodyPart, registryTick, selectedMeshName, focusOnMesh, focusOnLoadedModel]);

  const fitModelFromDirection = useCallback((dirInput: THREE.Vector3) => {
    const controls = controlsRef.current;
    const camera = cameraRef.current as THREE.PerspectiveCamera | null;
    if (!controls || !camera) return;

    const meshes = Object.values(meshRegistryRef.current).filter(Boolean) as THREE.Mesh[];
    if (!meshes.length) return;

    const box = new THREE.Box3();
    meshes.forEach((m) => box.expandByObject(m));

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);

    const dir = dirInput.clone().normalize();

    // full_skeleton 用比較遠的距離，避免視角按鈕貼太近。
    const distanceMultiplier = selectedBodyPart === 'full_skeleton' ? 1.45 : 2.8;
    const minDistance = selectedBodyPart === 'full_skeleton' ? 0.9 : 1.4;
    const distance = Math.max(minDistance, maxDim * distanceMultiplier);

    controls.target.copy(center);
    camera.position.copy(center.clone().add(dir.multiplyScalar(distance)));

    camera.near = Math.max(0.001, distance / 100);
    camera.far = Math.max(1000, distance * 100);
    camera.updateProjectionMatrix?.();

    controls.update();
  }, [selectedBodyPart]);

  const resetView = useCallback(() => {
    // 完整骨架/部位模型都用目前已載入模型的 bounding box 自動重置視角，
    // 避免固定 camera distance 導致完整骨架被放太大。
    requestAnimationFrame(() => {
      focusOnLoadedModel();
    });
  }, [focusOnLoadedModel]);

  const selectBodyPart = useCallback((part: BodyPartKey) => {
    setSelectedBodyPart(part);
    setSelectedMode({ kind: 'none' });
    setBoneInfo(null);
    setLoadingInfo(false);
    setSoloNormSet(null);
    meshRegistryRef.current = {};
    setRegistryTick((t) => t + 1);

    requestAnimationFrame(() => {
      resetView();
    });
  }, [resetView]);

  const setView = useCallback((pos: [number, number, number], target: [number, number, number] = [0, 0, 0]) => {
    const controls = controlsRef.current;
    const camera = cameraRef.current as THREE.PerspectiveCamera | null;
    if (!controls || !camera) return;

    camera.position.set(...pos);
    controls.target.set(...target);
    controls.update();
  }, []);

  const setFrontView = useCallback(() => {
    fitModelFromDirection(new THREE.Vector3(0, 0, 1));
  }, [fitModelFromDirection]);

  const setBackView = useCallback(() => {
    fitModelFromDirection(new THREE.Vector3(0, 0, -1));
  }, [fitModelFromDirection]);

  const setViewOnly = useCallback((view: 'front' | 'back') => {
    if (!controlsRef.current) return;

    const controls = controlsRef.current;
    const camera = controls.object;

    const target = controls.target.clone();

    const currentOffset = camera.position.clone().sub(target);
    const distance = currentOffset.length();

    if (distance === 0) return;

    if (view === 'front') {
      camera.position.set(target.x, target.y, target.z + distance);
    } else {
      camera.position.set(target.x, target.y, target.z - distance);
    }

    camera.lookAt(target);
    controls.update();
  }, []);

  const setLeftView = useCallback(() => {
    fitModelFromDirection(new THREE.Vector3(-1, 0, 0));
  }, [fitModelFromDirection]);

  const setRightView = useCallback(() => {
    fitModelFromDirection(new THREE.Vector3(1, 0, 0));
  }, [fitModelFromDirection]);

  const setTopView = useCallback(() => {
    fitModelFromDirection(new THREE.Vector3(0, 1, 0.001));
  }, [fitModelFromDirection]);

  const setBottomView = useCallback(() => {
    fitModelFromDirection(new THREE.Vector3(0, -1, 0.001));
  }, [fitModelFromDirection]);

  const setAngleView = useCallback(() => {
    fitModelFromDirection(new THREE.Vector3(1, 0.45, 1));
  }, [fitModelFromDirection]);

  const resetAllView = useCallback(() => {
    setSelectedMode({ kind: 'none' });
    setBoneInfo(null);
    setLoadingInfo(false);
    setSoloNormSet(null);
    resetView();
  }, [resetView]);

  const viewButtons: [string, string, () => void][] = [
    [isEn ? 'Reset' : '重置', isEn ? 'Reset view' : '重置視角', resetAllView],
    [isEn ? 'Top' : '上', isEn ? 'Top view' : '上視角', setTopView],
    [isEn ? 'Bottom' : '底', isEn ? 'Bottom view' : '底視角', setBottomView],
    [isEn ? 'Angle' : '斜', isEn ? 'Angle view' : '斜視角', setAngleView],
    [isEn ? 'Right' : '右', isEn ? 'Right view' : '右視角', setRightView],
    [isEn ? 'Left' : '左', isEn ? 'Left view' : '左視角', setLeftView],
  ];

  const IMAGE_GALLERY_BONES_16 = new Set([
    "頸椎",
    "胸椎",
    "腰椎",
    "鎖骨",
    "肩胛骨",
    "肱骨",
    "尺骨",
    "橈骨",
    "腕骨",
    "掌骨",
    "指骨",
    "肋骨",
    "胸骨",
    "股骨",
    "脛骨",
    "腓骨",
  ]);

  function cleanBoneName(v?: string) {
    return String(v || "")
      .replace(/\s*\(\d+\)\s*$/, "")
      .trim();
  }

  function getAnyBoneItem(card: Card): BoneListItem | null {
    if ("kind" in card && card.kind === "series") return null;

    return card.C || card.L || card.R || null;
  }


  function getCardPayload(card: Card) {
    const boneZh = cleanBoneName(card.displayZh);
    const boneEn = cleanBoneName(card.displayEn);

    const item = getAnyBoneItem(card);
    const meshName = item?.mesh_name || "";

    const boneName = boneZh || boneEn || meshName;

    const imageGalleryBone = IMAGE_GALLERY_BONES_16.has(boneZh)
      ? boneZh
      : "";

    return { boneName, boneZh, boneEn, meshName, imageGalleryBone };
  }

  function navigateWithBoneLoading(path: string, label: string) {
    setIsNavigating(true);
    setNavigatingText(label);

    setTimeout(() => {
      router.push(path);
    }, 900);
  }

  function renderLearningButtons(card: Card) {
    const { boneName, imageGalleryBone } = getCardPayload(card);
    if (!boneName) return null;

    // RAG 已經改由下方「小挑戰 / 延伸問題」按鈕負責，
    // 這裡只保留影像學習庫，避免重複入口。
    if (!imageGalleryBone) return null;

    return (
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            navigateWithBoneLoading(
              `/bonevision?openGallery=1&bone=${encodeURIComponent(imageGalleryBone)}`,
              isEn
                ? `Opening image learning gallery: ${imageGalleryBone}`
                : `正在開啟影像學習庫：${imageGalleryBone}`);
          }}
          className="rounded-lg px-3 py-1 text-xs font-semibold"
          style={{
            backgroundColor: "rgba(34,197,94,0.14)",
            color: "#15803d",
          }}
        >
          {isEn ? 'View Images' : '看影像'}
        </button>
      </div>
    );
  }

  const findListItemByMeshName = useCallback(
    (meshName: string) => {
      const n = normalizeMeshName(meshName);
      return boneList.find((x) => normalizeMeshName(x.mesh_name) === n) ?? null;
    },
    [boneList]
  );

  const searchScoreByMesh = useMemo(() => {
    const kw = q.trim();
    const map = new Map<string, number>();

    boneList.forEach((item) => {
      const key = normalizeMeshName(item.mesh_name);
      const score = kw ? scoreS3BoneByKeyword(item, kw) : 1;
      map.set(key, score);
    });

    return map;
  }, [boneList, q]);

  const searched = useMemo(() => {
    const kw = q.trim();

    if (!kw) return boneList;

    const broadKind = getBroadS3SearchKind(kw);

    // 大類詞直接硬篩選，避免「脊椎」撈到上肢、骨盆、下肢
    if (broadKind) {
      return boneList.filter((item) => matchBroadS3Search(item, broadKind));
    }

    return boneList
      .map((item, index) => {
        const score = searchScoreByMesh.get(normalizeMeshName(item.mesh_name)) ?? 0;

        return {
          item,
          index,
          score,
        };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.index - b.index;
      })
      .map((x) => x.item);
  }, [boneList, q, searchScoreByMesh]);

  const regionCards = useMemo(() => {
    const byRegion: Record<RegionKey, BoneListItem[]> = {
      skull: [],
      spine: [],
      thorax: [],
      upper: [],
      lower: [],
      pelvis: [],
      other: [],
    };
    for (const it of searched) byRegion[toRegionKey(it.bone_region)].push(it);

    const result: Record<RegionKey, Card[]> = {
      skull: [],
      spine: [],
      thorax: [],
      upper: [],
      lower: [],
      pelvis: [],
      other: [],
    };

    (Object.keys(byRegion) as RegionKey[]).forEach((rk) => {
      result[rk] = buildCardsForRegion(byRegion[rk], rk, searchScoreByMesh);
    });

    return result;
  }, [searched, searchScoreByMesh]);

  const navGroupCards = useMemo(() => {
    const result: Record<NavGroupKey, Card[]> = {
      'head-neck': [],
      'thorax-back': [],
      'upper-limb': [],
      pelvis: [],
      'lower-limb': [],
      other: [],
    };

    (Object.keys(regionCards) as RegionKey[]).forEach((rk) => {
      regionCards[rk].forEach((card) => {
        const navKey = getNavKeyForCard(card);
        result[navKey].push(card);
      });
    });

    return result;
  }, [regionCards]);

  const availableGroups = useMemo(() => {
    return NAV_GROUPS
      .map((group) => group.key)
      .filter((key) => navGroupCards[key].length > 0);
  }, [navGroupCards]);

  const allOpen = useMemo(() => {
    const groups = availableGroups;
    if (!groups.length) return false;
    return groups.every((key) => openSet.has(key));
  }, [availableGroups, openSet]);

  const toggleAllGroups = useCallback(() => {
    setOpenGroups((prev) => {
      const prevSet = new Set(prev);
      const groups = availableGroups;
      const nextAllOpen = groups.length > 0 && groups.every((key) => prevSet.has(key));
      if (nextAllOpen) return [];
      return groups;
    });
  }, [availableGroups]);

  const toggleGroup = useCallback((key: NavGroupKey) => {
    setOpenGroups((prev) =>
      prev.includes(key)
        ? prev.filter((x) => x !== key)
        : [...prev, key]
    );
  }, []);

  const openNavGroupFrom2D = useCallback((key: NavGroupKey) => {
    // 2D 圖只做「導覽」：
    // 打開左側、展開分類、必要時捲到分類標題。
    // 不自動選骨頭、不改 3D 高亮、不清空其他分類。
    setSidebarOpen(true);

    setOpenGroups((prev) =>
      prev.includes(key) ? prev : [...prev, key]
    );

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const sidebar = sidebarScrollRef.current;
        const target = document.getElementById(`nav-group-${key}`);

        if (!sidebar || !target) return;

        const sidebarRect = sidebar.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();

        // sticky 標題 + 搜尋框大概佔的安全距離
        const topSafeGap = 120;
        const bottomSafeGap = 40;

        const titleTopVisible =
          targetRect.top >= sidebarRect.top + topSafeGap &&
          targetRect.top <= sidebarRect.bottom - bottomSafeGap;

        // 如果大類標題已經看得到，就不要捲，避免清單一直跳一下
        if (titleTopVisible) return;

        const nextTop =
          sidebar.scrollTop +
          (targetRect.top - sidebarRect.top) -
          topSafeGap;

        sidebar.scrollTo({
          top: Math.max(0, nextTop),
          behavior: 'smooth',
        });
      });
    });
  }, []);

  const seriesNorms = useMemo(() => {
    const out: Record<SeriesKind, string[]> = { cervical: [], thoracic: [], lumbar: [] };

    for (const it of boneList) {
      const norm = normalizeMeshName(it.mesh_name);
      const s = meshToSeries(norm);
      if (s) out[s].push(norm);
    }

    (['cervical', 'thoracic', 'lumbar'] as SeriesKind[]).forEach((sk) => {
      const meta = seriesMeta(sk);
      const set = new Set(out[sk]);
      out[sk] = meta.order.filter((k) => set.has(k));
    });

    return out;
  }, [boneList]);

  const selectedNormSet = useMemo(() => {
    if (selectedMode.kind === 'mesh') return new Set([normalizeMeshName(selectedMode.meshName)]);
    if (selectedMode.kind === 'series') return new Set(seriesNorms[selectedMode.series]);
    return new Set<string>();
  }, [selectedMode, seriesNorms]);

  const outlineSelection = useMemo(() => {
    void registryTick;
    const objs: THREE.Object3D[] = [];
    selectedNormSet.forEach((norm) => {
      const m = meshRegistryRef.current[norm];
      if (m) objs.push(m);
    });
    return objs;
  }, [selectedNormSet, registryTick]);

  const selectSeries = useCallback(
    (series: SeriesKind) => {
      const navKey: NavGroupKey = series === 'cervical' ? 'head-neck' : 'thorax-back';
      setOpenGroups((prev) => (prev.includes(navKey) ? prev : [...prev, navKey]));
      setBoneInfo(null);
      setLoadingInfo(false);
      setSelectedMode({ kind: 'series', series });
      setSelectedBodyPart('full_skeleton');
      meshRegistryRef.current = {};
      setRegistryTick((t) => t + 1);
      setSoloNormSet(null);

      requestAnimationFrame(() => {
        const el = document.getElementById(`card-spine-${series}`);
        if (!isMobile) {
          el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
      });

      requestAnimationFrame(() => focusOnNormList(seriesNorms[series]));
    },
    [focusOnNormList, seriesNorms]
  );

  const selectByMeshName = useCallback(
    async (
      meshName: string,
      options: { scrollToCard?: boolean } = { scrollToCard: true }
    ) => {
      setSelectedMode({ kind: 'mesh', meshName });
      setTeachingLevelHelpOpen(false);
      setLoadingInfo(true);

      // 穩定版：點骨頭只做「選取、高亮、對應左邊清單」
      // 不切換成切割部位 GLB，也不自動只顯示單顆
      const normSel = normalizeMeshName(meshName);
      setSoloNormSet(null);

      const li = findListItemByMeshName(meshName);

      if (selectedBodyPart !== 'full_skeleton') {
        setSelectedBodyPart('full_skeleton');
        meshRegistryRef.current = {};
        setRegistryTick((t) => t + 1);
      }

      if (li) {
        const { base } = parseSide(li.mesh_name);
        const pretty = prettyForBase(base, li.bone_zh, li.bone_en);

        setBoneInfo({
          small_bone_id: Number(li.small_bone_id),
          bone_id: Number(li.bone_id),
          bone_zh: pretty.zh,
          bone_en: pretty.en,
          bone_region: li.bone_region ?? null,
          bone_desc: li.bone_desc ?? null,
          teaching: li.teaching ?? null,
        });

        const rk = toRegionKey(li.bone_region);
        const navKey = getNavKeyForBoneItem(li);
        setOpenGroups((prev) => (prev.includes(navKey) ? prev : [...prev, navKey]));

        const norm = normalizeMeshName(li.mesh_name);
        const s = meshToSeries(norm);
        const cardId = rk === 'spine' && s ? `card-spine-${s}` : `card-${rk}-${encodeURIComponent(parseSide(norm).base)}`;

        setExpandedCardId(cardId);

        if (options.scrollToCard !== false) {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              const sidebar = sidebarScrollRef.current;
              const el = document.getElementById(cardId);

              if (!sidebar || !el || isMobile) return;

              const sidebarRect = sidebar.getBoundingClientRect();
              const cardRect = el.getBoundingClientRect();

              // 讓卡片上緣停在 sticky 標題下面，保留骨名、L/R 按鈕可見
              const topSafeGap = 78;

              const nextTop =
                sidebar.scrollTop +
                (cardRect.top - sidebarRect.top) -
                topSafeGap;

              sidebar.scrollTo({
                top: Math.max(0, nextTop),
                behavior: 'smooth',
              });
            });
          });
        }
      } else {
        setBoneInfo(null);
      }

      requestAnimationFrame(() => focusOnMesh(meshName));
      setLoadingInfo(false);
    },
    [findListItemByMeshName, focusOnMesh, selectedBodyPart, isMobile]
  );

  useEffect(() => {
    if (!targetBone && !targetMesh) return;

    let cancelled = false;

    async function autoSelectFromQuery() {
      // 1) 優先用 mesh + bone 打後端 mesh-map
      // /model?bone=遠節指骨&mesh=Little_Distal.R
      // 會變成：
      // /s3/mesh-map/Little_Distal.R?bone=遠節指骨
      if (targetMesh) {
        try {
          const url =
            `${API_BASE}/s3/mesh-map/${encodeURIComponent(targetMesh)}` +
            `?bone=${encodeURIComponent(targetBone || "")}`;

          console.log("[S3 autoSelect] mesh-map url =", url);

          const res = await fetch(url);
          const data = await res.json().catch(() => null);

          console.log("[S3 autoSelect] mesh-map result =", data);

          if (!cancelled && res.ok && data?.best_match?.mesh_name) {
            const realMeshName = String(data.best_match.mesh_name);
            selectByMeshName(realMeshName);
            return;
          }
        } catch (err) {
          console.error("[S3 autoSelect] mesh-map failed:", err);
        }

        // 2) 如果後端 mesh-map 查不到，至少嘗試直接用 URL mesh 選
        if (!cancelled) {
          const localHit = findListItemByMeshName(targetMesh);
          if (localHit?.mesh_name) {
            selectByMeshName(localHit.mesh_name);
            return;
          }
        }
      }

      // 3) 最後才用 bone 名稱模糊找 bone-list
      // 這是 fallback，不要當主路徑
      if (targetBone) {
        const normalizedTargetBone = String(targetBone)
          .replace(/\s+/g, "")
          .replace(/[指趾]/g, "[指趾]");

        const hit = boneList.find((x: any) => {
          const zh = String(x.bone_zh || "").replace(/\s+/g, "");
          const en = String(x.bone_en || "").toLowerCase();
          const mesh = String(x.mesh_name || "").toLowerCase();

          return (
            zh.includes(targetBone.replace(/\s+/g, "")) ||
            en.includes(targetBone.toLowerCase()) ||
            mesh.includes(targetBone.toLowerCase()) ||
            new RegExp(normalizedTargetBone).test(zh)
          );
        });

        if (!cancelled && hit?.mesh_name) {
          selectByMeshName(hit.mesh_name);
          return;
        }

        console.warn("[S3 autoSelect] 找不到對應 mesh:", {
          targetBone,
          targetMesh,
        });
      }
    }

    autoSelectFromQuery().catch(console.error);

    return () => {
      cancelled = true;
    };
  }, [
    targetBone,
    targetMesh,
    boneList,
    findListItemByMeshName,
    selectByMeshName,
  ]);

  useEffect(() => {
    if (!targetBoneId) return;
    if (!boneList.length) return;

    const boneIdNum = Number(targetBoneId);
    if (!Number.isFinite(boneIdNum)) return;

    const matches = boneList.filter((x) => Number(x.bone_id) === boneIdNum);
    if (!matches.length) return;

    const first = matches[0];
    const rk = toRegionKey(first.bone_region);
    const navKey = getNavKeyForBoneItem(first);

    setOpenGroups((prev) => (prev.includes(navKey) ? prev : [...prev, navKey]));

    const { base } = parseSide(first.mesh_name);
    const pretty = prettyForBase(base, first.bone_zh, first.bone_en);

    setBoneInfo({
      small_bone_id: Number(first.small_bone_id),
      bone_id: Number(first.bone_id),
      bone_zh: pretty.zh,
      bone_en: pretty.en,
      bone_region: first.bone_region ?? null,
      bone_desc: first.bone_desc ?? null,
      teaching: first.teaching ?? null,
    });
    if (matches.length === 1) {
      selectByMeshName(first.mesh_name);
      return;
    }

    const norm = normalizeMeshName(first.mesh_name);
    const s = meshToSeries(norm);

    const cardId =
      rk === 'spine' && s
        ? `card-spine-${s}`
        : `card-${rk}-${encodeURIComponent(parseSide(norm).base)}`;

    requestAnimationFrame(() => {
      const el = document.getElementById(cardId);
      if (!isMobile) {
        el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    });

    requestAnimationFrame(() => {
      focusOnMesh(first.mesh_name);
    });
  }, [targetBoneId, boneList, focusOnMesh, selectByMeshName]);
  const onPickMeshFrom3D = useCallback(
    (meshName: string) => {
      selectByMeshName(meshName);
    },
    [selectByMeshName]
  );

  function isActiveCard(card: Card) {
    if (card.kind === 'series') {
      if (selectedSeries === card.series) return true;
      if (selectedMeshName) {
        const norm = normalizeMeshName(selectedMeshName);
        return meshToSeries(norm) === card.series;
      }
      return false;
    }

    if (!selectedMeshName) return false;
    const sel = normalizeMeshName(selectedMeshName);
    const vars = [card.L?.mesh_name, card.R?.mesh_name, card.C?.mesh_name].filter(Boolean) as string[];
    return vars.some((m) => normalizeMeshName(m) === sel);
  }

  /** =========================
   *  Styles
   *  ========================= */
  const sAside: React.CSSProperties = {
    position: 'absolute',
    top: 18,
    left: 18,
    zIndex: 30,
    width: SIDEBAR_WIDTH,
    height: 'calc(100% - 36px)',
    background: 'var(--panel-bg)',
    color: 'var(--panel-text)',
    border: '1px solid var(--panel-border)',
    borderRadius: 18,
    padding: 14,
    overflowY: 'auto',
    overflowX: 'hidden',
    boxShadow: '0 16px 36px rgba(0,0,0,0.22)',
    transform: sidebarOpen ? 'translateX(0)' : `translateX(calc(-100% - 18px))`,
    transition: 'transform 0.26s ease',
    backdropFilter: 'blur(12px)',
  };

  const sGroupBtn = (open: boolean): React.CSSProperties => ({
    width: '100%',
    textAlign: 'left',
    padding: '10px 12px',
    borderRadius: 12,
    border: '1px solid var(--panel-border)',
    background: open ? 'var(--panel-btn-open-bg)' : 'var(--panel-btn-bg)',
    color: 'var(--panel-text)',
    cursor: 'pointer',
    fontWeight: 900,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  });

  const sCard = (active: boolean): React.CSSProperties => ({
    textAlign: 'left',
    padding: 14,
    borderRadius: 16,
    background: active ? 'var(--panel-btn-open-bg)' : 'var(--card-bg)',
    color: 'var(--foreground)',
    border: active ? '1.5px solid var(--accent)' : '1px solid var(--panel-border)',
    boxShadow: active ? '0 8px 22px rgba(56,189,248,0.16)' : 'none',
  });

  const sMini: React.CSSProperties = {
    fontSize: 11,
    opacity: 0.6,
    marginTop: 6,
    lineHeight: 1.35,
  };

  const sTeachingSection: React.CSSProperties = {
    marginTop: 10,
    padding: '10px 10px',
    borderRadius: 12,
    background: 'rgba(148,163,184,0.08)',
    border: '1px solid var(--panel-border)',
  };

  const sTeachingTitle: React.CSSProperties = {
    fontWeight: 900,
    fontSize: 12,
    marginBottom: 6,
  };

  const sTeachingText: React.CSSProperties = {
    opacity: 0.92,
    whiteSpace: 'pre-wrap',
    lineHeight: 1.65,
  };

  const sTeachingLevelBadge = (meta: ReturnType<typeof getTeachingLevelMeta>): React.CSSProperties => ({
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    marginBottom: 0,
    padding: '5px 10px',
    borderRadius: 999,
    background: meta.bg,
    color: meta.color,
    border: `1px solid ${meta.border}`,
    fontSize: 12,
    fontWeight: 900,
  });

  const sTeachingHelpDot: React.CSSProperties = {
    width: 18,
    height: 18,
    borderRadius: 999,
    border: '1px solid rgba(148,163,184,0.45)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(255,255,255,0.65)',
    fontSize: 11,
    fontWeight: 900,
    cursor: 'help',
    padding: 0,
    lineHeight: 1,
    color: 'inherit',
  };

  const sTeachingHelpTooltip: React.CSSProperties = {
    position: 'absolute',
    top: 'calc(100% + 8px)',
    right: 0,
    zIndex: 90,
    width: 190,
    padding: '9px 10px',
    borderRadius: 12,
    background: 'var(--panel-bg)',
    color: 'var(--panel-text)',
    border: '1px solid var(--panel-border)',
    boxShadow: '0 10px 24px rgba(15,23,42,0.18)',
    fontSize: 12,
    fontWeight: 600,
    lineHeight: 1.55,
    whiteSpace: 'normal',
  };

  const sVariantBtn = (active: boolean): React.CSSProperties => ({
    height: 34,
    padding: '0 12px',
    borderRadius: 10,
    border: active ? '2px solid var(--accent)' : '1px solid var(--panel-border)',
    background: 'var(--chip-bg)',
    color: 'var(--chip-text)',
    cursor: 'pointer',
    fontWeight: 900,
  });

  const sWholeBtn: React.CSSProperties = {
    height: 32,
    padding: '0 10px',
    borderRadius: 10,
    border: '1px solid var(--panel-border)',
    background: 'var(--chip-bg)',
    color: 'var(--chip-text)',
    cursor: 'pointer',
    fontWeight: 900,
    opacity: 0.95,
  };

  const sTopToggleBtn: React.CSSProperties = {
    height: 32,
    padding: '0 10px',
    borderRadius: 10,
    border: '1px solid var(--panel-border)',
    background: 'var(--panel-btn-bg)',
    color: 'var(--panel-text)',
    cursor: 'pointer',
    fontWeight: 700,
    fontSize: 13,
  };


  const sTabBtn = (active: boolean): React.CSSProperties => ({
    flex: 1,
    height: 36,
    borderRadius: 12,
    border: active ? '1px solid var(--accent)' : '1px solid var(--panel-border)',
    background: active ? 'var(--panel-btn-open-bg)' : 'var(--panel-btn-bg)',
    color: 'var(--panel-text)',
    cursor: 'pointer',
    fontWeight: 900,
    fontSize: 14,
  });

  const sIconBtn: React.CSSProperties = {
    width: 34,
    height: 34,
    borderRadius: 10,
    border: '1px solid var(--panel-border)',
    background: 'transparent',
    color: 'var(--panel-text)',
    cursor: 'pointer',
    fontWeight: 900,
    fontSize: 16,
    opacity: 0.7,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };

  return (
    <div
      className="s3-viewer-page"



      style={{
        position: 'relative',
        width: '100%',
        height: 'calc(100vh - 56px)',
        overflow: 'hidden',
        background: 'var(--viewer-bg)',
      }}    >

      {isNavigating && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/55 backdrop-blur-sm">
          <div className="rounded-3xl border px-8 py-7 text-center shadow-2xl bg-white/90">
            <div className="mx-auto mb-4 flex h-16 items-end justify-center gap-1">
              {["🦴", "🦴", "🦴"].map((b, i) => (
                <span
                  key={i}
                  className="text-3xl animate-bounce"
                  style={{ animationDelay: `${i * 120}ms` }}
                >
                  {b}
                </span>
              ))}
            </div>

            <div className="text-sm font-semibold text-slate-800">
              {isEn ? 'Opening learning scene' : '正在開啟學習場景'}
            </div>

            <div className="mt-1 text-xs text-slate-500">
              {navigatingText}
            </div>
          </div>
        </div>
      )}




      {/* 左側清單 */}
      <aside
        ref={sidebarScrollRef}
        className={`s3-bone-sidebar ${sidebarOpen ? 'is-open' : 'is-closed'}`}
        style={sAside}
      >
        <div
          style={{
            position: 'sticky',
            top: -14,
            zIndex: 10,

            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,

            margin: '-14px -14px 14px -14px',
            padding: '14px 14px 12px 14px',

            background: 'linear-gradient(to bottom, var(--panel-bg) 0%, var(--panel-bg) 70%, transparent 100%)',
            borderBottom: '1px solid var(--panel-border)',
            boxShadow: 'none',
            backdropFilter: 'blur(6px)',
          }}
        >
          <div style={{ fontWeight: 800, fontSize: 15, whiteSpace: 'nowrap' }}>
            {isEn ? "Skeleton Guide" : "骨架導覽"}
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button style={sTopToggleBtn} onClick={toggleAllGroups}>
              {allOpen
                ? isEn ? 'Collapse All' : '一鍵收起'
                : isEn ? 'Expand All' : '一鍵展開'}
            </button>

            <button
              onClick={() => setSidebarOpen(false)}
              title={isEn ? 'Collapse panel' : '收合面板'}
              style={sIconBtn}
            >
              ×
            </button>
          </div>
        </div>

        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={
            isEn
              ? 'Search bones: clavicle, sternum, ribs, ulna, femur, patella...'
              : '搜尋骨頭：鎖骨、胸骨、肋骨、尺骨、股骨、髕骨...'
          } style={{
            width: '100%',
            padding: '10px 12px',
            borderRadius: 10,
            border: '1px solid var(--input-border)',
            background: 'var(--input-bg)',
            color: 'var(--input-text)',
            marginBottom: 12,
            outline: 'none',
          }}
        />

        {NAV_GROUPS.map((group) => {
          const cards = navGroupCards[group.key];
          const isOpen = openSet.has(group.key);
          const count = cards.length;

          if (!cards.length) return null;

          return (
            <div
              id={`nav-group-${group.key}`}
              key={group.key}
              style={{
                marginBottom: 10,
                scrollMarginTop: 150,
              }}
            >
              <button
                onClick={() => toggleGroup(group.key)}
                style={sGroupBtn(isOpen)}
              >
                <span>{isEn ? group.labelEn : group.labelZh}</span>
                <span style={{ opacity: 0.75, fontSize: 12 }}>
                  {count}
                </span>
              </button>

              {isOpen && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
                  {cards.map((card) => {
                    const active = isActiveCard(card);
                    const cardId =
                      card.kind === 'series'
                        ? `card-spine-${card.series}`
                        : `card-${card.regionKey}-${encodeURIComponent(card.base)}`;

                    const expanded = expandedCardId === cardId;
                    const displayItem =
                      card.kind === 'series'
                        ? null
                        : card.C || card.L || card.R || null;

                    const displayTeaching =
                      active && boneInfo?.teaching
                        ? boneInfo.teaching
                        : displayItem?.teaching ?? null;

                    const displayName =
                      active && boneInfo
                        ? { zh: boneInfo.bone_zh, en: boneInfo.bone_en }
                        : { zh: card.displayZh, en: card.displayEn };

                    const displayRegion =
                      active && boneInfo
                        ? boneInfo.bone_region ?? ''
                        : displayItem?.bone_region ?? '';

                    const displayDesc =
                      active && boneInfo
                        ? boneInfo.bone_desc ?? ''
                        : displayItem?.bone_desc ?? '';

                    const teachingIntro = isEn
                      ? displayName.en
                        ? `This section introduces ${displayName.en}, including its basic position, structure, and learning focus.`
                        : displayTeaching?.IntroText ?? ''
                      : displayTeaching?.IntroText ?? '';

                    const teachingQuestions = isEn
                      ? [
                        `Where is ${displayName.en} located?`,
                        `How can I distinguish ${displayName.en} from nearby bones?`,
                        `How can I quickly locate ${displayName.en} in the 3D model?`,
                      ]
                      : parseSuggestedQuestions(displayTeaching?.SuggestedQuestions);
                    const teachingLevel = displayTeaching?.TeachingLevel ?? 'basic';
                    const isBasicTeaching = teachingLevel !== 'key' && teachingLevel !== 'advanced';


                    return (
                      <div
                        id={cardId}
                        key={cardId}
                        style={{
                          ...sCard(active || expanded),
                          cursor: 'pointer',
                        }}
                        onClick={() => {
                          setExpandedCardId((prev) => (prev === cardId ? null : cardId));
                          setTeachingLevelHelpOpen(false);
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                          <div>
                            <div style={{ fontWeight: 900, fontSize: 15 }}>
                              {isEn ? card.displayEn : card.displayZh}
                            </div>
                            <div style={{ fontSize: 12, opacity: 0.82 }}>{card.displayEn}</div>
                          </div>

                          {card.kind === 'series' ? (
                            <button
                              style={sWholeBtn}
                              onClick={(e) => {
                                e.stopPropagation();
                                setExpandedCardId(cardId);
                                selectSeries(card.series);
                              }}
                              title={isEn ? 'Select whole group' : '選取整組（全部亮）'}                          >
                              {isEn ? 'Group' : '整組'}
                            </button>
                          ) : null}
                        </div>

                        {'tag' in card && (card as any).tag ? (
                          <div style={{ fontSize: 12, opacity: 0.78, marginTop: 6 }}>{(card as any).tag}</div>
                        ) : null}

                        {card.kind === 'lr' ? (
                          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>

                            {card.L ? (
                              <button
                                style={sVariantBtn(
                                  !!selectedMeshName && normalizeMeshName(card.L.mesh_name) === normalizeMeshName(selectedMeshName)
                                )}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setExpandedCardId(cardId);
                                  selectByMeshName(card.L!.mesh_name, { scrollToCard: false });
                                }}
                                title={card.L.mesh_name}
                              >
                                L
                              </button>
                            ) : null}

                            {card.R ? (
                              <button
                                style={sVariantBtn(
                                  !!selectedMeshName && normalizeMeshName(card.R.mesh_name) === normalizeMeshName(selectedMeshName)
                                )}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setExpandedCardId(cardId);
                                  selectByMeshName(card.R!.mesh_name, { scrollToCard: false });
                                }}
                                title={card.R.mesh_name}
                              >
                                R
                              </button>
                            ) : null}

                            {!card.L && !card.R && card.C ? (
                              <button
                                style={sVariantBtn(
                                  !!selectedMeshName && normalizeMeshName(card.C.mesh_name) === normalizeMeshName(selectedMeshName)
                                )}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setExpandedCardId(cardId);
                                  selectByMeshName(card.C!.mesh_name, { scrollToCard: false });
                                }}
                                title={card.C.mesh_name}
                              >
                                {isEn ? 'Select' : '選取'}
                              </button>
                            ) : null}

                            {active && selectedMeshName ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (!soloActive) {
                                    setSoloNormSet(new Set([normalizeMeshName(selectedMeshName)]));
                                  } else {
                                    setSoloNormSet(null);
                                  }
                                }}
                                title={
                                  soloActive
                                    ? isEn ? 'Show all bones in this body part' : '顯示目前部位包的全部骨頭'
                                    : isEn ? 'Show only the selected bone' : '只顯示目前選取的這顆骨頭'
                                }
                                style={{
                                  height: 34,
                                  padding: '0 12px',
                                  borderRadius: 10,
                                  border: soloActive ? '2px solid var(--accent)' : '1px solid var(--panel-border)',
                                  background: soloActive ? 'rgba(56,189,248,0.14)' : 'var(--chip-bg)',
                                  color: soloActive ? '#0369a1' : 'var(--chip-text)',
                                  cursor: 'pointer',
                                  fontWeight: 900,
                                  fontSize: 13,
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {soloActive
                                  ? isEn ? 'Show All' : '顯示全部'
                                  : isEn ? 'Isolate Bone' : '只顯示此骨頭'}
                              </button>
                            ) : null}

                            {((!!card.L && !card.R) || (!card.L && !!card.R)) && !card.C ? (
                              <button
                                style={sVariantBtn(
                                  !!selectedMeshName &&
                                  normalizeMeshName((card.L ?? card.R)!.mesh_name) === normalizeMeshName(selectedMeshName)
                                )}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setExpandedCardId(cardId);
                                  selectByMeshName((card.L ?? card.R)!.mesh_name, { scrollToCard: false });
                                }}
                                title={(card.L ?? card.R)!.mesh_name}
                              >
                                選取
                              </button>
                            ) : null}
                          </div>
                        ) : (
                          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                            {card.order.map((k) => {
                              const it = card.items[k];
                              const isBtnActive =
                                !!selectedMeshName && normalizeMeshName(it.mesh_name) === normalizeMeshName(selectedMeshName);

                              return (
                                <button
                                  key={k}
                                  style={sVariantBtn(isBtnActive)}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setExpandedCardId(cardId);
                                    selectByMeshName(it.mesh_name, { scrollToCard: false });
                                  }}
                                  title={it.mesh_name}
                                >
                                  {k}
                                </button>
                              );
                            })}
                          </div>
                        )}

                        {renderLearningButtons(card)}

                        {card.kind === 'lr' ? (
                          <div style={sMini}>
                            {card.L ? `L: ${normalizeMeshName(card.L.mesh_name)}` : ''}{' '}
                            {card.R ? `｜ R: ${normalizeMeshName(card.R.mesh_name)}` : ''}
                            {card.C ? `｜ C: ${normalizeMeshName(card.C.mesh_name)}` : ''}
                          </div>
                        ) : (
                          <div style={sMini}>
                            {isEn
                              ? `Click “Group” to highlight all ${card.displayEn} (${card.order.join(', ')}). Click a single item to view its details.`
                              : `點「整組」會讓 ${card.displayZh} (${card.order.join(', ')}) 全部一起亮；再點單顆會顯示該節資訊。`}                          </div>
                        )}

                        {/* Info */}
                        {expanded && (
                          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--panel-border)' }}>


                            {loadingInfo && active ? (
                              <div style={{ opacity: 0.7, fontSize: 13 }}>{isEn ? 'Loading…' : '載入中…'}</div>
                            ) : !displayTeaching && !displayDesc ? (
                              <div style={{ opacity: 0.7, fontSize: 13 }}>{isEn ? 'No information loaded yet' : '尚未載入資訊'}</div>
                            ) : (
                              <div style={{ fontSize: 13, lineHeight: 1.55 }}>
                                <div
                                  style={{
                                    display: 'flex',
                                    alignItems: 'flex-start',
                                    justifyContent: 'space-between',
                                    gap: 10,
                                    marginBottom: 8,
                                  }}
                                >
                                  <div style={{ minWidth: 0 }}>
                                    <div style={{ fontWeight: 900 }}>
                                      {isEn ? displayName.en : displayName.zh}
                                      {!isEn ? ` / ${displayName.en}` : ''}
                                    </div>
                                    <div style={{ opacity: 0.85 }}>
                                      {isEn
                                        ? displayRegion
                                          .replace('軀幹骨', 'Axial Skeleton')
                                          .replace('上肢骨', 'Appendicular Skeleton - Upper Limb')
                                          .replace('下肢骨', 'Appendicular Skeleton - Lower Limb')
                                        : displayRegion}
                                    </div>
                                  </div>

                                  {displayTeaching ? (() => {
                                    const levelMeta = getTeachingLevelMeta(displayTeaching.TeachingLevel, isEn);
                                    return (
                                      <div
                                        style={{
                                          ...sTeachingLevelBadge(levelMeta),
                                          marginBottom: 0,
                                          flexShrink: 0,
                                        }}
                                        onMouseEnter={() => setTeachingLevelHelpOpen(true)}
                                        onMouseLeave={() => setTeachingLevelHelpOpen(false)}
                                      >
                                        <span>{levelMeta.label}</span>
                                        <button
                                          type="button"
                                          aria-label={`${levelMeta.label}說明`}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setTeachingLevelHelpOpen((v) => !v);
                                          }}
                                          style={sTeachingHelpDot}
                                        >
                                          ?
                                        </button>

                                        {teachingLevelHelpOpen ? (
                                          <div role="tooltip" style={sTeachingHelpTooltip}>
                                            {levelMeta.desc}
                                          </div>
                                        ) : null}
                                      </div>
                                    );
                                  })() : null}
                                </div>


                                {hasTeachingText(displayTeaching) ? (
                                  <>
                                    {displayTeaching?.IntroText ? (
                                      <div style={sTeachingSection}>
                                        <div style={sTeachingTitle}>
                                          {isBasicTeaching
                                            ? isEn ? 'Brief Introduction' : '簡短介紹'
                                            : isEn ? 'Detailed Introduction' : '詳細介紹'}
                                        </div>
                                        <div style={sTeachingText}>{teachingIntro}</div>
                                      </div>
                                    ) : null}

                                    {!isBasicTeaching && displayTeaching?.StructureFunctionText ? (
                                      <div style={sTeachingSection}>
                                        <div style={sTeachingTitle}>
                                          {isEn ? 'Structure & Function' : '結構與功能'}
                                        </div>

                                        <div style={sTeachingText}>
                                          {isEn
                                            ? `Learn the structural characteristics and functional role of ${displayName.en}.`
                                            : displayTeaching.StructureFunctionText}
                                        </div>
                                      </div>
                                    ) : null}

                                    {!isBasicTeaching && displayTeaching?.LearningText ? (
                                      <div style={sTeachingSection}>
                                        <div style={sTeachingTitle}>
                                          {isEn ? '3D Positioning & Recognition' : '3D定位與辨認'}
                                        </div>

                                        <div style={sTeachingText}>
                                          {isEn
                                            ? `Use the 3D model to observe the position, orientation, and surrounding anatomical relationships of ${displayName.en}.`
                                            : displayTeaching.LearningText}
                                        </div>
                                      </div>
                                    ) : null}
                                    {teachingQuestions.length > 0 ? (
                                      <div style={sTeachingSection}>
                                        <div style={sTeachingTitle}>
                                          {isEn ? 'Challenge / Follow-up Questions' : '小挑戰 / 延伸問題'}
                                        </div>
                                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                          {teachingQuestions.map((question) => {
                                            const boneLabel = isEn ? displayName.en : displayName.zh;

                                            const questionParams = new URLSearchParams({
                                              q: question,
                                              bone: boneLabel,
                                              bone_zh: displayName.zh,
                                              bone_en: displayName.en,
                                              mesh: selectedMeshName ?? displayItem?.mesh_name ?? '',
                                            });

                                            return (
                                              <button
                                                key={question}
                                                type="button"
                                                onClick={() => {
                                                  navigateWithBoneLoading(
                                                    `/llm?${questionParams.toString()}`,
                                                    isEn
                                                      ? `Opening GalaBone RAG: ${question}`
                                                      : `正在開啟 GalaBone RAG：${question}`
                                                  );
                                                }}
                                                className="rounded-lg px-3 py-1 text-xs font-semibold"
                                                style={{
                                                  backgroundColor: 'rgba(56,189,248,0.14)',
                                                  color: '#0369a1',
                                                  textAlign: 'left',
                                                  justifyContent: 'flex-start',
                                                  alignItems: 'flex-start',
                                                  whiteSpace: 'normal',
                                                }}                                              >
                                                {question}
                                              </button>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    ) : null}
                                  </>
                                ) : displayDesc ? (
                                  <div style={{ opacity: 0.9, marginTop: 8, whiteSpace: 'pre-wrap' }}>
                                    {displayDesc}
                                  </div>
                                ) : null}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </aside>
      {!sidebarOpen && (
        <button
          className="s3-sidebar-open-btn"
          onClick={() => setSidebarOpen(true)}
          style={{
            position: 'absolute',
            top: 22,
            left: 24,
            zIndex: 35,
            height: 40,
            padding: '0 16px',
            borderRadius: 14,
            border: '1px solid var(--panel-border)',
            background: 'var(--panel-bg)',
            color: 'var(--panel-text)',
            cursor: 'pointer',
            fontWeight: 900,
            fontSize: 15,
            boxShadow: '0 8px 20px rgba(0,0,0,0.14)',
            backdropFilter: 'blur(10px)',
          }}        >
          {isEn ? '☰ Menu' : '☰ 選單'}
        </button>
      )}

      {/* 右側 3D */}
      <main
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          background: 'var(--viewer-bg)',
        }}
      >
        {/* 視角按鈕：統一放在人體圖下方 }
 

        {/* 右側 2D 正反面骨骼對應圖：可收合，但不改 Bone2DPanel 內部尺寸/座標 */}
        <div
          className="s3-2d-panel"
          style={{
            position: 'absolute',
            top: 24,
            right: show2DPanel ? 24 : -430,
            width: 270,
            height: 'calc(100dvh - 120px)',
            display: 'flex',
            flexDirection: 'column',
            zIndex: 20,
            transition: 'all .25s ease',
            background: 'transparent',
            boxShadow: 'none',
            backdropFilter: 'none',
            WebkitBackdropFilter: 'none',
          }}
        >
          <button
            type="button"
            onClick={() => setShow2DPanel(false)}
            title={isEn ? 'Hide body map' : '收起人體部位圖'}
            aria-label={isEn ? 'Hide body map' : '收起人體部位圖'}
            style={{
              position: 'absolute',
              top: 24,
              right: 24,
              zIndex: 60,

              width: 34,
              height: 34,
              borderRadius: 10,
              border: '1px solid var(--panel-border)',
              background: 'var(--panel-btn-bg)',
              color: 'var(--panel-text)',
              cursor: 'pointer',
              fontWeight: 900,
              fontSize: 16,
              lineHeight: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 6px 14px rgba(15,23,42,0.12)',
              backdropFilter: 'blur(8px)',
            }}
          >
            ×
          </button>

          <Bone2DPanel
            locale={locale}
            onViewChange={(view) => {
              setViewOnly(view);
            }}
            selectedBoneName={
              [
                selectedMeshName ? normalizeMeshName(selectedMeshName) : null,
                boneInfo?.bone_zh,
                boneInfo?.bone_en,
              ]
                .filter(Boolean)
                .join(' ') || null
            }
            onRegionClick={(regionKey) => {
              openNavGroupFrom2D(regionKey);
            }}
            viewControls={
              <div className="s3-view-controls-in-panel">
                {viewButtons.map(([label, title, fn]) => (
                  <button
                    key={label}
                    type="button"
                    onClick={fn}
                    title={title}
                    className="s3-view-control-card"
                  >
                    <span className="s3-view-control-icon">▥</span>
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            }
          />
        </div>


        <Canvas
          key={`s3-canvas-${canvasRevision}`}
          dpr={[1, 1.5]}
          gl={{
            alpha: true,
            antialias: false,
            powerPreference: 'default',
            preserveDrawingBuffer: false,
          }}
          onCreated={({ gl }) => {
            gl.setClearColor(0x000000, 0);

            const canvas = gl.domElement;
            canvas.addEventListener(
              'webglcontextlost',
              (event) => {
                event.preventDefault();
                console.warn('[S3Viewer] WebGL context lost; auto remount disabled.');
              },
              false
            );
          }}
          camera={{ position: [0, 1.5, 6], fov: 45 }}
          style={{ width: '100%', height: '100%' }}
        >
          <ambientLight intensity={0.6} />
          <directionalLight position={[3, 5, 2]} intensity={1.2} />
          <directionalLight position={[-3, 2, -2]} intensity={0.6} />
          <hemisphereLight args={["#e0f2fe", "#1e293b", 0.5]} />

          {selectedBodyPart ? (
            <React.Suspense fallback={null}>
              <group
                key={`model-${selectedBodyPart}`}
                scale={[currentBodyPartScale, currentBodyPartScale, currentBodyPartScale]}
                position={[0, 0, 0]}
              >
                <BoneModel
                  url={BODY_PART_MODEL_URL[selectedBodyPart]}
                  selectedNormSet={selectedNormSet}
                  visibleNormSet={soloNormSet}
                  onSelectMesh={onPickMeshFrom3D}
                  onRegistryReady={(r) => {
                    meshRegistryRef.current = r;
                    setRegistryTick((t) => t + 1);
                  }}
                />
              </group>
            </React.Suspense>
          ) : null}

          <Controls controlsRef={controlsRef} cameraRef={cameraRef} />


          <Environment preset="city" />
        </Canvas>

        {
          !show2DPanel && (
            <button
              type="button"
              onClick={() => setShow2DPanel(true)}
              title={isEn ? 'Show body map' : '顯示人體部位圖'}
              style={{
                position: 'absolute',
                top: 145,
                right: 24,
                zIndex: 80,
                height: 38,
                padding: '0 14px',
                borderRadius: 12,
                border: '1px solid var(--panel-border)',
                background: 'var(--panel-bg)',
                color: 'var(--panel-text)',
                cursor: 'pointer',
                fontWeight: 900,
                fontSize: 13,
                boxShadow: '0 8px 20px rgba(0,0,0,0.14)',
                backdropFilter: 'blur(10px)',
              }}
            >
              {isEn ? 'Show Body Map' : '顯示部位圖'}
            </button>
          )
        }

      </main >
    </div >
  );
}

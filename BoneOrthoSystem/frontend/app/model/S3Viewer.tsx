// frontend/app/model/S3Viewer.tsx
'use client';

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

  while (s.endsWith('.')) s = s.slice(0, -1).trim();

  s = s.replace(/\.LL$/, '.L').replace(/\.RR$/, '.R');

  if (s.length > 1 && (s.endsWith('L') || s.endsWith('R')) && !s.endsWith('.L') && !s.endsWith('.R')) {
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

type BoneInfo = {
  small_bone_id: number;
  bone_id: number;
  bone_zh: string;
  bone_en: string;
  bone_region?: string | null;
  bone_desc?: string | null;
};

type BoneListItem = {
  mesh_name: string;
  small_bone_id: number;
  bone_id: number;
  bone_zh: string;
  bone_en: string;
  bone_region?: string | null;
  bone_desc?: string | null;
};

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
  // skeleton_preview.glb 是低模完整骨架總覽，不使用舊 bones.glb。
  full_skeleton: '/models/body-parts/skeleton_preview.glb?v=1',

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

  // 脊椎總類
  if (hasAny("脊椎", "脊柱", "spine", "vertebra")) {
    add("脊椎", "vertebra", "spine");
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
      if (n) return { zh: `第${n}掌骨`, en: `Metacarpal ${n}` };
    }
  }

  {
    const m = key.match(/^Metatarsal\s?(I{1,3}|IV|V)$/i);
    if (m) {
      const n = romanToInt(m[1]);
      if (n) return { zh: `第${n}蹠骨`, en: `Metatarsal ${n}` };
    }
  }

  {
    const m = key.match(/^Rib(\d{1,2})$/i);
    if (m) {
      const n = Number(m[1]);
      if (!Number.isNaN(n)) return { zh: `第${n}肋骨`, en: `Rib ${n}` };
    }
  }

  if (/^C\d{1,2}$/.test(key)) return { zh: `頸椎 ${key}`, en: `Cervical vertebra ${key}` };
  if (/^T\d{1,2}$/.test(key)) return { zh: `胸椎 ${key}`, en: `Thoracic vertebra ${key}` };
  if (/^L\d{1,2}$/.test(key)) return { zh: `腰椎 ${key}`, en: `Lumbar vertebra ${key}` };

  return { zh: fallbackZh || key, en: fallbackEn || key };
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

  if (!scoreByMesh) return cards;

  return cards.sort((a, b) => {
    const getCardScore = (card: Card) => {
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

    return getCardScore(b) - getCardScore(a);
  });
}

/** =========================
 *  Selection Mode
 *  ========================= */

type SelectedMode =
  | { kind: 'none' }
  | { kind: 'mesh'; meshName: string }
  | { kind: 'series'; series: SeriesKind };

type PanelMode = 'body' | 'bone';

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
  openGroups?: RegionKey[];
  sidebarOpen?: boolean;
};

function isBodyPartKey(value: unknown): value is BodyPartKey {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(BODY_PART_MODEL_URL, value);
}

function isPanelMode(value: unknown): value is PanelMode {
  return value === 'body' || value === 'bone';
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
      out.openGroups = parsed.openGroups.filter(isRegionKey);
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

  const router = useRouter();
  const [isNavigating, setIsNavigating] = useState(false);
  const [navigatingText, setNavigatingText] = useState("");

  const searchParams = useSearchParams();
  const targetBone = searchParams.get("bone") || "";
  const targetMesh = searchParams.get("mesh") || "";
  const targetBoneId = searchParams.get("boneId");

  const [selectedMode, setSelectedMode] = useState<SelectedMode>(() => readStoredS3ViewerState().selectedMode ?? { kind: 'none' });
  const [selectedBodyPart, setSelectedBodyPart] = useState<BodyPartKey | null>(() => readStoredS3ViewerState().selectedBodyPart ?? 'right_wrist');
  const currentBodyPartScale = selectedBodyPart ? BODY_PART_VIEW_SCALE[selectedBodyPart] : 1.2;

  const selectedMeshName = selectedMode.kind === 'mesh' ? selectedMode.meshName : null;
  const selectedSeries = selectedMode.kind === 'series' ? selectedMode.series : null;

  const [boneInfo, setBoneInfo] = useState<BoneInfo | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(false);

  const [boneList, setBoneList] = useState<BoneListItem[]>([]);
  const [q, setQ] = useState(() => readStoredS3ViewerState().q ?? '');
  const [panelMode, setPanelMode] = useState<PanelMode>(() => readStoredS3ViewerState().panelMode ?? 'body');

  const [openGroups, setOpenGroups] = useState<RegionKey[]>(() => readStoredS3ViewerState().openGroups ?? []);
  const openSet = useMemo(() => new Set(openGroups), [openGroups]);

  const meshRegistryRef = useRef<Record<string, THREE.Mesh>>({});
  const controlsRef = useRef<any>(null);
  const cameraRef = useRef<THREE.Camera | null>(null);
  const [registryTick, setRegistryTick] = useState(0);

  //抽屜式
  const [sidebarOpen, setSidebarOpen] = useState(() => readStoredS3ViewerState().sidebarOpen ?? true);
  const SIDEBAR_WIDTH = 360;
  const SIDEBAR_PEEK = 0; // 收合時完全藏起來

  // Solo / Isolate 模式：null = 顯示目前部位包全部 mesh；Set = 只顯示指定 mesh。
  const [soloNormSet, setSoloNormSet] = useState<Set<string> | null>(null);
  const soloActive = soloNormSet != null;

  const shouldRenderBoneModel =
    ENABLE_BONE_GLB &&
    (soloNormSet === null || (soloNormSet instanceof Set && soloNormSet.size > 0));

  const [showHint, setShowHint] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [canvasRevision, setCanvasRevision] = useState(0);

  useEffect(() => {
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
  }, [selectedBodyPart, selectedMode, panelMode, q, openGroups, sidebarOpen]);

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

  useEffect(() => {
    const timer = setTimeout(() => setShowHint(false), 3500);
    return () => clearTimeout(timer);
  }, []);

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
      if (selectedMeshName) focusOnMesh(selectedMeshName);
      else focusOnLoadedModel();
    });
  }, [selectedBodyPart, registryTick, selectedMeshName, focusOnMesh, focusOnLoadedModel]);

  const resetView = useCallback(() => {
    const controls = controlsRef.current;
    const camera = cameraRef.current as THREE.PerspectiveCamera | null;
    if (!controls || !camera) return;

    camera.position.set(0, 1.5, 6);
    controls.target.set(0, 0, 0);
    controls.update();
  }, []);

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

  const setFrontView = useCallback(() => setView([0, 0, 6]), [setView]);
  const setBackView = useCallback(() => setView([0, 0, -6]), [setView]);
  const setLeftView = useCallback(() => setView([-6, 0, 0]), [setView]);
  const setRightView = useCallback(() => setView([6, 0, 0]), [setView]);
  const setTopView = useCallback(() => setView([0, 6, 0.001]), [setView]);
  const viewButtons: [string, () => void][] = [
    ['重置', resetView],
    ['上', setTopView],
    ['正', setFrontView],
    ['背', setBackView],
    ['右', setRightView],
    ['左', setLeftView],
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
    const { boneName, boneZh, boneEn, meshName, imageGalleryBone } = getCardPayload(card);
    if (!boneName) return null;

    const llmQuery = new URLSearchParams({
      bone: boneName,
      bone_zh: boneZh,
      bone_en: boneEn,
      mesh: meshName,
    });

    return (
      <div className="mt-2 flex flex-wrap gap-2">


        <button
          type="button"
          onClick={() => {
            navigateWithBoneLoading(
              `/llm?${llmQuery.toString()}`,
              `正在開啟 GalaBone RAG：${boneName}`
            );
          }}
          className="rounded-lg px-3 py-1 text-xs font-semibold"
          style={{
            backgroundColor: "rgba(56,189,248,0.14)",
            color: "#0369a1",
          }}
        >
          🤖 問 GalaBone RAG
        </button>

        {imageGalleryBone && (
          <button
            type="button"
            onClick={() => {
              navigateWithBoneLoading(
                `/bonevision?openGallery=1&bone=${encodeURIComponent(imageGalleryBone)}`,
                `正在開啟影像學習庫：${imageGalleryBone}`
              );
            }}
            className="rounded-lg px-3 py-1 text-xs font-semibold"
            style={{
              backgroundColor: "rgba(34,197,94,0.14)",
              color: "#15803d",
            }}
          >
            🩻 看影像
          </button>
        )}
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

  const availableGroups = useMemo(() => {
    return (Object.keys(regionCards) as RegionKey[]).filter((rk) => regionCards[rk].length > 0);
  }, [regionCards]);

  const allOpen = useMemo(() => {
    if (!availableGroups.length) return false;
    return availableGroups.every((rk) => openSet.has(rk));
  }, [availableGroups, openSet]);

  const toggleAllGroups = useCallback(() => {
    setOpenGroups((prev) => {
      const prevSet = new Set(prev);
      const nextAllOpen = availableGroups.length > 0 && availableGroups.every((rk) => prevSet.has(rk));
      if (nextAllOpen) return [];
      return [...availableGroups];
    });
  }, [availableGroups]);

  const toggleGroup = useCallback((rk: RegionKey) => {
    setOpenGroups((prev) => (prev.includes(rk) ? prev.filter((x) => x !== rk) : [...prev, rk]));
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
      setOpenGroups((prev) => (prev.includes('spine') ? prev : [...prev, 'spine']));
      setBoneInfo(null);
      setLoadingInfo(false);
      setSelectedMode({ kind: 'series', series });
      setSelectedBodyPart('spine');
      meshRegistryRef.current = {};
      setRegistryTick((t) => t + 1);
      setSoloNormSet(new Set(seriesNorms[series]));

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
    async (meshName: string) => {
      setSelectedMode({ kind: 'mesh', meshName });
      setLoadingInfo(true);

      // ✅ Solo 開著時，換選別顆就自動只顯示新那顆
      const normSel = normalizeMeshName(meshName);
      setSoloNormSet((prev) => (prev ? new Set([normSel]) : null));

      const li = findListItemByMeshName(meshName);
      const guessedPart = getBodyPartForMeshName(meshName, li?.bone_region);

      if (guessedPart && guessedPart !== selectedBodyPart) {
        setSelectedBodyPart(guessedPart);
        meshRegistryRef.current = {};
        setRegistryTick((t) => t + 1);
      }

      if (li) {
        setBoneInfo({
          small_bone_id: Number(li.small_bone_id),
          bone_id: Number(li.bone_id),
          bone_zh: li.bone_zh,
          bone_en: li.bone_en,
          bone_region: li.bone_region ?? null,
          bone_desc: li.bone_desc ?? null,
        });

        const rk = toRegionKey(li.bone_region);
        setOpenGroups((prev) => (prev.includes(rk) ? prev : [...prev, rk]));

        const norm = normalizeMeshName(li.mesh_name);
        const s = meshToSeries(norm);
        const cardId = rk === 'spine' && s ? `card-spine-${s}` : `card-${rk}-${encodeURIComponent(parseSide(norm).base)}`;

        requestAnimationFrame(() => {
          const el = document.getElementById(cardId);
          if (!isMobile) {
            el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
          }
        });
      } else {
        setBoneInfo(null);
      }

      requestAnimationFrame(() => focusOnMesh(meshName));
      setLoadingInfo(false);
    },
    [findListItemByMeshName, focusOnMesh, selectedBodyPart]
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

    setOpenGroups((prev) => (prev.includes(rk) ? prev : [...prev, rk]));

    setBoneInfo({
      small_bone_id: Number(first.small_bone_id),
      bone_id: Number(first.bone_id),
      bone_zh: first.bone_zh,
      bone_en: first.bone_en,
      bone_region: first.bone_region ?? null,
      bone_desc: first.bone_desc ?? null,
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
    top: 14,
    left: 14,
    zIndex: 30,
    width: SIDEBAR_WIDTH,
    height: 'calc(100% - 28px)',
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
              正在開啟學習場景
            </div>

            <div className="mt-1 text-xs text-slate-500">
              {navigatingText}
            </div>
          </div>
        </div>
      )}




      {/* 左側清單 */}
      <aside className={`s3-bone-sidebar ${sidebarOpen ? 'is-open' : 'is-closed'}`} style={sAside}>
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
            {panelMode === 'body' ? '人體部位' : '骨頭清單'}
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {panelMode === 'bone' ? (
              <button style={sTopToggleBtn} onClick={toggleAllGroups}>
                {allOpen ? '一鍵收起' : '一鍵展開'}
              </button>
            ) : null}

            <button
              onClick={() => setSidebarOpen(false)}
              title="收合面板"
              style={sIconBtn}
            >
              ×
            </button>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            gap: 8,
            padding: 4,
            borderRadius: 14,
            background: 'var(--panel-btn-bg)',
            border: '1px solid var(--panel-border)',
            marginBottom: 12,
          }}
        >
          <button type="button" style={sTabBtn(panelMode === 'body')} onClick={() => setPanelMode('body')}>
            人體部位
          </button>
          <button type="button" style={sTabBtn(panelMode === 'bone')} onClick={() => setPanelMode('bone')}>
            骨頭清單
          </button>
        </div>

        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={panelMode === 'body' ? '搜尋：手腕、脊椎、胸廓、足部…' : '搜尋：尺骨、C3、脖子第三根、手腕小骨頭…'}
          style={{
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

        {panelMode === 'body' ? (
          <div style={{ marginBottom: 14 }}>
            <div
              style={{
                fontWeight: 900,
                fontSize: 14,
                marginBottom: 8,
                opacity: 0.9,
              }}
            >
              人體部位
            </div>

            <div style={{ display: 'grid', gap: 8 }}>
              {BODY_PART_BUTTONS.map((part) => (
                <button
                  key={part}
                  type="button"
                  onClick={() => selectBodyPart(part)}
                  style={sGroupBtn(selectedBodyPart === part)}
                >
                  <span>{BODY_PART_LABEL[part].zh}</span>
                  <span style={{ opacity: 0.65, fontSize: 12 }}>{BODY_PART_LABEL[part].en}</span>
                </button>
              ))}
            </div>

            <div
              style={{
                marginTop: 12,
                padding: '10px 12px',
                borderRadius: 12,
                border: '1px solid var(--panel-border)',
                background: 'var(--card-bg)',
                fontSize: 12,
                lineHeight: 1.6,
                opacity: 0.82,
              }}
            >
              先選人體部位載入對應 GLB；要找單一骨頭時，切到「骨頭清單」搜尋。
            </div>
          </div>
        ) : null}

        {panelMode === 'bone' ? (Object.keys(regionCards) as RegionKey[]).map((rk) => {
          const cards = regionCards[rk];
          if (!cards.length) return null;

          const isOpen = openSet.has(rk);

          return (
            <div key={rk} style={{ marginBottom: 10 }}>

              <button onClick={() => toggleGroup(rk)} style={sGroupBtn(isOpen)}>
                <span>{REGION_LABEL[rk]}</span>
                <span style={{ opacity: 0.75, fontSize: 12 }}>{cards.length}</span>
              </button>

              {isOpen && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
                  {cards.map((card) => {
                    const active = isActiveCard(card);
                    const cardId =
                      card.kind === 'series'
                        ? `card-spine-${card.series}`
                        : `card-${card.regionKey}-${encodeURIComponent(card.base)}`;

                    return (
                      <div id={cardId} key={cardId} style={sCard(active)}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                          <div>
                            <div style={{ fontWeight: 900, fontSize: 15 }}>{card.displayZh}</div>
                            <div style={{ fontSize: 12, opacity: 0.82 }}>{card.displayEn}</div>
                          </div>

                          {card.kind === 'series' ? (
                            <button style={sWholeBtn} onClick={() => selectSeries(card.series)} title="選取整組（全部亮）">
                              整組
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
                                onClick={() => selectByMeshName(card.L!.mesh_name)}
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
                                onClick={() => selectByMeshName(card.R!.mesh_name)}
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
                                onClick={() => selectByMeshName(card.C!.mesh_name)}
                                title={card.C.mesh_name}
                              >
                                選取
                              </button>
                            ) : null}

                            {((!!card.L && !card.R) || (!card.L && !!card.R)) && !card.C ? (
                              <button
                                style={sVariantBtn(
                                  !!selectedMeshName &&
                                  normalizeMeshName((card.L ?? card.R)!.mesh_name) === normalizeMeshName(selectedMeshName)
                                )}
                                onClick={() => selectByMeshName((card.L ?? card.R)!.mesh_name)}
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
                                  onClick={() => selectByMeshName(it.mesh_name)}
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
                            點「整組」會讓 {card.displayZh} ({card.order.join(', ')}) 全部一起亮；再點單顆會顯示該節資訊。
                          </div>
                        )}

                        {/* Info */}
                        {active && selectedMeshName && (
                          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--panel-border)' }}>
                            {/* ✅ Solo/Unsolo 按鈕 */}
                            <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                              {!soloActive ? (
                                <button
                                  style={sWholeBtn}
                                  onClick={() => setSoloNormSet(new Set([normalizeMeshName(selectedMeshName)]))}
                                  title="只顯示目前選取的這顆骨頭"
                                >
                                  只顯示此骨頭
                                </button>
                              ) : (
                                <button
                                  style={sWholeBtn}
                                  onClick={() => setSoloNormSet(null)}
                                  title="顯示目前部位包的全部骨頭"
                                >
                                  顯示全部
                                </button>
                              )}
                            </div>

                            {loadingInfo ? (
                              <div style={{ opacity: 0.7, fontSize: 13 }}>載入中…</div>
                            ) : !boneInfo ? (
                              <div style={{ opacity: 0.7, fontSize: 13 }}>尚未載入資訊</div>
                            ) : (
                              <div style={{ fontSize: 13, lineHeight: 1.55 }}>
                                <div style={{ fontWeight: 900 }}>
                                  {boneInfo.bone_zh} / {boneInfo.bone_en}
                                </div>
                                <div style={{ opacity: 0.85 }}>{boneInfo.bone_region ?? ''}</div>
                                {boneInfo.bone_desc ? (
                                  <div style={{ opacity: 0.9, marginTop: 8, whiteSpace: 'pre-wrap' }}>
                                    {boneInfo.bone_desc}
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
        }) : null}
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
          ☰ 選單
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
      ><div
        className="s3-view-toolbar"
        style={{
          position: 'absolute',
          top: 18,
          right: 18,
          zIndex: 20,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: 8,
        }}
      >
          {/* 視角工具列 */}
          <div
            className="s3-view-buttons"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 62px)',
              gap: 10,
              padding: 0,
              borderRadius: 0,
              background: 'transparent',
              border: 'none',
              boxShadow: 'none',
              backdropFilter: 'none',
            }}
          >
            {viewButtons.map(([label, fn]) => (
              <button
                key={label}
                onClick={fn}
                title={`${label}視角`}
                style={{
                  height: 42,
                  borderRadius: 10,
                  background: 'var(--panel-btn-bg)',
                  border: '1px solid var(--panel-border)',
                  color: 'var(--panel-text)',
                  backdropFilter: 'blur(8px)',
                  cursor: 'pointer',
                  fontWeight: 700,
                  fontSize: 13,
                  boxShadow: '0 6px 16px rgba(0,0,0,0.14)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--panel-btn-open-bg)';
                  e.currentTarget.style.transform = 'translateY(-1px)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'var(--panel-btn-bg)';
                  e.currentTarget.style.transform = 'translateY(0)';
                }}>
                {label}
              </button>
            ))}
          </div>

          {/* 操作提示 */}
          {showHint && (
            <div
              className="s3-control-hint"
              style={{
                marginTop: 2,
                padding: '7px 10px',
                borderRadius: 12,
                background: 'var(--glass-bg)',
                border: '1px solid var(--panel-border)',
                color: 'var(--panel-text)',
                fontSize: 11,
                lineHeight: 1.4,
                boxShadow: '0 6px 16px rgba(0,0,0,0.12)',
                backdropFilter: 'blur(8px)',
                pointerEvents: 'none',
                opacity: 0.9,
              }}
            >
              <i className="fa-solid fa-computer-mouse" style={{ marginRight: 6, opacity: 0.7 }} />
              拖曳旋轉 · 右鍵平移 · 滾輪縮放
            </div>
          )}

        </div>

        {/* 右側 2D 正反面骨骼對應圖 */}
        <div
          className="s3-2d-panel"
          style={{
            position: 'absolute',
            top: 174,
            right: 18,
            zIndex: 18,
            width: 280,
            maxHeight: 'calc(100% - 198px)',
            pointerEvents: 'auto',
          }}
        >
          <Bone2DPanel
            selectedBoneName={
              [
                selectedMeshName,
                boneInfo?.bone_zh,
                boneInfo?.bone_en,
                boneInfo?.bone_region,
                boneInfo?.bone_desc,
              ]
                .filter(Boolean)
                .join(' ') || null
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

          {!isMobile && (
            <GizmoHelper alignment="bottom-right" margin={[110, 110]}>
              <GizmoViewport
                axisColors={['#f87171', '#4ade80', '#60a5fa']}
                labelColor="#e5e7eb"
              />
            </GizmoHelper>
          )}

          <Environment preset="city" />
        </Canvas>
      </main>
    </div>
  );
}

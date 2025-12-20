'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Environment, OrbitControls, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { EffectComposer, Outline } from '@react-three/postprocessing';

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:8000';

/** =========================
 *  Utils
 *  ========================= */

function normalizeMeshName(meshName: string) {
  let s = (meshName || '').replace(/_/g, ' ').trim();
  if (s.length > 1 && (s.endsWith('L') || s.endsWith('R')) && !s.includes('.L') && !s.includes('.R')) {
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
  if (r.includes('cranial') || r.includes('facial') || r.includes('skull') || r.includes('頭顱')) return 'skull';
  if (r.includes('spine') || r.includes('vertebra') || r.includes('脊椎')) return 'spine';
  if (r.includes('thorax') || r.includes('rib') || r.includes('stern') || r.includes('胸') || r.includes('肋'))
    return 'thorax';
  if (
    r.includes('upper') ||
    r.includes('arm') ||
    r.includes('humer') ||
    r.includes('ulna') ||
    r.includes('radius') ||
    r.includes('上肢') ||
    r.includes('手')
  )
    return 'upper';
  if (
    r.includes('lower') ||
    r.includes('leg') ||
    r.includes('femor') ||
    r.includes('tibia') ||
    r.includes('fibula') ||
    r.includes('下肢') ||
    r.includes('足')
  )
    return 'lower';
  if (r.includes('pelvis') || r.includes('hip') || r.includes('骨盆')) return 'pelvis';
  return 'other';
}

/** =========================
 *  Side / Base parsing
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
 *  Pretty labels (指骨/趾骨/掌骨/蹠骨/肋骨/脊椎)
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

function prettyForBase(base: string, fallbackZh: string, fallbackEn: string): { zh: string; en: string; tag?: string } {
  // 手指：Index_Middle, Thumb_Proximal...
  {
    const m = base.match(/^(Thumb|Index|Middle|Ring|Little)_(Proximal|Middle|Distal)$/);
    if (m) {
      const digit = m[1];
      const seg = m[2];
      const digitZh = HAND_DIGIT_ZH[digit] ?? digit;
      const segZh = SEG_ZH[seg] ?? seg;
      return { zh: `${digitZh}${segZh}指骨`, en: `${seg} phalanx (${digit})`, tag: `${digitZh} · ${segZh}` };
    }
  }

  // 腳趾：Hallux_Distal, Second_Middle...
  {
    const m = base.match(/^(Hallux|Second|Third|Fourth|Fifth|fifth)_(Proximal|Middle|Distal)$/);
    if (m) {
      const digit = m[1];
      const seg = m[2];
      const digitZh = FOOT_DIGIT_ZH[digit] ?? digit;
      const segZh = SEG_ZH[seg] ?? seg;
      return { zh: `${digitZh}${segZh}趾骨`, en: `${seg} phalanx (${digit})`, tag: `${digitZh} · ${segZh}` };
    }
  }

  // 掌骨：MetacarpalI~V
  {
    const m = base.match(/^Metacarpal(I{1,3}|IV|V)$/i);
    if (m) {
      const n = romanToInt(m[1]);
      if (n) return { zh: `第${n}掌骨`, en: `Metacarpal ${n}` };
    }
  }

  // 蹠骨：MetatarsalI~V
  {
    const m = base.match(/^Metatarsal(I{1,3}|IV|V)$/i);
    if (m) {
      const n = romanToInt(m[1]);
      if (n) return { zh: `第${n}蹠骨`, en: `Metatarsal ${n}` };
    }
  }

  // 肋骨：Rib1~Rib12
  {
    const m = base.match(/^Rib(\d{1,2})$/i);
    if (m) {
      const n = Number(m[1]);
      if (!Number.isNaN(n)) return { zh: `第${n}肋骨`, en: `Rib ${n}` };
    }
  }

  // 椎骨：C/T/L（單顆 fallback）
  if (/^C\d{1,2}$/.test(base)) return { zh: `頸椎 ${base}`, en: `Cervical vertebra ${base}` };
  if (/^T\d{1,2}$/.test(base)) return { zh: `胸椎 ${base}`, en: `Thoracic vertebra ${base}` };
  if (/^L\d{1,2}$/.test(base)) return { zh: `腰椎 ${base}`, en: `Lumbar vertebra ${base}` };

  return { zh: fallbackZh || base, en: fallbackEn || base };
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
      <lineBasicMaterial color={0xff8a00} />
    </lineSegments>
  );
}

/** =========================
 *  3D Model
 *  ========================= */

type BoneModelProps = {
  url: string;
  selectedNormSet: Set<string>; // ✅ 支援「多選」(例如整組頸椎)
  onSelectMesh?: (meshName: string) => void;
  onRegistryReady?: (registry: Record<string, THREE.Mesh>) => void;
};

function BoneModel({ url, selectedNormSet, onSelectMesh, onRegistryReady }: BoneModelProps) {
  const { scene } = useGLTF(url) as any;
  const [hovered, setHovered] = useState<string | null>(null);

  // normalizedName -> actual mesh instance in scene
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

        const pos = v3(mesh.position);
        const rot = e3(mesh.rotation);
        const scl = v3(mesh.scale);

        return (
          <group key={rawName}>
            <mesh
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
                color={(mesh.material as any)?.color || undefined}
                emissive={isHovered ? new THREE.Color(0.2, 0.2, 0.2) : new THREE.Color(0, 0, 0)}
              />
            </mesh>

            {/* ✅ 多選也會畫線 */}
            {isSelected && <SelectedEdges geometry={mesh.geometry} position={pos} rotation={rot} scale={scl} />}
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
  if (series === 'cervical') return { zh: '頸椎', en: 'Cervical vertebrae', order: ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'] };
  if (series === 'thoracic') return { zh: '胸椎', en: 'Thoracic vertebrae', order: ['T1','T2','T3','T4','T5','T6','T7','T8','T9','T10','T11','T12'] };
  return { zh: '腰椎', en: 'Lumbar vertebrae', order: ['L1','L2','L3','L4','L5'] };
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
  items: Record<string, BoneListItem>; // key = "C1"
};

type Card = LRCard | SeriesCard;

function buildCardsForRegion(items: BoneListItem[], regionKey: RegionKey): Card[] {
  // spine => series cards
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

    (['cervical','thoracic','lumbar'] as SeriesKind[]).forEach((sk) => {
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

  // LR group
  const m = new Map<string, LRCard>();

  for (const it of rest) {
    const { base, side } = parseSide(it.mesh_name);
    const key = base;

    if (!m.has(key)) {
      const pretty = prettyForBase(base, it.bone_zh, it.bone_en);
      m.set(key, {
        kind: 'lr',
        regionKey,
        base,
        displayZh: pretty.zh,
        displayEn: pretty.en,
        tag: pretty.tag,
      });
    }

    const g = m.get(key)!;
    if (side === 'L') g.L = it;
    else if (side === 'R') g.R = it;
    else g.C = it;
  }

  const lrCards = Array.from(m.values()).sort((a, b) => a.displayZh.localeCompare(b.displayZh, 'zh-Hant'));
  return regionKey === 'spine' ? [...seriesCards, ...lrCards] : lrCards;
}

/** =========================
 *  Selection Mode
 *  ========================= */

type SelectedMode =
  | { kind: 'none' }
  | { kind: 'mesh'; meshName: string }
  | { kind: 'series'; series: SeriesKind };

export default function S3Viewer() {
  const [selectedMode, setSelectedMode] = useState<SelectedMode>({ kind: 'none' });

  const selectedMeshName = selectedMode.kind === 'mesh' ? selectedMode.meshName : null;
  const selectedSeries = selectedMode.kind === 'series' ? selectedMode.series : null;

  const [boneInfo, setBoneInfo] = useState<BoneInfo | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(false);

  const [boneList, setBoneList] = useState<BoneListItem[]>([]);
  const [q, setQ] = useState('');
  const [openGroup, setOpenGroup] = useState<RegionKey | null>('skull');

  // 3D registry / focus
  const meshRegistryRef = useRef<Record<string, THREE.Mesh>>({});
  const controlsRef = useRef<any>(null);
  const cameraRef = useRef<THREE.Camera | null>(null);
  const [registryTick, setRegistryTick] = useState(0);

  // fetch bone list
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/s3/bone-list`);
        if (!res.ok) throw new Error(await res.text());
        const data = (await res.json()) as BoneListItem[];
        setBoneList(data);
      } catch (e) {
        console.error('bone-list fetch failed:', e);
      }
    })();
  }, []);

  // focus on SINGLE mesh
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

  // focus on MULTI meshes (整組頸椎/胸椎/腰椎)
  const focusOnNormList = useCallback((norms: string[]) => {
    const controls = controlsRef.current;
    const camera = cameraRef.current as any;
    if (!controls || !camera) return;

    const meshes = norms
      .map((n) => meshRegistryRef.current[n])
      .filter(Boolean) as THREE.Mesh[];

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

  const findListItemByMeshName = useCallback(
    (meshName: string) => {
      const n = normalizeMeshName(meshName);
      return boneList.find((x) => normalizeMeshName(x.mesh_name) === n) ?? null;
    },
    [boneList]
  );

  // Search filter
  const searched = useMemo(() => {
    const kw = q.trim().toLowerCase();
    if (!kw) return boneList;
    return boneList.filter((x) => {
      const key = `${x.bone_zh} ${x.bone_en} ${x.mesh_name} ${x.bone_region ?? ''}`.toLowerCase();
      return key.includes(kw);
    });
  }, [boneList, q]);

  // Region -> cards
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
      result[rk] = buildCardsForRegion(byRegion[rk], rk);
    });

    return result;
  }, [searched]);

  // ✅ 取得某系列 (C/T/L) 的所有 norm key
  const seriesNorms = useMemo(() => {
    const out: Record<SeriesKind, string[]> = { cervical: [], thoracic: [], lumbar: [] };

    for (const it of boneList) {
      const norm = normalizeMeshName(it.mesh_name);
      const s = meshToSeries(norm);
      if (s) out[s].push(norm);
    }

    // 依順序排序
    (['cervical','thoracic','lumbar'] as SeriesKind[]).forEach((sk) => {
      const meta = seriesMeta(sk);
      const set = new Set(out[sk]);
      out[sk] = meta.order.filter((k) => set.has(k));
    });

    return out;
  }, [boneList]);

  // ✅ 目前要亮的 mesh (多選)
  const selectedNormSet = useMemo(() => {
    if (selectedMode.kind === 'mesh') return new Set([normalizeMeshName(selectedMode.meshName)]);
    if (selectedMode.kind === 'series') return new Set(seriesNorms[selectedMode.series]);
    return new Set<string>();
  }, [selectedMode, seriesNorms]);

  // ✅ Outline selection objects（支援多選）
  const outlineSelection = useMemo(() => {
    // 依 registryTick 重新取一次
    void registryTick;
    const objs: THREE.Object3D[] = [];
    selectedNormSet.forEach((norm) => {
      const m = meshRegistryRef.current[norm];
      if (m) objs.push(m);
    });
    return objs;
  }, [selectedNormSet, registryTick]);

  // ✅ 點「整組頸椎/胸椎/腰椎」：全部亮、鏡頭聚焦整組、左側保持在脊椎群組
  const selectSeries = useCallback(
    (series: SeriesKind) => {
      setOpenGroup('spine');
      setBoneInfo(null);
      setLoadingInfo(false);
      setSelectedMode({ kind: 'series', series });

      // scroll 到這張總卡
      requestAnimationFrame(() => {
        const el = document.getElementById(`card-spine-${series}`);
        el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });

      // focus 整組
      requestAnimationFrame(() => focusOnNormList(seriesNorms[series]));
    },
    [focusOnNormList, seriesNorms]
  );

  // ✅ 點「單顆」：只亮該顆 + 拉資料 + 聚焦
  const selectByMeshName = useCallback(
    async (meshName: string) => {
      setSelectedMode({ kind: 'mesh', meshName });
      setLoadingInfo(true);
      setBoneInfo(null);

      // 打開正確群組 + scroll
      const li = findListItemByMeshName(meshName);
      if (li) {
        const rk = toRegionKey(li.bone_region);
        setOpenGroup(rk);

        const norm = normalizeMeshName(li.mesh_name);
        const s = meshToSeries(norm);
        const cardId = rk === 'spine' && s ? `card-spine-${s}` : `card-${rk}-${encodeURIComponent(parseSide(norm).base)}`;

        requestAnimationFrame(() => {
          const el = document.getElementById(cardId);
          el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        });
      }

      try {
        // 1) MeshName -> SmallBoneId
        const meshRes = await fetch(`${API_BASE}/s3/mesh-map/${encodeURIComponent(meshName)}`);
        if (!meshRes.ok) {
          console.error('mesh-map error:', await meshRes.text());
          return;
        }
        const meshJson = await meshRes.json();
        const smallBoneId = meshJson.small_bone_id ?? meshJson.smallBoneId ?? meshJson.SmallBoneId;

        // 2) SmallBoneId -> BoneInfo
        const boneRes = await fetch(`${API_BASE}/s3/bones/${smallBoneId}`);
        if (!boneRes.ok) {
          console.error('bones error:', await boneRes.text());
          return;
        }
        const info = (await boneRes.json()) as BoneInfo;
        setBoneInfo(info);

        // 3) focus
        requestAnimationFrame(() => focusOnMesh(meshName));
      } catch (err) {
        console.error('selectByMeshName failed:', err);
      } finally {
        setLoadingInfo(false);
      }
    },
    [findListItemByMeshName, focusOnMesh]
  );

  // ✅ 點 3D mesh：必須同步左側（如果是 C/T/L，會自動把脊椎總卡變 active）
  const onPickMeshFrom3D = useCallback(
    (meshName: string) => {
      selectByMeshName(meshName);
    },
    [selectByMeshName]
  );

  function isActiveCard(card: Card) {
    if (card.kind === 'series') {
      // 系列卡 active：當前是 series 模式 或 目前單顆選到這個系列內
      if (selectedSeries === card.series) return true;
      if (selectedMeshName) {
        const norm = normalizeMeshName(selectedMeshName);
        return meshToSeries(norm) === card.series;
      }
      return false;
    }

    // lr card active：任何 L/R/C 命中
    if (!selectedMeshName) return false;
    const sel = normalizeMeshName(selectedMeshName);
    const vars = [card.L?.mesh_name, card.R?.mesh_name, card.C?.mesh_name].filter(Boolean) as string[];
    return vars.some((m) => normalizeMeshName(m) === sel);
  }

  /** =========================
   *  Styles
   *  ========================= */
  const sAside: React.CSSProperties = {
    width: 360,
    background: '#0f0f0f',
    color: '#fff',
    borderRight: '1px solid #222',
    padding: 12,
    overflow: 'auto',
  };

  const sGroupBtn = (open: boolean): React.CSSProperties => ({
    width: '100%',
    textAlign: 'left',
    padding: '10px 12px',
    borderRadius: 12,
    border: '1px solid #2a2a2a',
    background: open ? '#1b1b1b' : '#141414',
    color: '#fff',
    cursor: 'pointer',
    fontWeight: 900,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  });

  const sCard = (active: boolean): React.CSSProperties => ({
    textAlign: 'left',
    padding: 12,
    borderRadius: 14,
    background: '#141414',
    border: active ? '2px solid #ff8a00' : '1px solid #2a2a2a',
    boxShadow: active ? '0 0 0 2px rgba(255,138,0,0.12)' : 'none',
  });

  const sMini: React.CSSProperties = { fontSize: 11, opacity: 0.6, marginTop: 6, lineHeight: 1.35 };

  const sVariantBtn = (active: boolean): React.CSSProperties => ({
    height: 34,
    padding: '0 12px',
    borderRadius: 10,
    border: active ? '2px solid #ff8a00' : '1px solid #2a2a2a',
    background: '#0f0f0f',
    color: '#fff',
    cursor: 'pointer',
    fontWeight: 900,
  });

  const sVariantBtnDisabled: React.CSSProperties = {
    height: 34,
    padding: '0 12px',
    borderRadius: 10,
    border: '1px solid #2a2a2a',
    background: '#0f0f0f',
    color: 'rgba(255,255,255,0.35)',
    cursor: 'not-allowed',
    fontWeight: 900,
  };

  // ✅ 系列卡「整組選取」按鈕（你要點頸椎就全亮，這個按鈕就是那件事）
  const sWholeBtn: React.CSSProperties = {
    height: 32,
    padding: '0 10px',
    borderRadius: 10,
    border: '1px solid #2a2a2a',
    background: '#0f0f0f',
    color: '#fff',
    cursor: 'pointer',
    fontWeight: 900,
    opacity: 0.95,
  };

  return (
    <div style={{ display: 'flex', width: '100%', height: 'calc(100vh - 64px)' }}>
      {/* 左側清單 */}
      <aside style={sAside}>
        <div style={{ fontWeight: 900, fontSize: 16, marginBottom: 10 }}>骨頭清單</div>

        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜尋：C1 / Rib10 / Metatarsal / Middle…"
          style={{
            width: '100%',
            padding: '10px 12px',
            borderRadius: 10,
            border: '1px solid #333',
            background: '#151515',
            color: '#fff',
            marginBottom: 12,
            outline: 'none',
          }}
        />

        {(Object.keys(regionCards) as RegionKey[]).map((rk) => {
          const cards = regionCards[rk];
          if (!cards.length) return null;

          const isOpen = openGroup === rk;

          return (
            <div key={rk} style={{ marginBottom: 10 }}>
              <button onClick={() => setOpenGroup((prev) => (prev === rk ? null : rk))} style={sGroupBtn(isOpen)}>
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
                        {/* Header */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                          <div>
                            <div style={{ fontWeight: 900, fontSize: 15 }}>{card.displayZh}</div>
                            <div style={{ fontSize: 12, opacity: 0.82 }}>{card.displayEn}</div>
                          </div>

                          {/* ✅ 重點：點「頸椎」→ 全部亮（這就是你要的） */}
                          {card.kind === 'series' ? (
                            <button style={sWholeBtn} onClick={() => selectSeries(card.series)} title="選取整組（全部亮）">
                              整組
                            </button>
                          ) : null}
                        </div>

                        {'tag' in card && card.tag ? (
                          <div style={{ fontSize: 12, opacity: 0.78, marginTop: 6 }}>{card.tag}</div>
                        ) : null}

                        {/* Buttons */}
                        {card.kind === 'lr' ? (
                          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                            {card.L ? (
                              <button
                                style={sVariantBtn(
                                  !!selectedMeshName &&
                                    normalizeMeshName(card.L.mesh_name) === normalizeMeshName(selectedMeshName)
                                )}
                                onClick={() => selectByMeshName(card.L!.mesh_name)}
                                title={card.L.mesh_name}
                              >
                                L
                              </button>
                            ) : (
                              <button style={sVariantBtnDisabled} disabled>
                                L
                              </button>
                            )}

                            {card.R ? (
                              <button
                                style={sVariantBtn(
                                  !!selectedMeshName &&
                                    normalizeMeshName(card.R.mesh_name) === normalizeMeshName(selectedMeshName)
                                )}
                                onClick={() => selectByMeshName(card.R!.mesh_name)}
                                title={card.R.mesh_name}
                              >
                                R
                              </button>
                            ) : (
                              <button style={sVariantBtnDisabled} disabled>
                                R
                              </button>
                            )}

                            {!card.L && !card.R && card.C ? (
                              <button
                                style={sVariantBtn(
                                  !!selectedMeshName &&
                                    normalizeMeshName(card.C.mesh_name) === normalizeMeshName(selectedMeshName)
                                )}
                                onClick={() => selectByMeshName(card.C!.mesh_name)}
                                title={card.C.mesh_name}
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

                        {/* Mini line */}
                        {card.kind === 'lr' ? (
                          <div style={sMini}>
                            {card.L ? `L: ${normalizeMeshName(card.L.mesh_name)}` : 'L: -'}{' '}
                            {card.R ? `｜ R: ${normalizeMeshName(card.R.mesh_name)}` : '｜ R: -'}
                            {card.C ? `｜ C: ${normalizeMeshName(card.C.mesh_name)}` : ''}
                          </div>
                        ) : (
                          <div style={sMini}>
                            點「整組」會讓 {card.displayZh} ({card.order.join(', ')}) 全部一起亮；再點單顆會顯示該節資訊。
                          </div>
                        )}

                        {/* Info: 只有在「單顆選取」且這張卡是 active 才顯示 */}
                        {active && selectedMeshName && (
                          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #2a2a2a' }}>
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
        })}
      </aside>

      {/* 右側 3D */}
      <main style={{ flex: 1, background: '#111', position: 'relative' }}>
        <Canvas camera={{ position: [0, 1.5, 6], fov: 45 }} style={{ width: '100%', height: '100%' }}>
          <ambientLight intensity={0.4} />
          <directionalLight position={[3, 5, 2]} intensity={1.0} />

          <group scale={[0.3, 0.3, 0.3]} position={[0, -0.1, 0]}>
            <BoneModel
              url="/models/bones.glb"
              selectedNormSet={selectedNormSet}
              onSelectMesh={onPickMeshFrom3D}
              onRegistryReady={(r) => {
                meshRegistryRef.current = r;
                setRegistryTick((t) => t + 1);
              }}
            />
          </group>

          {/* ✅ 真正的 silhouette outline：也支援多選 */}
          <EffectComposer multisampling={4}>
            <Outline
              selection={outlineSelection}
              visibleEdgeColor={0xff8a00}
              hiddenEdgeColor={0xff8a00}
              edgeStrength={4}
              width={1200}
            />
          </EffectComposer>

          <Controls controlsRef={controlsRef} cameraRef={cameraRef} />
          <Environment preset="city" />
        </Canvas>
      </main>
    </div>
  );
}

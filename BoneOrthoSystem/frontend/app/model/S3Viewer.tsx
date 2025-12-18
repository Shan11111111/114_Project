'use client';

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Environment, useGLTF } from '@react-three/drei';
import * as THREE from 'three';

// 讀 .env.local 的後端 URL，沒有就用預設 localhost:8000
const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:8000';

// ---------- Blender-like 橘色外框材質 ----------
const OUTLINE_MAT = new THREE.MeshBasicMaterial({
  color: new THREE.Color('#ff8a00'),
  side: THREE.BackSide,
  depthWrite: false,
});

// ---------- 跟後端同款 normalize ----------
function normalizeMeshName(meshName: string) {
  let s = (meshName || '').replace(/_/g, ' ').trim();
  if (
    s.length > 1 &&
    (s.endsWith('L') || s.endsWith('R')) &&
    !s.includes('.L') &&
    !s.includes('.R')
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

// ---------- 大類分群 ----------
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

  // 你 DB 會混中英： "頭顱骨 Cranial & Facial Bones"
  if (r.includes('cranial') || r.includes('facial') || r.includes('skull') || r.includes('頭顱')) return 'skull';
  if (r.includes('spine') || r.includes('vertebra') || r.includes('脊椎')) return 'spine';
  if (r.includes('thorax') || r.includes('rib') || r.includes('stern') || r.includes('胸') || r.includes('肋')) return 'thorax';
  if (r.includes('upper') || r.includes('arm') || r.includes('humer') || r.includes('ulna') || r.includes('radius') || r.includes('上肢') || r.includes('手')) return 'upper';
  if (r.includes('lower') || r.includes('leg') || r.includes('femor') || r.includes('tibia') || r.includes('fibula') || r.includes('下肢') || r.includes('足')) return 'lower';
  if (r.includes('pelvis') || r.includes('hip') || r.includes('骨盆')) return 'pelvis';

  return 'other';
}

// ---------- BoneModel ----------
type BoneModelProps = {
  url: string;
  selectedMeshName?: string | null;
  onSelectMesh?: (meshName: string) => void;
  onRegistryReady?: (registry: Record<string, THREE.Mesh>) => void;
};

function BoneModel({ url, selectedMeshName, onSelectMesh, onRegistryReady }: BoneModelProps) {
  const { scene } = useGLTF(url) as any;

  const [hovered, setHovered] = useState<string | null>(null);

  // registry: normalizedName -> rendered mesh instance
  const registryRef = useRef<Record<string, THREE.Mesh>>({});

  const meshes = useMemo(() => {
    const list: THREE.Mesh[] = [];
    scene.traverse((obj: any) => {
      if (obj?.isMesh) list.push(obj);
    });
    console.log('Loaded meshes:', list.map((m) => m.name));
    return list;
  }, [scene]);

  useEffect(() => {
    onRegistryReady?.(registryRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meshes]);

  const selectedNorm = selectedMeshName ? normalizeMeshName(selectedMeshName) : null;

  return (
    <group>
      {meshes.map((mesh) => {
        const rawName = mesh.name || 'noname';
        const normName = normalizeMeshName(rawName);

        const isHovered = hovered === rawName;
        const isSelected = !!selectedNorm && selectedNorm === normName;

        const pos = v3(mesh.position);
        const rot = e3(mesh.rotation);
        const scl = v3(mesh.scale);

        return (
          <group key={rawName}>
            {/* ✅ Blender-like 橘色外框：選取才畫 */}
            {isSelected && (
              <mesh
                geometry={mesh.geometry}
                position={pos}
                rotation={rot}
                scale={[scl[0] * 1.03, scl[1] * 1.03, scl[2] * 1.03]}
                material={OUTLINE_MAT}
                renderOrder={999}
              />
            )}

            {/* ✅ 主 mesh */}
            <mesh
              geometry={mesh.geometry}
              position={pos}
              rotation={rot}
              scale={scl}
              ref={(el) => {
                if (el) registryRef.current[normName] = el;
              }}
              onPointerOver={(e) => {
                e.stopPropagation();
                setHovered(rawName);
                document.body.style.cursor = 'pointer';
              }}
              onPointerOut={(e) => {
                e.stopPropagation();
                if (hovered === rawName) setHovered(null);
                document.body.style.cursor = 'auto';
              }}
              onClick={(e) => {
                e.stopPropagation();
                onSelectMesh?.(rawName); // 點模型也走同一套
              }}
            >
              <meshStandardMaterial
                attach="material"
                color={(mesh.material as any)?.color || undefined}
                emissive={isHovered ? new THREE.Color(0.2, 0.2, 0.2) : new THREE.Color(0, 0, 0)}
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

// ---------- 控制器 bridge（給 focus 用） ----------
function ControlsBridge({
  controlsRef,
  cameraRef,
}: {
  controlsRef: React.MutableRefObject<any>;
  cameraRef: React.MutableRefObject<THREE.Camera | null>;
}) {
  const { camera } = useThree();
  useEffect(() => {
    cameraRef.current = camera;
  }, [camera, cameraRef]);

  return <OrbitControls ref={controlsRef} enablePan enableZoom />;
}

export default function S3Viewer() {
  const [selectedMeshName, setSelectedMeshName] = useState<string | null>(null);
  const [boneInfo, setBoneInfo] = useState<BoneInfo | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(false);

  // 左側清單
  const [boneList, setBoneList] = useState<BoneListItem[]>([]);
  const [q, setQ] = useState('');
  const [openGroup, setOpenGroup] = useState<RegionKey>('skull'); // 預設打開頭顱骨

  // 3D focus
  const meshRegistryRef = useRef<Record<string, THREE.Mesh>>({});
  const controlsRef = useRef<any>(null);
  const cameraRef = useRef<THREE.Camera | null>(null);

  // 取得骨頭清單
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

  // focus：把鏡頭 target 移到該骨頭 bbox center
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

  // 這就是「唯一入口」：不管點模型還是點清單都走這條
  const selectByMeshName = useCallback(
    async (meshName: string) => {
      setSelectedMeshName(meshName);
      setLoadingInfo(true);
      setBoneInfo(null);

      try {
        // 1) MeshName → SmallBoneId
        const meshRes = await fetch(`${API_BASE}/s3/mesh-map/${encodeURIComponent(meshName)}`);
        if (!meshRes.ok) {
          console.error('mesh-map error:', await meshRes.text());
          setLoadingInfo(false);
          return;
        }
        const meshJson = await meshRes.json();
        const smallBoneId = meshJson.small_bone_id ?? meshJson.smallBoneId ?? meshJson.SmallBoneId;

        // 2) SmallBoneId → 骨頭資訊
        const boneRes = await fetch(`${API_BASE}/s3/bones/${smallBoneId}`);
        if (!boneRes.ok) {
          console.error('bones error:', await boneRes.text());
          setLoadingInfo(false);
          return;
        }
        const info = (await boneRes.json()) as BoneInfo;
        setBoneInfo(info);

        // 3) focus
        focusOnMesh(meshName);
      } catch (err) {
        console.error('selectByMeshName failed:', err);
      } finally {
        setLoadingInfo(false);
      }
    },
    [focusOnMesh]
  );

  // 搜尋（全域）
  const searched = useMemo(() => {
    const kw = q.trim().toLowerCase();
    if (!kw) return boneList;
    return boneList.filter((x) => {
      const key = `${x.bone_zh} ${x.bone_en} ${x.mesh_name} ${x.bone_region ?? ''}`.toLowerCase();
      return key.includes(kw);
    });
  }, [boneList, q]);

  // 分組（依大類）
  const grouped = useMemo(() => {
    const g: Record<RegionKey, BoneListItem[]> = {
      skull: [],
      spine: [],
      thorax: [],
      upper: [],
      lower: [],
      pelvis: [],
      other: [],
    };
    for (const item of searched) {
      g[toRegionKey(item.bone_region)].push(item);
    }
    (Object.keys(g) as RegionKey[]).forEach((k) => {
      g[k].sort((a, b) => (a.bone_zh || '').localeCompare(b.bone_zh || '', 'zh-Hant'));
    });
    return g;
  }, [searched]);

  return (
    <div style={{ display: 'flex', width: '100%', height: 'calc(100vh - 64px)' }}>
      {/* 左側清單 */}
      <aside
        style={{
          width: 360,
          background: '#0f0f0f',
          color: '#fff',
          borderRight: '1px solid #222',
          padding: 12,
          overflow: 'auto',
        }}
      >
        <div style={{ fontWeight: 900, fontSize: 16, marginBottom: 10 }}>
          骨頭清單（點不到就別硬點了🙃）
        </div>

        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜尋：額骨 / Frontal / Rib / Femur…"
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

        {/* 大類 */}
        {(Object.keys(grouped) as RegionKey[]).map((k) => {
          const items = grouped[k];
          if (!items.length) return null;

          const isOpen = openGroup === k;

          return (
            <div key={k} style={{ marginBottom: 10 }}>
              <button
                onClick={() => setOpenGroup(isOpen ? 'other' : k)} // 再點一次就收起來（丟到 other 當作關閉）
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '10px 12px',
                  borderRadius: 12,
                  border: '1px solid #2a2a2a',
                  background: isOpen ? '#1b1b1b' : '#141414',
                  color: '#fff',
                  cursor: 'pointer',
                  fontWeight: 900,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span>{REGION_LABEL[k]}</span>
                <span style={{ opacity: 0.75, fontSize: 12 }}>{items.length}</span>
              </button>

              {/* 細項 */}
              {isOpen && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                  {items.map((item) => {
                    const active =
                      selectedMeshName &&
                      normalizeMeshName(selectedMeshName) === normalizeMeshName(item.mesh_name);

                    return (
                      <button
                        key={`${item.small_bone_id}-${item.mesh_name}`}
                        onClick={() => selectByMeshName(item.mesh_name)}
                        style={{
                          textAlign: 'left',
                          padding: 10,
                          borderRadius: 12,
                          border: active ? '1px solid #ff8a00' : '1px solid #2a2a2a',
                          background: active ? '#221400' : '#141414',
                          color: '#fff',
                          cursor: 'pointer',
                        }}
                        title={item.mesh_name}
                      >
                        <div style={{ fontWeight: 900 }}>{item.bone_zh}</div>
                        <div style={{ fontSize: 12, opacity: 0.82 }}>{item.bone_en}</div>
                        <div style={{ fontSize: 11, opacity: 0.55, marginTop: 4 }}>
                          mesh: {item.mesh_name}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {/* 選取資訊 */}
        <div style={{ marginTop: 16, borderTop: '1px solid #222', paddingTop: 12 }}>
          <div style={{ fontWeight: 900, marginBottom: 6 }}>目前選取</div>

          {loadingInfo ? (
            <div style={{ opacity: 0.7, fontSize: 13 }}>載入中…</div>
          ) : !boneInfo ? (
            <div style={{ opacity: 0.7, fontSize: 13 }}>尚未選擇</div>
          ) : (
            <div style={{ fontSize: 13, lineHeight: 1.55 }}>
              <div>
                <b>{boneInfo.bone_zh}</b> / {boneInfo.bone_en}
              </div>
              <div style={{ opacity: 0.85 }}>{boneInfo.bone_region ?? ''}</div>
              {boneInfo.bone_desc ? (
                <div style={{ opacity: 0.85, marginTop: 8, whiteSpace: 'pre-wrap' }}>
                  {boneInfo.bone_desc}
                </div>
              ) : null}
            </div>
          )}
        </div>
      </aside>

      {/* 右側 3D */}
      <main style={{ flex: 1, background: '#111' }}>
        <Canvas camera={{ position: [0, 1.5, 6], fov: 45 }}>
          <ambientLight intensity={0.4} />
          <directionalLight position={[3, 5, 2]} intensity={1.0} />

          <group scale={[0.3, 0.3, 0.3]} position={[0, -0.1, 0]}>
            <BoneModel
              url="/models/bones.glb"
              selectedMeshName={selectedMeshName}
              onSelectMesh={selectByMeshName}
              onRegistryReady={(r) => (meshRegistryRef.current = r)}
            />
          </group>

          <ControlsBridge controlsRef={controlsRef} cameraRef={cameraRef} />
          <Environment preset="city" />
        </Canvas>
      </main>
    </div>
  );
}

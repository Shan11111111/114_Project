// frontend/app/components/BoneRenderPreview.tsx
"use client";

import React, { Suspense, useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Html, useGLTF, Center } from "@react-three/drei";
import * as THREE from "three";

type Props = {
    filePath?: string;
    meshName?: string;
    region?: string;
    regionZh?: string;
    lesionZh?: string;
    showLesion?: boolean;
};

function meshVariants(name: string): string[] {
    const raw = (name || "").trim();
    if (!raw) return [];

    const normalized = raw.replace(/\.{2,}/g, ".").replace(/([LR])\1$/i, "$1");

    const out = new Set<string>();
    out.add(raw);
    out.add(normalized);
    out.add(normalized.replace(/\./g, ""));

    const m = normalized.match(/([LR])$/i);
    if (m && !normalized.match(/\.[LR]$/i)) {
        out.add(normalized.slice(0, -1) + "." + normalized.slice(-1));
    }

    // 常見單複數差異：Ulna / Ulnae
    for (const x of Array.from(out)) {
        out.add(x.replace(/^Ulna/i, "Ulnae"));
        out.add(x.replace(/^Ulnae/i, "Ulna"));
    }

    return Array.from(out);
}

function BoneModel({ filePath, meshName, region, regionZh, lesionZh, showLesion }: Props) {
    const gltf = useGLTF(filePath || "");
    const variants = useMemo(() => meshVariants(meshName || ""), [meshName]);

    const target = useMemo<any>(() => {
        let found: any = null;

        gltf.scene.traverse((obj: any) => {
            if (found) return;
            if (obj.isMesh && variants.includes(obj.name)) {
                found = obj;
            }
        });

        return found;
    }, [gltf.scene, variants]);

    const cloned = useMemo<any>(() => {
        if (!target) return null;

        const copy = target.clone(true);

        copy.traverse((obj: any) => {
            if (obj.isMesh) {
                obj.material = obj.material?.clone?.() ?? new THREE.MeshStandardMaterial();
                obj.material.color = new THREE.Color("#e8eef8");
                obj.material.roughness = 0.45;
                obj.material.metalness = 0.05;
            }
        });

        return copy;
    }, [target]);

    if (!target || !cloned) {
        return (
            <Html center>
                <div className="rounded-xl bg-white/90 px-4 py-3 text-sm text-slate-800 shadow">
                    找不到 mesh：{meshName}
                    <br />
                    候選：{variants.join(", ")}
                </div>
            </Html>
        );
    }

    const markerPosition = useMemo(() => {
        const box = new THREE.Box3().setFromObject(cloned);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();

        box.getSize(size);
        box.getCenter(center);

        const isIrregularBone =
            size.y < size.x * 0.85 && size.y < size.z * 1.25;

        let y = center.y;

        if (!isIrregularBone) {
            if (region === "proximal") {
                y = center.y + size.y * 0.38;
            } else if (region === "distal") {
                y = center.y - size.y * 0.38;
            } else if (region === "shaft") {
                y = center.y;
            } else {
                y = center.y + size.y * 0.18;
            }
        }

        // marker 放在骨頭表面附近，不要固定飛到右邊
        const x = center.x + size.x * 0.08;
        const z = center.z + size.z * 0.08;

        return new THREE.Vector3(x, y, z);
    }, [cloned, region]);

    return (
        <Center>
            <primitive object={cloned} />

            {/* 骨折示意標記 */}
            {/* 骨折擬真示意：紅色病灶區 + 裂縫線 */}
            {showLesion && (
                <>
                    {/* 病灶光暈：貼近骨面，不用大紅球 */}
                    <group position={markerPosition}>
                        <mesh rotation={[Math.PI / 2, 0, 0]}>
                            <torusGeometry args={[0.2, 0.012, 16, 64]} />
                            <meshStandardMaterial color="#ef4444" emissive="#7f1d1d" transparent opacity={0.95} />
                        </mesh>

                        <mesh>
                            <sphereGeometry args={[0.18, 32, 32]} />
                            <meshStandardMaterial color="#ef4444" transparent opacity={0.16} depthWrite={false} />
                        </mesh>

                        {/* 主裂縫 */}
                        <mesh rotation={[0.2, 0.1, 0.65]} position={[0, 0, 0.045]}>
                            <boxGeometry args={[0.022, 0.52, 0.018]} />
                            <meshStandardMaterial color="#020617" />
                        </mesh>

                        {/* 分支裂縫 */}
                        <mesh rotation={[0.1, 0.1, -0.55]} position={[0.055, 0.08, 0.055]}>
                            <boxGeometry args={[0.014, 0.28, 0.014]} />
                            <meshStandardMaterial color="#450a0a" />
                        </mesh>

                        <mesh rotation={[0.1, 0.1, 0.25]} position={[-0.055, -0.07, 0.055]}>
                            <boxGeometry args={[0.012, 0.22, 0.012]} />
                            <meshStandardMaterial color="#450a0a" />
                        </mesh>

                        {/* 小碎片示意 */}
                        <mesh position={[0.12, -0.08, 0.06]} rotation={[0.4, 0.2, 0.7]}>
                            <coneGeometry args={[0.035, 0.11, 5]} />
                            <meshStandardMaterial color="#f8fafc" roughness={0.5} />
                        </mesh>
                    </group>

                    {/* 導引線 */}
                    <mesh
                        position={[markerPosition.x + 0.18, markerPosition.y + 0.14, markerPosition.z]}
                        rotation={[0, 0, -0.55]}
                    >
                        <boxGeometry args={[0.01, 0.45, 0.01]} />
                        <meshStandardMaterial color="#ef4444" />
                    </mesh>

                    {/* 浮動說明卡，不要黏在骨頭正上方 */}
                    <Html
                        position={[
                            markerPosition.x + 0.36,
                            markerPosition.y + 0.26,
                            markerPosition.z,
                        ]}
                        center
                    >
                        <div className="rounded-xl border border-red-200 bg-white/95 px-3 py-2 text-xs text-slate-800 shadow-lg">
                            <div className="font-bold text-red-600">
                                {lesionZh || "病灶示意"}
                            </div>
                            <div className="mt-0.5 text-slate-500">
                                {regionZh || "位置標示"}
                            </div>
                        </div>
                    </Html>
                </>
            )}
        </Center>
    );
}

export default function BoneRenderPreview(props: Props) {
    const anyProps = props as any;
    const filePath = props.filePath || anyProps?.asset?.file_path || "";
    const meshName = props.meshName || anyProps?.asset?.mesh_name || "";

    if (!filePath || !meshName) {
        return (
            <div className="h-[420px] overflow-hidden rounded-2xl bg-slate-950 text-white flex items-center justify-center">
                3D 模型資料不完整：filePath 或 meshName 缺失
            </div>
        );
    }

    return (
        <div className="h-[420px] overflow-hidden rounded-2xl bg-slate-950">
            <Canvas camera={{ position: [0, 1.2, 3.2], fov: 35 }}>
                <ambientLight intensity={1.2} />
                <directionalLight position={[3, 5, 4]} intensity={2} />

                <Suspense
                    fallback={
                        <Html center>
                            <div className="text-sm text-white">載入 3D 模型中...</div>
                        </Html>
                    }
                >
                    <BoneModel
                        {...props}
                        filePath={filePath}
                        meshName={meshName}
                    />
                </Suspense>

                <OrbitControls enablePan enableZoom enableRotate />
            </Canvas>
        </div>
    );
}
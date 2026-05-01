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

        const y =
            region === "proximal" ? box.max.y - size.y * 0.18 :
                region === "distal" ? box.min.y + size.y * 0.18 :
                    region === "shaft" ? center.y :
                        box.max.y - size.y * 0.35;

        return new THREE.Vector3(
            box.max.x + size.x * 0.08,
            y,
            center.z
        );
    }, [cloned, region]);

    return (
        <Center>
            <primitive object={cloned} />

            {/* 骨折示意標記 */}
            {/* 骨折擬真示意：紅色病灶區 + 裂縫線 */}
            <group position={markerPosition}>
                <mesh>
                    <sphereGeometry args={[0.16, 32, 32]} />
                    <meshStandardMaterial color="red" transparent opacity={0.35} />
                </mesh>

                <mesh rotation={[0, 0, 0.75]} position={[0, 0, 0.04]}>
                    <boxGeometry args={[0.035, 0.5, 0.035]} />
                    <meshStandardMaterial color="#111827" />
                </mesh>

                <mesh rotation={[0, 0, -0.5]} position={[0.05, 0.08, 0.05]}>
                    <boxGeometry args={[0.025, 0.28, 0.025]} />
                    <meshStandardMaterial color="#7f1d1d" />
                </mesh>

                <mesh rotation={[0, 0, 0.25]} position={[-0.05, -0.06, 0.05]}>
                    <boxGeometry args={[0.022, 0.22, 0.022]} />
                    <meshStandardMaterial color="#7f1d1d" />
                </mesh>
            </group>

            <Html position={[markerPosition.x + 0.18, markerPosition.y + 0.12, markerPosition.z]} center>
                <div className="whitespace-nowrap rounded-full bg-red-500 px-3 py-1 text-xs font-bold text-white shadow">
                    {lesionZh || "骨折示意"}｜{regionZh || "位置標示"}
                </div>
            </Html>
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
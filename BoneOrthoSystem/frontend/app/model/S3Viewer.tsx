'use client';

import React, { useState, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment, useGLTF } from '@react-three/drei';
import * as THREE from 'three';

type BoneModelProps = {
  url: string;
  onSelectMesh?: (meshName: string) => void;
};

function BoneModel({ url, onSelectMesh }: BoneModelProps) {
  const { scene } = useGLTF(url) as any;

  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const meshes = useMemo(() => {
    const list: THREE.Mesh[] = [];
    scene.traverse((obj: any) => {
      if (obj.isMesh) list.push(obj);
    });
    console.log('Loaded meshes:', list.map((m) => m.name));
    return list;
  }, [scene]);

  return (
    <group>
      {meshes.map((mesh) => {
        const name = mesh.name || 'noname';
        const isHovered = hovered === name;
        const isSelected = selected === name;

        return (
          <mesh
            key={name}
            geometry={mesh.geometry}
            position={mesh.position}
            rotation={mesh.rotation}
            scale={mesh.scale}
            onPointerOver={(e) => {
              e.stopPropagation();
              setHovered(name);
              document.body.style.cursor = 'pointer';
            }}
            onPointerOut={(e) => {
              e.stopPropagation();
              if (hovered === name) setHovered(null);
              document.body.style.cursor = 'auto';
            }}
            onClick={(e) => {
              e.stopPropagation();
              setSelected(name);
              console.log('clicked mesh:', name);
              onSelectMesh && onSelectMesh(name);
            }}
          >
            <meshStandardMaterial
              attach="material"
              color={(mesh.material as any)?.color || undefined}
              emissive={
                isSelected
                  ? new THREE.Color(0.4, 0.4, 0.4)
                  : isHovered
                  ? new THREE.Color(0.2, 0.2, 0.2)
                  : new THREE.Color(0, 0, 0)
              }
            />
          </mesh>
        );
      })}
    </group>
  );
}

export default function S3Viewer() {
  const handleSelectMesh = (meshName: string) => {
    console.log('S3 selected mesh:', meshName);
  };

  return (
    <div style={{ width: '100%', height: 'calc(100vh - 64px)', background: '#111' }}>
      <Canvas camera={{ position: [0, 1.5, 6], fov: 45 }}>
        <ambientLight intensity={0.4} />
        <directionalLight position={[3, 5, 2]} intensity={1.0} />

        {/* ★ 這裡整體縮小 + 微調位置 ★ */}
        <group scale={[0.3, 0.3, 0.3]} position={[0, -0.1, 0]}>
          <BoneModel url="/models/bones.glb" onSelectMesh={handleSelectMesh} />
        </group>

        <OrbitControls enablePan enableZoom />
        <Environment preset="city" />
      </Canvas>
    </div>
  );
}

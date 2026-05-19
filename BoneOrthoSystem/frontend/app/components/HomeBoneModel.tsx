"use client";

import { Canvas } from "@react-three/fiber";
import { Environment, OrbitControls, useGLTF } from "@react-three/drei";
import { useEffect } from "react";
import * as THREE from "three";

function Model() {
  const { scene } = useGLTF("/models/skeleton_30_40_v3_keep_names.glb");

  useEffect(() => {
    scene.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;

        mesh.material = new THREE.MeshStandardMaterial({
          color: "#9ca3af",
          roughness: 0.68,
          metalness: 0.01,
        });

        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
  }, [scene]);

  return (
    <primitive
      object={scene}
      scale={0.5}
      position={[0, -2.35, 0]}
      rotation={[0.05, 0.25, 0]}
    />
  );
}

export default function HomeBoneModel() {
  return (
    <Canvas
      shadows
      camera={{
        position: [0, 0.35, 7.6],
        fov: 25,
      }}
    >
      <ambientLight intensity={0.45} />

      <directionalLight
        position={[3, 5, 5]}
        intensity={2.8}
        castShadow
      />

      <directionalLight
        position={[-4, 2, -3]}
        intensity={1.1}
      />

      <Model />

      <Environment preset="studio" />

      <OrbitControls
        autoRotate
        autoRotateSpeed={0.45}
        enableZoom={false}
        enablePan={false}
        enableRotate={true}
        enableDamping
        dampingFactor={0.08}
      />
    </Canvas>
  );
}
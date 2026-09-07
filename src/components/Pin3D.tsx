import React, { Suspense } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useGLTF, Float } from '@react-three/drei';
import * as THREE from 'three';
import checkpointAsset from '@/assets/checkpoint.glb.asset.json';

const BRAND = '#31D880';

function Model() {
  const { scene } = useGLTF(checkpointAsset.url) as any;
  // Recolor every material to the VaiPet brand green so the pin reads as a
  // checkpoint regardless of the source GLB's original colors.
  React.useMemo(() => {
    const color = new THREE.Color(BRAND);
    scene.traverse((obj: any) => {
      if (obj.isMesh && obj.material) {
        const apply = (mat: any) => {
          if (mat.color) mat.color.copy(color);
          if (mat.emissive) mat.emissive.copy(color).multiplyScalar(0.25);
          mat.roughness = 0.45;
          mat.metalness = 0.2;
          mat.needsUpdate = true;
        };
        if (Array.isArray(obj.material)) obj.material.forEach(apply);
        else apply(obj.material);
      }
    });
  }, [scene]);
  return <primitive object={scene} scale={1.6} />;
}

useGLTF.preload(checkpointAsset.url);

export const Pin3D: React.FC<{ size?: number }> = ({ size = 96 }) => (
  <div style={{ width: size, height: size }}>
    <Canvas
      camera={{ position: [0, 1.2, 3.2], fov: 35 }}
      gl={{ alpha: true, antialias: true }}
      style={{ background: 'transparent' }}
    >
      <ambientLight intensity={0.8} />
      <directionalLight position={[3, 5, 2]} intensity={1.2} />
      <Suspense fallback={null}>
        <Float speed={2} rotationIntensity={0.4} floatIntensity={0.6}>
          <Model />
        </Float>
      </Suspense>
    </Canvas>
  </div>
);

export default Pin3D;
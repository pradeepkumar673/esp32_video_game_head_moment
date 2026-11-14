import { Canvas, useFrame } from '@react-three/fiber';
import { useGLTF, Environment } from '@react-three/drei';
import { Suspense, useEffect, useRef } from 'react';

const DEG = Math.PI / 180;

// Flip any axis to -1 if the head moves the wrong way when you test it.
const FLIP = { yaw: -1, pitch: 1, roll: -1 };

function HeadModel({ yaw, pitch, roll }) {
  const { scene } = useGLTF('/models/head.glb');
  const group = useRef();
  const target = useRef({ yaw, pitch, roll });
  target.current = { yaw, pitch, roll };

  useEffect(() => {
    if (group.current) group.current.rotation.order = 'YXZ';
  }, []);

  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    const t = target.current;
    const k = 1 - Math.exp(-dt * 12); // higher = snappier
    g.rotation.y += (FLIP.yaw * t.yaw * DEG - g.rotation.y) * k;
    g.rotation.x += (FLIP.pitch * t.pitch * DEG - g.rotation.x) * k;
    g.rotation.z += (FLIP.roll * t.roll * DEG - g.rotation.z) * k;
  });

  return (
    <group ref={group}>
      <primitive object={scene} />
    </group>
  );
}

export default function Head3D({ yaw, pitch, roll }) {
  return (
    <Canvas camera={{ position: [0, 0, 2.2], fov: 35 }}>
      <color attach="background" args={['#1b1b19']} />
      <ambientLight intensity={0.5} />
      <directionalLight position={[2, 3, 4]} intensity={1.4} />
      <Suspense fallback={null}>
        <HeadModel yaw={yaw} pitch={pitch} roll={roll} />
        <Environment preset="studio" />
      </Suspense>
    </Canvas>
  );
}

useGLTF.preload('/models/head.glb');


import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useGLTF, Environment } from '@react-three/drei';
import { Suspense, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

const DEG = Math.PI / 180;

// Flip any axis to -1 if the head moves the wrong way.
const FLIP = { yaw: -1, pitch: -1, roll: -1 };

// Camera settings: the head's bounding sphere fills about 80% of the frame height.
const FOV = 70;
const MARGIN = 1.15;

function HeadModel({ yaw, pitch, roll }) {
  const { scene } = useGLTF('/models/head.glb');
  const { camera } = useThree();
  const group = useRef();
  const target = useRef({ yaw, pitch, roll });
  target.current = { yaw, pitch, roll };

  // Scale the model so its bounding sphere has radius 1, centered at the origin
  const fit = useMemo(() => {
    const box = new THREE.Box3().setFromObject(scene);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const s = 1 / sphere.radius;
    const offset = [-sphere.center.x * s, -sphere.center.y * s, -sphere.center.z * s];
    return { s, offset };
  }, [scene]);

  // Move the camera back far enough to see the whole sphere
  useEffect(() => {
    const halfFov = (FOV / 2) * DEG;
    const dist = (1 / Math.sin(halfFov)) * MARGIN;
    camera.position.set(0, 0, dist);
    camera.lookAt(0, 0, 0);
  }, [camera]);

  useEffect(() => {
    if (group.current) group.current.rotation.order = 'YXZ';
  }, []);

  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    const t = target.current;
    const k = 1 - Math.exp(-dt * 12);
    g.rotation.y += (FLIP.yaw * t.yaw * DEG - g.rotation.y) * k;
    g.rotation.x += (FLIP.pitch * t.pitch * DEG - g.rotation.x) * k;
    g.rotation.z += (FLIP.roll * t.roll * DEG - g.rotation.z) * k;
  });

  return (
    <group ref={group}>
      <primitive object={scene} position={fit.offset} scale={fit.s} />
    </group>
  );
}

export default function Head3D({ yaw, pitch, roll }) {
  return (
    <Canvas camera={{ fov: FOV, near: 0.1, far: 100 }}>
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

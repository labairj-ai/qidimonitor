import React, { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const STLViewer = forwardRef(function STLViewer({ file, rotation = { x: 0, y: 0, z: 0 } }, ref) {
  const mountRef = useRef();
  const meshRef = useRef(null);
  const frameRef = useRef();
  const rotationRef = useRef(rotation);
  const [dims, setDims] = useState(null);
  const [error, setError] = useState(null);

  // Keep rotationRef current so the load callback picks up latest value
  useEffect(() => { rotationRef.current = rotation; }, [rotation]);

  // Apply rotation prop changes to an already-loaded mesh
  useEffect(() => {
    if (!meshRef.current) return;
    meshRef.current.rotation.set(
      THREE.MathUtils.degToRad(rotation.x),
      THREE.MathUtils.degToRad(rotation.y),
      THREE.MathUtils.degToRad(rotation.z),
    );
  }, [rotation.x, rotation.y, rotation.z]);

  // Expose getTransformedSTL() to parent via ref
  useImperativeHandle(ref, () => ({
    getTransformedSTL: () => {
      if (!meshRef.current) return null;
      const exporter = new STLExporter();
      const tmp = new THREE.Scene();
      const m = meshRef.current.clone();
      tmp.add(m);
      tmp.updateMatrixWorld(true);
      return exporter.parse(tmp, { binary: true }); // ArrayBuffer with rotation baked in
    },
  }), []);

  useEffect(() => {
    if (!file || !mountRef.current) return;
    meshRef.current = null;

    const mount = mountRef.current;
    const width = mount.clientWidth;
    const height = mount.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 10000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(1, 2, 1.5);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x8888ff, 0.4);
    fill.position.set(-1, -1, -1);
    scene.add(fill);

    const grid = new THREE.GridHelper(200, 20, 0x333355, 0x222244);
    scene.add(grid);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.minDistance = 1;
    controls.maxDistance = 5000;

    const url = URL.createObjectURL(file);
    const loader = new STLLoader();
    loader.load(url, (geometry) => {
      geometry.computeBoundingBox();
      const box = geometry.boundingBox;
      const size = new THREE.Vector3();
      box.getSize(size);
      const center = new THREE.Vector3();
      box.getCenter(center);

      setDims({ x: size.x.toFixed(1), y: size.y.toFixed(1), z: size.z.toFixed(1) });

      geometry.translate(-center.x, -center.y, -box.min.z);

      const mat = new THREE.MeshPhongMaterial({
        color: 0x4a9eff, specular: 0x222222, shininess: 40, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geometry, mat);

      // Apply any rotation that was already set before the model loaded
      const rot = rotationRef.current;
      mesh.rotation.set(
        THREE.MathUtils.degToRad(rot.x),
        THREE.MathUtils.degToRad(rot.y),
        THREE.MathUtils.degToRad(rot.z),
      );

      scene.add(mesh);
      meshRef.current = mesh;

      const maxDim = Math.max(size.x, size.y, size.z);
      camera.position.set(maxDim * 1.2, maxDim * 0.8, maxDim * 1.5);
      camera.lookAt(0, size.z / 2, 0);
      controls.target.set(0, size.z / 2, 0);
      controls.update();
    }, undefined, () => setError('Could not parse STL file'));

    const animate = () => {
      frameRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const ro = new ResizeObserver(() => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    ro.observe(mount);

    return () => {
      cancelAnimationFrame(frameRef.current);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      URL.revokeObjectURL(url);
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
      meshRef.current = null;
    };
  }, [file]);

  if (!file) return null;

  return (
    <div style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', background: '#1a1a2e', marginBottom: 8 }}>
      <div ref={mountRef} style={{ width: '100%', height: 280 }} />
      {dims && (
        <div style={{
          position: 'absolute', bottom: 8, left: 10,
          fontSize: 11, color: 'rgba(255,255,255,0.55)',
          background: 'rgba(0,0,0,0.4)', padding: '3px 7px', borderRadius: 4,
          fontFamily: 'monospace',
        }}>
          {dims.x} × {dims.y} × {dims.z} mm
        </div>
      )}
      <div style={{ position: 'absolute', bottom: 8, right: 10, fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>
        drag to rotate · scroll to zoom
      </div>
      {error && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--crit)', fontSize: 12 }}>
          {error}
        </div>
      )}
    </div>
  );
});

export default STLViewer;

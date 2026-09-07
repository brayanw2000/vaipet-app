import mapboxgl from 'mapbox-gl';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import checkpointGlb from '@/assets/checkpoint.glb.asset.json';

// Stationary 3D checkpoint pin rendered as a Mapbox custom layer. The GLB
// is loaded once, cached, and every mesh material is recoloured to the
// brand green so the pin reads as a VaiPet checkpoint regardless of the
// source model's original colors. Includes a gentle bob + spin animation
// so the pin feels alive without being distracting.

export interface Checkpoint3DLayer extends mapboxgl.CustomLayerInterface {
  setPosition(lngLat: [number, number]): void;
  setVisible(v: boolean): void;
}

export interface Checkpoint3DOptions {
  /** Target on-map size (longest axis) in meters. Default 6. */
  targetSizeMeters: number;
  /** Brand color applied to every material. Default #31D880. */
  color: string;
  /** Vertical offset over terrain, meters. */
  groundOffsetMeters: number;
}

let cachedGltf: import('three/examples/jsm/loaders/GLTFLoader.js').GLTF | null = null;
let cachedPromise: Promise<import('three/examples/jsm/loaders/GLTFLoader.js').GLTF> | null = null;

export function preloadCheckpointAsset(): Promise<unknown> {
  if (cachedGltf) return Promise.resolve(cachedGltf);
  if (cachedPromise) return cachedPromise;
  const loader = new GLTFLoader();
  cachedPromise = loader.loadAsync(checkpointGlb.url)
    .then((gltf) => { cachedGltf = gltf; return gltf; })
    .catch((err) => {
      cachedPromise = null;
      console.error('[checkpoint3dLayer] preload failed', err);
      throw err;
    });
  return cachedPromise;
}

export function createCheckpoint3DLayer(
  id: string,
  initial: [number, number],
  options: Partial<Checkpoint3DOptions> = {},
): Checkpoint3DLayer {
  const opts: Checkpoint3DOptions = {
    targetSizeMeters: 6,
    color: '#31D880',
    groundOffsetMeters: 0,
    ...options,
  };

  let camera: THREE.Camera;
  let scene: THREE.Scene;
  let renderer: THREE.WebGLRenderer;
  let mapRef: mapboxgl.Map | null = null;
  let root: THREE.Group;
  let modelGroup: THREE.Group | null = null;
  let visible = true;
  let lng = initial[0], lat = initial[1];
  let terrainElevationMeters = 0;
  let lastFrameTs = 0;

  const createFallbackPin = () => {
    const fallback = new THREE.Group();
    const green = new THREE.MeshStandardMaterial({ color: new THREE.Color(opts.color), emissive: new THREE.Color(opts.color).multiplyScalar(0.25), roughness: 0.45, metalness: 0.2 });
    const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 24, 24), green);
    head.position.y = 1.12;
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.18, 18, 18), white);
    core.position.y = 1.12;
    const stem = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.95, 24), green);
    stem.position.y = 0.48;
    stem.rotation.x = Math.PI;
    fallback.add(head, core, stem);
    fallback.scale.setScalar(opts.targetSizeMeters / 1.8);
    return fallback;
  };

  const tintMaterial = (mat: THREE.Material) => {
    const c = new THREE.Color(opts.color);
    if ((mat as THREE.MeshStandardMaterial).color) {
      (mat as THREE.MeshStandardMaterial).color.copy(c);
    }
    if ('emissive' in mat) {
      (mat as THREE.MeshStandardMaterial).emissive = c.clone().multiplyScalar(0.35);
    }
    if ('metalness' in mat) (mat as THREE.MeshStandardMaterial).metalness = 0.35;
    if ('roughness' in mat) (mat as THREE.MeshStandardMaterial).roughness = 0.45;
    mat.needsUpdate = true;
  };

  const buildScene = () => {
    const g = new THREE.Group();
    const install = (gltf: import('three/examples/jsm/loaders/GLTFLoader.js').GLTF) => {
      g.clear();
      const model = skeletonClone(gltf.scene) as THREE.Object3D;
      model.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh && mesh.material) {
          const m = mesh.material as THREE.Material | THREE.Material[];
          if (Array.isArray(m)) m.forEach(tintMaterial);
          else tintMaterial(m);
        }
      });
      model.updateMatrixWorld(true);
      const bbox = new THREE.Box3().setFromObject(model);
      const size = new THREE.Vector3();
      bbox.getSize(size);
      const longest = Math.max(size.x, size.y, size.z) || 1;
      const s = opts.targetSizeMeters / longest;
      g.scale.setScalar(s);
      // Place model so its base sits on y=0.
      model.position.y -= bbox.min.y;
      g.add(model);
      if (mapRef) mapRef.triggerRepaint();
    };
    g.add(createFallbackPin());
    if (cachedGltf) install(cachedGltf);
    else preloadCheckpointAsset()
      .then((gltf) => install(gltf as import('three/examples/jsm/loaders/GLTFLoader.js').GLTF))
      .catch(() => { /* logged */ });
    modelGroup = g;
    return g;
  };

  return {
    id,
    type: 'custom',
    renderingMode: '3d',

    onAdd(map, gl) {
      mapRef = map;
      camera = new THREE.Camera();
      scene = new THREE.Scene();
      scene.add(new THREE.AmbientLight(0xffffff, 0.85));
      const dir = new THREE.DirectionalLight(0xffffff, 0.9);
      dir.position.set(0, 80, 100).normalize();
      scene.add(dir);
      root = new THREE.Group();
      root.add(buildScene());
      scene.add(root);
      renderer = new THREE.WebGLRenderer({
        canvas: map.getCanvas(),
        context: gl as WebGLRenderingContext,
        antialias: true,
      });
      renderer.autoClear = false;
      // Kick off the first frame ourselves — otherwise Mapbox may not call
      // render() until the next style event, which made the pin appear
      // only after the user toggled day/night.
      try { map.triggerRepaint(); } catch {}
    },

    render(_gl, matrix) {
      if (!visible || !mapRef) return;
      const queried = mapRef.queryTerrainElevation?.([lng, lat], { exaggerated: false });
      if (Number.isFinite(queried)) terrainElevationMeters = queried as number;
      const merc = mapboxgl.MercatorCoordinate.fromLngLat(
        [lng, lat],
        terrainElevationMeters + opts.groundOffsetMeters,
      );
      const scale = merc.meterInMercatorCoordinateUnits();

      const nowMs = performance.now();
      const dt = Math.min(0.1, (nowMs - (lastFrameTs || nowMs)) / 1000);
      lastFrameTs = nowMs;
      if (modelGroup) {
        modelGroup.rotation.y += dt * 0.6;
        modelGroup.position.y = Math.sin(nowMs * 0.0025) * 0.15;
      }

      const m = new THREE.Matrix4()
        .makeTranslation(merc.x, merc.y, merc.z || 0)
        .scale(new THREE.Vector3(scale, -scale, scale))
        .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));

      const projection = new THREE.Matrix4().fromArray(matrix as number[]);
      camera.projectionMatrix = projection.multiply(m);

      renderer.resetState();
      renderer.render(scene, camera);
      mapRef.triggerRepaint();
    },

    setPosition(p) { lng = p[0]; lat = p[1]; },
    setVisible(v) { visible = v; if (mapRef) mapRef.triggerRepaint(); },
  };
}
import mapboxgl from 'mapbox-gl';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import defaultAvatarAsset from '@/assets/default_avatar.glb.asset.json';

// Procedural low-poly dog built from primitives — no external asset needed.
// Exposes a Mapbox CustomLayer that follows a lng/lat with bearing rotation
// and animates the legs to look like it's walking.
export interface Dog3DLayer extends mapboxgl.CustomLayerInterface {
  setPosition(lngLat: [number, number]): void;
  setBearing(deg: number): void;
  setVisible(v: boolean): void;
  setOptions(opts: Partial<Dog3DOptions>): void;
}

export interface Dog3DOptions {
  /** EMA factor for speed smoothing — higher = snappier, lower = smoother. Default 3. */
  speedSmoothing: number;
  /** EMA factor for bearing smoothing. Default 0.18 (per-frame lerp). */
  bearingSmoothing: number;
  /** m/s threshold below which the gait winds down to idle (no stepping in place). Default 0.15. */
  idleThreshold: number;
  /** How aggressively step frequency scales with speed (Hz per m/s). Default 2.2. */
  freqSensitivity: number;
  /** Max step frequency (Hz) clamp. Default 4.5. */
  maxFreq: number;
  /** Stride amplitude scaling. Default 1.0. */
  amplitudeScale: number;
  /** Target on-map size of the dog's longest axis, in meters. Default 8. */
  targetSizeMeters: number;
  /** Extra Y rotation (radians) applied to the model so its nose matches the map bearing. */
  modelYawOffset: number;
  /** Derive heading from successive setPosition() deltas when no route bearing is supplied. Default true. */
  autoHeading: boolean;
  /** Min movement (meters) before the auto-heading updates. Default 0.05. */
  headingMinStep: number;
  /** Vertical offset over terrain, in meters. Default 0 keeps feet/shadow flush with the map. */
  groundOffsetMeters: number;
  /** Lateral offset from the main trajectory line, in meters. Negative = left, positive = right. Default 0. */
  lateralOffsetMeters: number;
}

// ---------------- GLB preload + cache ----------------
// Parse the GLB once and reuse it across every Dog3DLayer instance so the
// model is ready instantly the moment the walk starts. Call preloadDog3DAsset()
// as early as possible (e.g. when the user accepts the walk) so the heavy
// network + parse cost is paid up-front, well before the petwalker confirms
// the pickup code.
let cachedGltf: import('three/examples/jsm/loaders/GLTFLoader.js').GLTF | null = null;
let cachedGltfPromise: Promise<import('three/examples/jsm/loaders/GLTFLoader.js').GLTF> | null = null;

export function preloadDog3DAsset(): Promise<unknown> {
  if (cachedGltf) return Promise.resolve(cachedGltf);
  if (cachedGltfPromise) return cachedGltfPromise;
  const loader = new GLTFLoader();
  cachedGltfPromise = loader.loadAsync(defaultAvatarAsset.url)
    .then((gltf) => { cachedGltf = gltf; return gltf; })
    .catch((err) => {
      cachedGltfPromise = null;
      console.error('[dog3dLayer] preload failed', err);
      throw err;
    });
  return cachedGltfPromise;
}

export function createDog3DLayer(
  id: string,
  initial: [number, number],
  options: Partial<Dog3DOptions> = {},
): Dog3DLayer {
  const opts: Dog3DOptions = {
    speedSmoothing: 3,
    bearingSmoothing: 0.6,
    idleThreshold: 0.15,
    freqSensitivity: 2.2,
    maxFreq: 4.5,
    amplitudeScale: 1,
    // Target on-map size — actual uniform scale is derived from the GLB's
    // runtime bounding box so any future model auto-fits.
    targetSizeMeters: 8,
    // Meshy/Blender GLB nose is on +Z; after Mapbox's axis conversion, PI
    // makes bearing 0° face north instead of sideways/south.
    modelYawOffset: Math.PI,
    autoHeading: true,
    headingMinStep: 0.05,
    groundOffsetMeters: 0,
    lateralOffsetMeters: 0,
    ...options,
  };
  // Idle/active envelope (0 = fully idle/wound down, 1 = full gait)
  let activeness = 0;

  let camera: THREE.Camera;
  let scene: THREE.Scene;
  let renderer: THREE.WebGLRenderer;
  let mapRef: mapboxgl.Map | null = null;
  let root: THREE.Group;
  let modelGroup: THREE.Group | null = null;
  let mixer: THREE.AnimationMixer | null = null;
  let walkAction: THREE.AnimationAction | null = null;
  let visible = true;
  let lng = initial[0], lat = initial[1];
  let bearing = 0;
  let smoothBearing = 0;
  let terrainElevationMeters = 0;
  let lastExplicitBearingTs = 0;
  // Speed-driven gait
  let lastPosForSpeed: [number, number] | null = null;
  let lastSpeedTs = 0;
  let rawSpeed = 0;      // m/s estimated from setPosition deltas
  let smoothSpeed = 0;   // EMA-smoothed m/s used to drive the gait
  let lastFrameTs = 0;

  const createFallbackDog = () => {
    const fallback = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x00a978, roughness: 0.55, metalness: 0.08 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.7 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.62, 0.72), bodyMat);
    body.position.y = 0.58;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.5, 0.52), bodyMat);
    head.position.set(0, 0.78, 0.62);
    const snout = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.24, 0.28), darkMat);
    snout.position.set(0, 0.74, 0.98);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.62), bodyMat);
    tail.position.set(0, 0.78, -0.68);
    tail.rotation.x = -0.72;
    fallback.add(body, head, snout, tail);
    [[-0.48, -0.26], [0.48, -0.26], [-0.48, 0.26], [0.48, 0.26]].forEach(([x, z]) => {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.54, 0.16), darkMat);
      leg.position.set(x, 0.22, z);
      fallback.add(leg);
    });
    fallback.scale.setScalar(opts.targetSizeMeters / 1.9);
    return fallback;
  };

  const buildScene = () => {
    const g = new THREE.Group();
    // Pre-rotate so the model's forward axis aligns with the travel direction
    // at bearing 0° (same logic the procedural dog used).
    g.rotation.y = opts.modelYawOffset;

    const fallback = createFallbackDog();
    g.add(fallback);

    const installGltf = (gltf: import('three/examples/jsm/loaders/GLTFLoader.js').GLTF) => {
        g.remove(fallback);
        // Clone with SkeletonUtils so skinned meshes + animations work even
        // when the same parsed GLB is reused across multiple instances.
        const model = skeletonClone(gltf.scene) as THREE.Object3D;
        // Make sure every child transform is baked before measuring.
        model.updateMatrixWorld(true);
        const bbox = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        bbox.getSize(size);
        const longest = Math.max(size.x, size.y, size.z) || 1;
        const s = opts.targetSizeMeters / longest;
        g.scale.setScalar(s);
        // Ground the feet exactly on y=0 in the parent group's local space.
        // Subtract min.y so the lowest vertex lands on the map plane, then
        // nudge a hair downward so the paws visually "kiss" the terrain
        // instead of hovering due to mesh skirt / shadow stacking.
        model.position.y -= bbox.min.y;
        model.position.y -= size.y * 0.01;
        g.add(model);

        if (gltf.animations && gltf.animations.length > 0) {
          mixer = new THREE.AnimationMixer(model);
          walkAction = mixer.clipAction(gltf.animations[0]);
          walkAction.play();
        }
        if (mapRef) mapRef.triggerRepaint();
    };

    // Use the preloaded GLB if available — model appears immediately.
    if (cachedGltf) {
      installGltf(cachedGltf);
    } else {
      preloadDog3DAsset()
        .then((gltf) => installGltf(gltf as import('three/examples/jsm/loaders/GLTFLoader.js').GLTF))
        .catch(() => { /* already logged */ });
    }

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
      scene.add(new THREE.AmbientLight(0xffffff, 0.7));
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
    },

    render(_gl, matrix) {
      if (!visible || !mapRef) return;
      const queriedElevation = mapRef.queryTerrainElevation?.([lng, lat], { exaggerated: false });
      if (Number.isFinite(queriedElevation)) terrainElevationMeters = queriedElevation as number;
      
      // Calculate lateral offset in Mercator units
      const rad = THREE.MathUtils.degToRad(-smoothBearing);
      const latOffset = opts.lateralOffsetMeters;
      
      const merc = mapboxgl.MercatorCoordinate.fromLngLat(
        [lng, lat],
        terrainElevationMeters + opts.groundOffsetMeters,
      );
      const scale = merc.meterInMercatorCoordinateUnits();

      // Smooth bearing interpolation (shortest path) — strength configurable
      const diff = ((bearing - smoothBearing + 540) % 360) - 180;
      smoothBearing += diff * opts.bearingSmoothing;

      // Apply lateral offset to the position based on current bearing
      // The model's "forward" is along the direction of travel (smoothBearing).
      // A lateral offset is perpendicular to this: offset * [cos(rad), 0, sin(rad)] in 2D space?
      // Actually, if model faces North (0 deg), +X is East, +Z is South.
      // With our rotation logic:
      const mercX = merc.x + (Math.cos(rad) * latOffset * scale);
      const mercY = merc.y + (Math.sin(rad) * latOffset * scale);

      const m = new THREE.Matrix4()
        .makeTranslation(mercX, mercY, merc.z || 0)
        .scale(new THREE.Vector3(scale, -scale, scale))
        // Rotate so model's +Y points up (mapbox z is up after this)
        .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2))
        // Apply bearing (around vertical axis)
        .multiply(new THREE.Matrix4().makeRotationY(THREE.MathUtils.degToRad(-smoothBearing)));

      const projection = new THREE.Matrix4().fromArray(matrix as number[]);
      camera.projectionMatrix = projection.multiply(m);

      // ---- Walking gait, driven by real walk speed (smoothly interpolated) ----
      const nowMs = performance.now();
      const dt = Math.min(0.1, (nowMs - (lastFrameTs || nowMs)) / 1000);
      lastFrameTs = nowMs;
      // Decay raw speed if no new positions arrive (so it doesn't stay high)
      if (nowMs - lastSpeedTs > 400) rawSpeed *= 0.9;
      // EMA smoothing — soft transitions between speeds
      smoothSpeed += (rawSpeed - smoothSpeed) * Math.min(1, dt * opts.speedSmoothing);

      // Idle/active envelope: when speed drops below threshold, wind the gait
      // down to zero (legs ease back to neutral) instead of stepping in place.
      const wantsActive = smoothSpeed > opts.idleThreshold ? 1 : 0;
      // Asymmetric easing: spin-up faster than wind-down for natural feel.
      const envSpeed = wantsActive ? 4 : 1.8;
      activeness += (wantsActive - activeness) * Math.min(1, dt * envSpeed);
      // Drive the baked walking clip — timeScale scales with speed so the
      // legs match real movement. At idle we slow the clip to a near halt
      // (it stays on a relaxed pose) instead of stepping in place.
      const speedCurve = Math.sqrt(Math.max(0, smoothSpeed));
      const clipRate = Math.min(opts.maxFreq, 0.4 + speedCurve * opts.freqSensitivity);
      if (walkAction) walkAction.timeScale = clipRate * 0.35 * Math.max(0.05, activeness);
      if (mixer) mixer.update(dt);

      renderer.resetState();
      renderer.render(scene, camera);
      mapRef.triggerRepaint();
    },

    setPosition(p) {
      // Estimate instantaneous speed from successive positions.
      const now = performance.now();
      if (lastPosForSpeed && lastSpeedTs) {
        const dt = (now - lastSpeedTs) / 1000;
        if (dt > 0.02) {
          // Haversine-ish for small distances: deg → m approximation.
          const dx = (p[0] - lastPosForSpeed[0]) * 111320 * Math.cos((p[1] * Math.PI) / 180);
          const dy = (p[1] - lastPosForSpeed[1]) * 110540;
          const dist = Math.hypot(dx, dy);
          rawSpeed = dist / dt;
          // Auto-heading: derive bearing from the movement vector so the
          // dog always faces its travel direction. Only update when the
          // step is large enough to be meaningful — micro-jitter is ignored
          // so the model doesn't spin in place.
          if (opts.autoHeading && now - lastExplicitBearingTs > 250 && dist >= opts.headingMinStep) {
            // atan2(dx_east, dy_north) → bearing in degrees clockwise from north
            const deg = (Math.atan2(dx, dy) * 180) / Math.PI;
            bearing = (deg + 360) % 360;
          }
          lastSpeedTs = now;
          lastPosForSpeed = p;
        }
      } else {
        lastPosForSpeed = p;
        lastSpeedTs = now;
      }
      lng = p[0]; lat = p[1];
    },
    setBearing(d) {
      bearing = ((d % 360) + 360) % 360;
      lastExplicitBearingTs = performance.now();
    },
    setVisible(v) { visible = v; if (mapRef) mapRef.triggerRepaint(); },
    setOptions(o) {
      Object.assign(opts, o);
      if (modelGroup && o.modelYawOffset !== undefined) {
        modelGroup.rotation.y = opts.modelYawOffset;
      }
    },
  };
}
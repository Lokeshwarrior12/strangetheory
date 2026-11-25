import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Eye, EyeOff, Network, Brain, RotateCcw, Sparkles, ArrowRight, X } from 'lucide-react';
import type { CategoryWithCount } from '../../lib/api';
import { api } from '../../lib/api';
import { useMotionPreference } from '../ui/MotionContext';

interface NeuralBrainCanvasProps {
  categories: CategoryWithCount[];
  selectedCategorySlug: string | null;
  onSelectCategory: (slug: string) => void;
  onOpenPostSlug: (slug: string, kind: 'experiment' | 'riddle') => void;
  initialMode?: 'brain' | 'graph';
  heightClass?: string;
  enableScrollMotion?: boolean;
  regionGlow?: Record<string, number>;
}

type CameraPreset = 'overview' | 'cortex' | 'horizon';

interface GraphData {
  nodes: Array<{
    id: string;
    kind: 'category' | 'experiment' | 'riddle';
    label: string;
    slug: string;
    color: string;
    weight: number;
  }>;
  edges: Array<{ source: string; target: string }>;
}

interface PreviewNode {
  kind: 'experiment' | 'riddle';
  slug: string;
  title: string;
  subtitle: string;
  color: string;
}

const _mat4 = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _euler = new THREE.Euler();
const _targetCamPos = new THREE.Vector3();
const _targetLookAt = new THREE.Vector3();
const _rayPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const _rayHit = new THREE.Vector3();

function detectLowPowerOrSoftware(): { isSoftwareGl: boolean; isLowPower: boolean; hasWebGL: boolean } {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return { isSoftwareGl: true, isLowPower: true, hasWebGL: false };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    const isSoftwareGl = /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
    return { isSoftwareGl, isLowPower: isSoftwareGl || cores <= 4, hasWebGL: true };
  } catch {
    return { isSoftwareGl: true, isLowPower: true, hasWebGL: false };
  }
}

function sampleBrainPoint(index: number, total: number): THREE.Vector3 {
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const t = (index + 0.5) / total;
  const yNorm = 1 - 2 * t;
  const radiusAtY = Math.sqrt(Math.max(0, 1 - yNorm * yNorm));
  const theta = goldenAngle * index;

  let x = Math.cos(theta) * radiusAtY;
  let y = yNorm;
  let z = Math.sin(theta) * radiusAtY;

  const side = x >= 0 ? 1 : -1;
  const fissure = 0.085 * side;

  x = x * 1.18 + fissure;
  y = y * 0.92 + (z > 0 ? 0.08 : -0.04);
  z = z * 1.48;

  const fold =
    1 +
    0.055 * Math.sin(x * 7.2 + y * 5.4) * Math.cos(z * 6.1) +
    0.03 * Math.cos(y * 11.0 - z * 4.5);

  const radialShell = index % 5 === 0 ? 0.65 + (index % 7) * 0.04 : 0.92 + ((index * 13) % 10) * 0.008;

  return new THREE.Vector3(x * fold * radialShell, y * fold * radialShell, z * fold * radialShell);
}

export function NeuralBrainCanvas({
  categories,
  selectedCategorySlug,
  onSelectCategory,
  onOpenPostSlug,
  initialMode = 'brain',
  heightClass = 'h-[540px] lg:h-[620px]',
  enableScrollMotion = false,
  regionGlow,
}: NeuralBrainCanvasProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<'brain' | 'graph'>(initialMode);
  const [preset, setPreset] = useState<CameraPreset>('overview');
  const { reducedMotion, toggleReducedMotion } = useMotionPreference();
  const [dockCollapsed, setDockCollapsed] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 640 : false
  );
  const [webglFailed, setWebglFailed] = useState(false);
  const [hoveredItem, setHoveredItem] = useState<{
    title: string;
    subtitle: string;
    color: string;
  } | null>(null);
  const [selectedGraphNode, setSelectedGraphNode] = useState<PreviewNode | null>(null);
  const [graphData, setGraphData] = useState<GraphData | null>(null);

  const callbacksRef = useRef({ onSelectCategory, onOpenPostSlug });
  callbacksRef.current = { onSelectCategory, onOpenPostSlug };

  const stateRef = useRef({
    mode,
    preset,
    reducedMotion,
    selectedCategorySlug,
    categories,
    graphData,
    regionGlow,
    transitionActive: false,
    userInteracted: false,
    scrollProgress: 0,
    enableScrollMotion,
  });
  stateRef.current = {
    mode,
    preset,
    reducedMotion,
    selectedCategorySlug,
    categories,
    graphData,
    regionGlow,
    transitionActive: stateRef.current.transitionActive,
    userInteracted: stateRef.current.userInteracted,
    scrollProgress: stateRef.current.scrollProgress,
    enableScrollMotion,
  };

  const triggerPresetRef = useRef<(p: CameraPreset) => void>(() => {});
  const rebuildGraphRef = useRef<(g: GraphData) => void>(() => {});
  const updateModeVisibilityRef = useRef<(m: 'brain' | 'graph') => void>(() => {});

  useEffect(() => {
    if (!enableScrollMotion) return;
    const onScroll = () => {
      const pct = Math.min(1, Math.max(0, window.scrollY / 620));
      stateRef.current.scrollProgress = pct;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, [enableScrollMotion]);

  useEffect(() => {
    if (mode === 'graph' && !graphData) {
      api
        .getGraph()
        .then((res) => {
          setGraphData(res);
          rebuildGraphRef.current(res);
        })
        .catch(() => {});
    }
    updateModeVisibilityRef.current(mode);
  }, [mode, graphData]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.key.toLowerCase() === 'h' &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA'
      ) {
        setDockCollapsed((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const { isSoftwareGl, isLowPower, hasWebGL } = detectLowPowerOrSoftware();
    if (!hasWebGL) {
      setWebglFailed(true);
      return;
    }

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        powerPreference: 'high-performance',
        alpha: false,
      });
    } catch {
      setWebglFailed(true);
      return;
    }

    const width = container.clientWidth || 1200;
    const height = container.clientHeight || 560;

    renderer.setSize(width, height);
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;
    renderer.setClearColor(0x070b14, 1);

    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const handleContextLost = (e: Event) => {
      e.preventDefault();
      setWebglFailed(true);
    };
    renderer.domElement.addEventListener('webglcontextlost', handleContextLost);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x070b14);
    scene.fog = new THREE.FogExp2(0x070b14, 0.082);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    const isMobileViewport = width < 768;
    const baseCamZ = isMobileViewport ? 5.65 : 4.45;
    const camera = new THREE.PerspectiveCamera(44, width / height, 0.1, 100);
    camera.position.set(0.35, 0.65, baseCamZ);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.minDistance = 2.4;
    controls.maxDistance = 7.5;
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.06;
    controls.autoRotate = false;

    controls.addEventListener('start', () => {
      stateRef.current.transitionActive = false;
      stateRef.current.userInteracted = true;
    });

    const hemiLight = new THREE.HemisphereLight(0x93c5fd, 0x070b14, 0.9);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfef3c7, 2.0);
    keyLight.position.set(4.5, 5.5, 4.0);
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x22d3ee, 1.45);
    rimLight.position.set(-4.5, 2.2, -3.5);
    scene.add(rimLight);

    const attractorLight = new THREE.PointLight(0xa78bfa, 2.5, 4.0, 1.8);
    attractorLight.position.set(0, 0.4, 2.2);
    scene.add(attractorLight);

    // Horizon stage rings
    const stageGroup = new THREE.Group();
    const gridRingGeo = new THREE.RingGeometry(1.75, 1.78, 72);
    gridRingGeo.rotateX(-Math.PI / 2);
    const gridRingMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.7,
      metalness: 0.3,
      transparent: true,
      opacity: 0.48,
      side: THREE.DoubleSide,
    });
    const gridRing = new THREE.Mesh(gridRingGeo, gridRingMat);
    gridRing.position.y = -1.45;
    stageGroup.add(gridRing);

    const outerRingGeo = new THREE.RingGeometry(2.35, 2.365, 96);
    outerRingGeo.rotateX(-Math.PI / 2);
    const outerRing = new THREE.Mesh(outerRingGeo, gridRingMat);
    outerRing.position.y = -1.47;
    stageGroup.add(outerRing);
    scene.add(stageGroup);

    // --- HERO BRAIN GROUP ---
    const brainGroup = new THREE.Group();
    scene.add(brainGroup);

    const particleCount = isMobileViewport ? 680 : isLowPower ? 1400 : 2600;
    const particleGeo = new THREE.IcosahedronGeometry(0.022, 0);
    const particleMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.32,
      metalness: 0.25,
      emissive: 0x1e293b,
      emissiveIntensity: 0.5,
    });

    const brainParticles = new THREE.InstancedMesh(particleGeo, particleMat, particleCount);
    brainParticles.frustumCulled = false;

    const basePositions: THREE.Vector3[] = [];
    const regionCoords = stateRef.current.categories.map((c) => ({
      pos: new THREE.Vector3(...c.position),
      color: new THREE.Color(c.color),
    }));

    for (let i = 0; i < particleCount; i++) {
      const pt = sampleBrainPoint(i, particleCount);
      basePositions.push(pt);

      let bestColor = regionCoords[0]?.color || new THREE.Color(0x22d3ee);
      let bestDist = Infinity;
      for (const rc of regionCoords) {
        const d = pt.distanceToSquared(rc.pos);
        if (d < bestDist) {
          bestDist = d;
          bestColor = rc.color;
        }
      }
      const blended = new THREE.Color(0xe0f2fe).lerp(bestColor, 0.78);

      _pos.copy(pt);
      _quat.identity();
      const s = 0.75 + ((i * 17) % 10) * 0.055;
      _scale.set(s, s, s);
      _mat4.compose(_pos, _quat, _scale);
      brainParticles.setMatrixAt(i, _mat4);
      brainParticles.setColorAt(i, blended);
    }
    brainParticles.instanceMatrix.needsUpdate = true;
    if (brainParticles.instanceColor) brainParticles.instanceColor.needsUpdate = true;
    brainParticles.computeBoundingSphere();
    brainGroup.add(brainParticles);

    const connectionCount = isMobileViewport ? 55 : isLowPower ? 95 : 165;
    const connectionLinePositions = new Float32Array(connectionCount * 6);
    const connectionPairs: Array<{ a: THREE.Vector3; b: THREE.Vector3; speed: number; offset: number }> = [];

    for (let i = 0; i < connectionCount; i++) {
      const idxA = (i * 13) % particleCount;
      const pA = basePositions[idxA];
      let bestB = basePositions[(idxA + 7) % particleCount];
      let bestD = Infinity;
      for (let step = 1; step <= 24; step++) {
        const cand = basePositions[(idxA + step * 11) % particleCount];
        const d = pA.distanceToSquared(cand);
        if (d > 0.08 && d < bestD) {
          bestD = d;
          bestB = cand;
        }
      }
      connectionPairs.push({
        a: pA,
        b: bestB,
        speed: 0.28 + (i % 7) * 0.06,
        offset: (i * 0.19) % 1,
      });
      connectionLinePositions[i * 6] = pA.x;
      connectionLinePositions[i * 6 + 1] = pA.y;
      connectionLinePositions[i * 6 + 2] = pA.z;
      connectionLinePositions[i * 6 + 3] = bestB.x;
      connectionLinePositions[i * 6 + 4] = bestB.y;
      connectionLinePositions[i * 6 + 5] = bestB.z;
    }

    const axonGeo = new THREE.BufferGeometry();
    axonGeo.setAttribute('position', new THREE.BufferAttribute(connectionLinePositions, 3));
    const axonMat = new THREE.LineBasicMaterial({
      color: 0x22d3ee,
      transparent: true,
      opacity: 0.17,
    });
    const axonLines = new THREE.LineSegments(axonGeo, axonMat);
    brainGroup.add(axonLines);

    const pulseGeo = new THREE.SphereGeometry(0.028, 8, 8);
    const pulseMat = new THREE.MeshStandardMaterial({
      color: 0xfef3c7,
      emissive: 0xf59e0b,
      emissiveIntensity: 1.9,
      roughness: 0.2,
      metalness: 0.1,
    });
    const pulseMesh = new THREE.InstancedMesh(pulseGeo, pulseMat, connectionCount);
    pulseMesh.frustumCulled = false;
    brainGroup.add(pulseMesh);

    const regionInteractables: THREE.Mesh[] = [];
    const regionGroups: Array<{
      group: THREE.Group;
      ring: THREE.Mesh;
      core: THREE.Mesh;
      cat: CategoryWithCount;
    }> = [];

    const coreGeo = new THREE.OctahedronGeometry(0.1, 0);
    const ringGeo = new THREE.TorusGeometry(0.155, 0.014, 10, 32);
    const hitGeo = new THREE.SphereGeometry(0.24, 12, 12);
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });

    for (const cat of stateRef.current.categories) {
      const g = new THREE.Group();
      g.position.set(cat.position[0] * 1.08, cat.position[1] * 1.08, cat.position[2] * 1.08);

      const coreMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(cat.color),
        emissive: new THREE.Color(cat.color),
        emissiveIntensity: 0.85,
        roughness: 0.22,
        metalness: 0.15,
      });
      const coreMesh = new THREE.Mesh(coreGeo, coreMat);
      g.add(coreMesh);

      const ringMat = new THREE.MeshStandardMaterial({
        color: 0xe2e8f0,
        roughness: 0.25,
        metalness: 0.85,
      });
      const ringMesh = new THREE.Mesh(ringGeo, ringMat);
      ringMesh.rotation.x = Math.PI / 2.4;
      g.add(ringMesh);

      const stemGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.16, 6);
      const stemMat = new THREE.MeshStandardMaterial({
        color: 0x64748b,
        roughness: 0.65,
        metalness: 0.4,
      });
      const stemMesh = new THREE.Mesh(stemGeo, stemMat);
      stemMesh.position.y = -0.11;
      g.add(stemMesh);

      const hitProxy = new THREE.Mesh(hitGeo, hitMat);
      hitProxy.userData = {
        kind: 'category',
        slug: cat.slug,
        title: cat.name,
        subtitle: `${cat.brain_region} · ${cat.post_count} ${cat.post_count === 1 ? 'entry' : 'entries'}`,
        color: cat.color,
      };
      g.add(hitProxy);
      regionInteractables.push(hitProxy);

      brainGroup.add(g);
      regionGroups.push({ group: g, ring: ringMesh, core: coreMesh, cat });
    }

    // --- IDEA GRAPH GROUP ---
    const graphGroup = new THREE.Group();
    graphGroup.visible = false;
    scene.add(graphGroup);
    let graphInteractables: THREE.Mesh[] = [];

    const buildGraphScene = (data: GraphData) => {
      while (graphGroup.children.length > 0) {
        graphGroup.remove(graphGroup.children[0]);
      }
      graphInteractables = [];

      const posMap = new Map<string, THREE.Vector3>();
      const catNodes = data.nodes.filter((n) => n.kind === 'category');
      catNodes.forEach((n, idx) => {
        const angle = (idx / Math.max(1, catNodes.length)) * Math.PI * 2;
        const p = new THREE.Vector3(Math.cos(angle) * 1.48, Math.sin(idx * 1.3) * 0.65, Math.sin(angle) * 1.48);
        posMap.set(n.id, p);
      });

      const postNodes = data.nodes.filter((n) => n.kind !== 'category');
      postNodes.forEach((n, idx) => {
        const edge = data.edges.find((e) => e.source === n.id);
        const hubPos = (edge && posMap.get(edge.target)) || new THREE.Vector3(0, 0, 0);
        const theta = idx * 2.39996;
        const r = 0.55 + (idx % 4) * 0.22;
        const p = new THREE.Vector3(
          hubPos.x + Math.cos(theta) * r,
          hubPos.y + Math.sin(idx * 1.7) * 0.48,
          hubPos.z + Math.sin(theta) * r
        );
        posMap.set(n.id, p);
      });

      const edgeVerts: number[] = [];
      for (const e of data.edges) {
        const a = posMap.get(e.source);
        const b = posMap.get(e.target);
        if (a && b) edgeVerts.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
      const edgeGeo = new THREE.BufferGeometry();
      edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(edgeVerts, 3));
      const edgeLine = new THREE.LineSegments(
        edgeGeo,
        new THREE.LineBasicMaterial({ color: 0x475569, transparent: true, opacity: 0.45 })
      );
      graphGroup.add(edgeLine);

      const nodeGeoCat = new THREE.OctahedronGeometry(0.11, 0);
      const nodeGeoPost = new THREE.SphereGeometry(0.065, 14, 14);
      const nodeGeoRiddle = new THREE.BoxGeometry(0.095, 0.095, 0.095);

      for (const n of data.nodes) {
        const p = posMap.get(n.id);
        if (!p) continue;
        const mat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(n.color),
          emissive: new THREE.Color(n.color),
          emissiveIntensity: n.kind === 'category' ? 0.85 : 0.45,
          roughness: n.kind === 'category' ? 0.25 : 0.45,
          metalness: n.kind === 'category' ? 0.6 : 0.2,
        });
        const geo = n.kind === 'category' ? nodeGeoCat : n.kind === 'riddle' ? nodeGeoRiddle : nodeGeoPost;
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.copy(p);
        mesh.scale.setScalar(n.kind === 'category' ? 1.15 : 0.85 + Math.min(0.45, n.weight * 0.12));
        mesh.userData = {
          kind: n.kind,
          slug: n.slug,
          title: n.label,
          subtitle:
            n.kind === 'category'
              ? 'Brain-Region Hub · Click to filter'
              : n.kind === 'riddle'
                ? 'Lateral Riddle · Preview ready'
                : 'Thought Experiment · Preview ready',
          color: n.color,
        };
        graphGroup.add(mesh);
        graphInteractables.push(mesh);
      }
      brainGroup.visible = stateRef.current.mode === 'brain';
      graphGroup.visible = stateRef.current.mode === 'graph';
    };
    rebuildGraphRef.current = buildGraphScene;

    updateModeVisibilityRef.current = (m) => {
      brainGroup.visible = m === 'brain';
      graphGroup.visible = m === 'graph';
      if (m === 'brain') setSelectedGraphNode(null);
    };
    updateModeVisibilityRef.current(stateRef.current.mode);
    if (stateRef.current.graphData) {
      buildGraphScene(stateRef.current.graphData);
    }

    triggerPresetRef.current = (p: CameraPreset) => {
      stateRef.current.transitionActive = true;
      stateRef.current.userInteracted = true;
      if (p === 'overview') {
        _targetCamPos.set(0.35, 0.75, baseCamZ);
        _targetLookAt.set(0, 0, 0);
      } else if (p === 'cortex') {
        _targetCamPos.set(0.0, 3.25, 2.55);
        _targetLookAt.set(0, 0.1, 0);
      } else {
        _targetCamPos.set(-3.45, 0.35, 2.75);
        _targetLookAt.set(0, 0, 0);
      }
    };

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let lastHoverTime = 0;
    let pointerDownPos = { x: 0, y: 0 };

    const updatePointer = (clientX: number, clientY: number) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    };

    const onPointerMove = (e: PointerEvent) => {
      const now = performance.now();
      if (now - lastHoverTime < 45) return;
      lastHoverTime = now;

      updatePointer(e.clientX, e.clientY);
      raycaster.setFromCamera(pointer, camera);

      if (raycaster.ray.intersectPlane(_rayPlane, _rayHit)) {
        attractorLight.position.x = THREE.MathUtils.clamp(_rayHit.x, -2.5, 2.5);
        attractorLight.position.y = THREE.MathUtils.clamp(_rayHit.y, -2.0, 2.0);
        attractorLight.position.z = 1.9;
      }

      const targets = stateRef.current.mode === 'brain' ? regionInteractables : graphInteractables;
      const hits = raycaster.intersectObjects(targets, false);
      if (hits.length > 0) {
        const ud = hits[0].object.userData;
        renderer.domElement.style.cursor = 'pointer';
        setHoveredItem({ title: ud.title, subtitle: ud.subtitle, color: ud.color });
      } else {
        renderer.domElement.style.cursor = 'grab';
        setHoveredItem(null);
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      pointerDownPos = { x: e.clientX, y: e.clientY };
    };

    const onPointerUp = (e: PointerEvent) => {
      const dist = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
      if (dist > 6) return;

      updatePointer(e.clientX, e.clientY);
      raycaster.setFromCamera(pointer, camera);
      const targets = stateRef.current.mode === 'brain' ? regionInteractables : graphInteractables;
      const hits = raycaster.intersectObjects(targets, false);
      if (hits.length > 0) {
        const ud = hits[0].object.userData;
        if (ud.kind === 'category') {
          callbacksRef.current.onSelectCategory(ud.slug);
        } else if (ud.kind === 'experiment' || ud.kind === 'riddle') {
          // Click previews the node first, then lets user open it cleanly
          setSelectedGraphNode({
            kind: ud.kind,
            slug: ud.slug,
            title: ud.title,
            subtitle: ud.kind === 'riddle' ? 'Lateral Riddle' : 'Thought Experiment',
            color: ud.color,
          });
        }
      }
    };

    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    let isVisible = true;
    const onVisibilityChange = () => {
      isVisible = !document.hidden;
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    const observer = new IntersectionObserver(
      (entries) => {
        isVisible = entries[0]?.isIntersecting ?? true;
      },
      { threshold: 0.05 }
    );
    observer.observe(container);

    const onResize = () => {
      if (!container) return;
      const w = container.clientWidth || 1200;
      const h = container.clientHeight || 560;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    let frameId = 0;
    let disposed = false;
    let lastTimeMs = performance.now();
    let elapsedTotal = 0;

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync ? gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0) : null;
      gl.flush();
      const poll = () => {
        if (disposed) return;
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (sync && state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    const tick = () => {
      if (disposed) return;

      const nowMs = performance.now();
      const delta = Math.min((nowMs - lastTimeMs) / 1000, 0.1);
      lastTimeMs = nowMs;
      const isCalm = stateRef.current.reducedMotion;

      if (isVisible) {
        if (!isCalm) {
          elapsedTotal += delta;
          if (stateRef.current.mode === 'brain') {
            brainGroup.rotation.y += delta * 0.14;

            for (let i = 0; i < connectionCount; i++) {
              const pair = connectionPairs[i];
              const prog = (elapsedTotal * pair.speed + pair.offset) % 1;
              _pos.lerpVectors(pair.a, pair.b, prog);
              _quat.identity();
              const pulseScale = 0.7 + Math.sin(prog * Math.PI) * 0.7;
              _scale.setScalar(pulseScale);
              _mat4.compose(_pos, _quat, _scale);
              pulseMesh.setMatrixAt(i, _mat4);
            }
            pulseMesh.instanceMatrix.needsUpdate = true;

            for (const rg of regionGroups) {
              rg.ring.rotation.z += delta * 0.85;
              const isSelected = stateRef.current.selectedCategorySlug === rg.cat.slug;
              const glowMap = stateRef.current.regionGlow;
              const glowVal = glowMap ? glowMap[rg.cat.slug] ?? glowMap[rg.cat.id] ?? 0 : null;
              const coreMat = rg.core.material as THREE.MeshStandardMaterial;
              if (glowVal !== null) {
                coreMat.emissiveIntensity = glowVal > 0 ? 0.9 + glowVal * 2.3 : 0.25;
              } else {
                coreMat.emissiveIntensity = isSelected ? 1.6 : 0.85;
              }
              const targetScale = isSelected ? 1.42 : glowVal !== null ? 0.9 + glowVal * 0.48 : 1.0;
              rg.group.scale.x = THREE.MathUtils.damp(rg.group.scale.x, targetScale, 8, delta);
              rg.group.scale.y = rg.group.scale.x;
              rg.group.scale.z = rg.group.scale.x;
            }
          } else {
            graphGroup.rotation.y += delta * 0.11;
          }

          // Scroll-driven camera movement when user hasn't manually hijacked orbit
          if (stateRef.current.enableScrollMotion && !stateRef.current.userInteracted && !stateRef.current.transitionActive) {
            const sp = stateRef.current.scrollProgress;
            const targetX = 0.35 + sp * 1.15;
            const targetY = 0.65 + sp * 0.9;
            const targetZ = baseCamZ - sp * 0.7;
            camera.position.x = THREE.MathUtils.damp(camera.position.x, targetX, 4, delta);
            camera.position.y = THREE.MathUtils.damp(camera.position.y, targetY, 4, delta);
            camera.position.z = THREE.MathUtils.damp(camera.position.z, targetZ, 4, delta);
          }
        }

        if (stateRef.current.transitionActive) {
          camera.position.x = THREE.MathUtils.damp(camera.position.x, _targetCamPos.x, 5, delta);
          camera.position.y = THREE.MathUtils.damp(camera.position.y, _targetCamPos.y, 5, delta);
          camera.position.z = THREE.MathUtils.damp(camera.position.z, _targetCamPos.z, 5, delta);
          controls.target.x = THREE.MathUtils.damp(controls.target.x, _targetLookAt.x, 5, delta);
          controls.target.y = THREE.MathUtils.damp(controls.target.y, _targetLookAt.y, 5, delta);
          controls.target.z = THREE.MathUtils.damp(controls.target.z, _targetLookAt.z, 5, delta);
          if (camera.position.distanceTo(_targetCamPos) < 0.02) {
            stateRef.current.transitionActive = false;
          }
        }

        controls.update();
        renderer.render(scene, camera);
      }

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    };

    _euler.set(0, 0, 0);
    if (isSoftwareGl) {
      renderer.render(scene, camera);
      afterDraw(tick);
    } else {
      frameId = requestAnimationFrame(tick);
    }

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      observer.disconnect();
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
      controls.dispose();
      particleGeo.dispose();
      particleMat.dispose();
      axonGeo.dispose();
      axonMat.dispose();
      pulseGeo.dispose();
      pulseMat.dispose();
      coreGeo.dispose();
      ringGeo.dispose();
      hitGeo.dispose();
      hitMat.dispose();
      gridRingGeo.dispose();
      outerRingGeo.dispose();
      gridRingMat.dispose();
      renderer.dispose();
    };
  }, []);

  return (
    <div className={`relative w-full ${heightClass} overflow-hidden bg-[#070B14] text-slate-100 select-none`}>
      <div
        ref={mountRef}
        data-testid="neural-brain-canvas"
        aria-label="Interactive 3D Neural Observatory of StrangeTheory categories"
        className="w-full h-full"
      />

      {webglFailed && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#070B14] p-8 text-center">
          <img
            src="/src/assets/images/cover_neural_synapse_1794881588195.jpg"
            alt="StrangeTheory Observatory fallback visual"
            referrerPolicy="no-referrer"
            className="absolute inset-0 h-full w-full object-cover opacity-35"
          />
          <div className="relative z-10 max-w-md space-y-2 rounded-xl border border-white/15 bg-[#070B14]/85 p-6">
            <p className="font-display text-2xl text-white">Neural Observatory</p>
            <p className="text-sm text-slate-300">
              Hardware 3D acceleration is currently unavailable. Use the Brain Region index below to explore all ten domains.
            </p>
          </div>
        </div>
      )}

      {hoveredItem && !selectedGraphNode && (
        <div
          role="status"
          className="pointer-events-none absolute top-5 right-5 z-20 max-w-xs rounded-lg border border-white/15 bg-[#070B14]/92 px-4 py-2.5 shadow-lg"
        >
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: hoveredItem.color }}
            />
            <span className="text-sm font-semibold text-white truncate">{hoveredItem.title}</span>
          </div>
          <p className="mt-0.5 text-xs text-slate-300">{hoveredItem.subtitle}</p>
        </div>
      )}

      {/* Idea Graph Click-to-Preview Card */}
      {selectedGraphNode && (
        <div className="absolute top-5 right-5 z-30 w-80 max-w-[90vw] rounded-xl border border-[#22D3EE]/35 bg-[#0E1525]/96 p-4 shadow-2xl">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: selectedGraphNode.color }} />
              <span className="font-mono text-xs text-slate-300">{selectedGraphNode.subtitle}</span>
            </div>
            <button
              type="button"
              onClick={() => setSelectedGraphNode(null)}
              aria-label="Close preview"
              className="rounded p-1 text-slate-400 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <h4 className="mt-2 font-display text-base font-semibold leading-snug text-white">
            {selectedGraphNode.title}
          </h4>
          <button
            type="button"
            onClick={() => onOpenPostSlug(selectedGraphNode.slug, selectedGraphNode.kind)}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-[#22D3EE] px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-cyan-300"
          >
            Open Entry
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Collapsible Bottom Control Dock */}
      <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex flex-col items-center px-4">
        <button
          type="button"
          onClick={() => setDockCollapsed((v) => !v)}
          className="pointer-events-auto mb-2 inline-flex items-center gap-1.5 rounded-md border border-white/15 bg-[#070B14]/92 px-3 py-1 text-xs font-medium text-slate-200 hover:bg-[#0E1525] focus-visible:outline-2 focus-visible:outline-[#22D3EE] whitespace-nowrap shrink-0"
          aria-expanded={!dockCollapsed}
        >
          {dockCollapsed ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          {dockCollapsed ? 'Show 3D Controls' : 'Hide Controls'}
        </button>

        {!dockCollapsed && (
          <div className="pointer-events-auto flex flex-wrap sm:flex-nowrap items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-[#070B14]/92 px-2.5 py-1.5 shadow-xl max-w-[96vw]">
            <div className="flex items-center gap-1 rounded-lg bg-[#0E1525] p-0.5">
              <button
                type="button"
                onClick={() => setMode('brain')}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  mode === 'brain' ? 'bg-[#22D3EE] text-slate-950 font-semibold' : 'text-slate-300 hover:text-white'
                }`}
              >
                <Brain className="h-3.5 w-3.5" />
                Brain Regions
              </button>
              <button
                type="button"
                onClick={() => setMode('graph')}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  mode === 'graph' ? 'bg-[#22D3EE] text-slate-950 font-semibold' : 'text-slate-300 hover:text-white'
                }`}
              >
                <Network className="h-3.5 w-3.5" />
                Idea Graph
              </button>
            </div>

            <span aria-hidden="true" className="hidden sm:inline-block h-4 w-px bg-white/15" />

            <div className="flex items-center gap-0.5">
              {(['overview', 'cortex', 'horizon'] as CameraPreset[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => {
                    setPreset(p);
                    triggerPresetRef.current(p);
                  }}
                  className={`rounded-md px-2 py-1 text-xs font-medium capitalize transition-colors whitespace-nowrap shrink-0 ${
                    preset === p ? 'bg-white/15 text-white' : 'text-slate-300 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  {p}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setPreset('overview');
                  stateRef.current.userInteracted = false;
                  triggerPresetRef.current('overview');
                }}
                aria-label="Reset camera"
                className="rounded-md p-1.5 text-slate-300 hover:bg-white/10 hover:text-white"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            </div>

            <span aria-hidden="true" className="hidden sm:inline-block h-4 w-px bg-white/15" />

            <button
              type="button"
              onClick={toggleReducedMotion}
              aria-pressed={reducedMotion}
              className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                reducedMotion
                  ? 'bg-amber-500/20 text-amber-200 border border-amber-400/35'
                  : 'text-slate-300 hover:bg-white/10 hover:text-white'
              }`}
            >
              <Sparkles className="h-3.5 w-3.5" />
              {reducedMotion ? 'Paused' : 'Pause Motion'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default NeuralBrainCanvas;

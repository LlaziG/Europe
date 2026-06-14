"use client";

import {
  Component,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { MeshReflectorMaterial, Text, useTexture } from "@react-three/drei";
import type { Artwork, Chapter, MuseumEntity } from "@/lib/types";
import {
  artDisplayTitle,
  cleanDateLabel,
  thumbAt,
} from "@/components/timeline/timeline-utils";

const WALL = "#393429";
const EYE = 1.65;
const POOL_SPOTS = 12;
const POOL_PENDANTS = 5;

export type HallHover = {
  key: string; // stable id of the focused piece (for narration de-dup)
  label: string;
  verb: "inspect" | "read";
  narration: string; // the sourced text to read aloud
  audioUrl?: string; // pre-recorded ElevenLabs clip, if one exists
};
export type HallTarget =
  | { kind: "art"; art: Artwork; chapter: Chapter | null }
  | { kind: "chapter"; chapter: Chapter };

type Clickable = {
  mesh: THREE.Mesh;
  glow: THREE.MeshStandardMaterial | null;
  payload: HallTarget;
};
export type Registry = Map<string, Clickable>;

export type HallColumn = {
  arts: Artwork[]; // 1–2 pieces (salon hang stacks two)
  chapter: Chapter | null; // the chapter this piece belongs to (audio context)
  side: number;
  x: number;
  z: number;
  rotY: number;
};

export type HallLayout = {
  width: number;
  length: number;
  height: number;
  salon: boolean;
  columns: HallColumn[];
};

// A clean visual gallery: framed works on the walls, no paragraphs of text —
// the history is heard, not read. Each column still maps to a chapter so the
// audioguide can place the piece in its part of the story.
export function buildLayout(artworks: Artwork[], chapters: Chapter[]): HallLayout {
  const width = 10.6;
  const height = 4.6;
  const salon = artworks.length > 26; // double-hang large collections
  const SPACING = 3.45;
  const group = salon ? 2 : 1;

  const artCols: Artwork[][] = [];
  for (let i = 0; i < artworks.length; i += group)
    artCols.push(artworks.slice(i, i + group));

  const perSide = Math.max(1, Math.ceil(artCols.length / 2));
  const length = Math.max(19, perSide * SPACING + 12);
  const zStart = length / 2 - 5.6;
  const columns: HallColumn[] = artCols.map((arts, k) => {
    const side = k % 2;
    const chapter = chapters.length
      ? chapters[Math.min(chapters.length - 1, Math.floor((k / artCols.length) * chapters.length))]
      : null;
    return {
      arts,
      chapter,
      side,
      x: side === 0 ? -width / 2 + 0.07 : width / 2 - 0.07,
      z: zStart - Math.floor(k / 2) * SPACING,
      rotY: side === 0 ? Math.PI / 2 : -Math.PI / 2,
    };
  });
  return { width, length, height, salon, columns };
}

// Track-mounted fixture: stem, angled housing, glowing lens. The real lights
// live in a pooled rig that follows the visitor, so cost stays constant.
function TrackFixture({
  position,
  targetPos,
}: {
  position: [number, number, number];
  targetPos: [number, number, number];
}) {
  const tilt = Math.atan2(
    -(targetPos[2] - position[2]),
    -(targetPos[1] - position[1])
  );
  return (
    <group position={position}>
      <mesh position={[0, 0.09, 0]}>
        <cylinderGeometry args={[0.016, 0.016, 0.2, 8]} />
        <meshStandardMaterial color="#191613" metalness={0.7} roughness={0.45} />
      </mesh>
      <group rotation-x={tilt}>
        <mesh position={[0, -0.13, 0]}>
          <cylinderGeometry args={[0.068, 0.092, 0.26, 16]} />
          <meshStandardMaterial color="#221e19" metalness={0.75} roughness={0.4} />
        </mesh>
        <mesh position={[0, -0.262, 0]} rotation-x={Math.PI / 2}>
          <circleGeometry args={[0.066, 16]} />
          <meshBasicMaterial color="#ffe3b0" toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}

function StaticSpot({
  position,
  targetPos,
  intensity,
  angle,
  distance = 10,
}: {
  position: [number, number, number];
  targetPos: [number, number, number];
  intensity: number;
  angle: number;
  distance?: number;
}) {
  const target = useMemo(() => new THREE.Object3D(), []);
  return (
    <group position={position}>
      <spotLight
        position={[0, -0.2, 0]}
        angle={angle}
        penumbra={0.55}
        intensity={intensity}
        distance={distance}
        decay={1.8}
        color="#ffeecf"
        target={target}
      />
      <primitive
        object={target}
        position={[
          targetPos[0] - position[0],
          targetPos[1] - position[1],
          targetPos[2] - position[2],
        ]}
      />
    </group>
  );
}

class ArtBoundary extends Component<{ children: ReactNode }, { dead: boolean }> {
  state = { dead: false };
  static getDerivedStateFromError() {
    return { dead: true };
  }
  render() {
    return this.state.dead ? null : this.props.children;
  }
}

function Painting({
  art,
  chapter,
  y,
  maxH,
  texW,
  entityEnd,
  registry,
}: {
  art: Artwork;
  chapter: Chapter | null;
  y: number;
  maxH: number;
  texW: number;
  entityEnd: number;
  registry: Registry;
}) {
  const gl = useThree((s) => s.gl);
  const url =
    thumbAt(art.thumbUrl ?? art.imageUrl, texW, art.width) ?? art.imageUrl ?? "";
  const tex = useTexture(url, (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
  });

  const aspect = art.width && art.height ? art.width / art.height : 4 / 3;
  let h = Math.min(maxH, aspect > 1.25 ? maxH * 0.85 : maxH);
  let w = h * aspect;
  if (w > 2.7) {
    w = 2.7;
    h = w / aspect;
  }

  const isPainting = art.kind === "painting";
  const canvasRef = useRef<THREE.Mesh | null>(null);
  const frameMat = useRef<THREE.MeshStandardMaterial | null>(null);

  useEffect(() => {
    gl.shadowMap.needsUpdate = true;
    const m = canvasRef.current;
    if (!m) return;
    registry.set(m.uuid, {
      mesh: m,
      glow: frameMat.current,
      payload: { kind: "art", art, chapter },
    });
    const uuid = m.uuid;
    return () => {
      registry.delete(uuid);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, tex, art, chapter]);

  return (
    <group position={[0, y, 0]}>
      <mesh position={[0, 0, 0.035]} castShadow>
        <boxGeometry args={[w + 0.2, h + 0.2, 0.07]} />
        <meshStandardMaterial
          ref={frameMat}
          color={isPainting ? "#7d6434" : "#2e2a24"}
          metalness={isPainting ? 0.82 : 0.45}
          roughness={isPainting ? 0.34 : 0.6}
          emissive="#c8a55f"
          emissiveIntensity={0}
        />
      </mesh>
      <mesh position={[0, 0, 0.062]}>
        <boxGeometry args={[w + 0.07, h + 0.07, 0.022]} />
        <meshStandardMaterial color="#15120e" roughness={0.92} />
      </mesh>
      <mesh position={[0, 0, 0.082]} ref={canvasRef}>
        <planeGeometry args={[w, h]} />
        <meshStandardMaterial map={tex} roughness={0.62} metalness={0.04} />
      </mesh>
      <group position={[0, -h / 2 - 0.27, 0.05]}>
        <mesh>
          <boxGeometry args={[0.78, 0.17, 0.012]} />
          <meshStandardMaterial color="#5d4c27" metalness={0.75} roughness={0.4} />
        </mesh>
        <Text
          position={[0, 0.025, 0.012]}
          fontSize={0.039}
          maxWidth={0.7}
          color="#e7dcbf"
          anchorX="center"
          anchorY="middle"
          textAlign="center"
          clipRect={[-0.36, -0.05, 0.36, 0.05]}
        >
          {(() => {
            const t = artDisplayTitle(art.title, art.story);
            return t.length > 60 ? t.slice(0, 57) + "…" : t;
          })()}
        </Text>
        <Text
          position={[0, -0.048, 0.012]}
          fontSize={0.026}
          color="#a8946a"
          anchorX="center"
          anchorY="middle"
        >
          {/* a photo date far newer than the subject reads wrong on a plaque */}
          {art.year && art.year <= entityEnd + 30
            ? (cleanDateLabel(art.yearLabel) ?? String(art.year))
            : art.kind}
        </Text>
      </group>
    </group>
  );
}

export default function Hall({
  entity,
  layout,
  lockedRef,
  onHover,
  onOpen,
}: {
  entity: MuseumEntity;
  layout: HallLayout;
  lockedRef: React.MutableRefObject<boolean>;
  onHover: (h: HallHover | null) => void;
  onOpen: (t: HallTarget) => void;
}) {
  const { width: W, length: L, height: H, salon, columns } = layout;
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);

  const registry = useMemo<Registry>(() => new Map(), []);
  const colGroups = useRef<(THREE.Group | null)[]>([]);
  const hoverUuid = useRef<string | null>(null);
  const keys = useRef<Record<string, boolean>>({});
  const vel = useRef(new THREE.Vector3());
  const ray = useMemo(() => new THREE.Raycaster(), []);
  const fwd = useMemo(() => new THREE.Vector3(), []);
  const rgt = useMemo(() => new THREE.Vector3(), []);

  // ── pooled lighting rig: constant cost regardless of collection size ──
  const spotTargets = useMemo(
    () => Array.from({ length: POOL_SPOTS }, () => new THREE.Object3D()),
    []
  );
  const spotRefs = useRef<(THREE.SpotLight | null)[]>([]);
  const pendantRefs = useRef<(THREE.PointLight | null)[]>([]);
  const assignKey = useRef("");
  const assignAcc = useRef(1);

  const lightCols = useMemo(
    () =>
      columns.map((c) => ({
        z: c.z,
        mount: [
          c.side === 0 ? -W / 2 + 2.17 : W / 2 - 2.17,
          H - 0.52,
          c.z,
        ] as const,
        target: [c.x, c.arts.length > 1 ? 2.15 : 1.72, c.z] as const,
      })),
    [columns, W, H]
  );
  const pendantZs = useMemo(
    () =>
      Array.from(
        { length: Math.max(2, Math.floor(L / 9)) },
        (_, i) => L / 2 - 4 - i * 9
      ),
    [L]
  );

  const assignLights = () => {
    const camZ = camera.position.z;
    const order = lightCols
      .map((_, i) => i)
      .sort(
        (a, b) =>
          Math.abs(lightCols[a].z - camZ) - Math.abs(lightCols[b].z - camZ)
      )
      .slice(0, POOL_SPOTS);
    const pOrder = pendantZs
      .map((_, i) => i)
      .sort((a, b) => Math.abs(pendantZs[a] - camZ) - Math.abs(pendantZs[b] - camZ))
      .slice(0, POOL_PENDANTS);
    const key = order.join(",") + "|" + pOrder.join(",");
    if (key === assignKey.current) return;
    assignKey.current = key;
    order.forEach((colIdx, i) => {
      const l = spotRefs.current[i];
      if (!l) return;
      const c = lightCols[colIdx];
      l.position.set(c.mount[0], c.mount[1] - 0.2, c.mount[2]);
      l.intensity = 26;
      spotTargets[i].position.set(c.target[0], c.target[1], c.target[2]);
    });
    for (let i = order.length; i < POOL_SPOTS; i++) {
      const l = spotRefs.current[i];
      if (l) l.intensity = 0;
    }
    pOrder.forEach((pi, i) => {
      const l = pendantRefs.current[i];
      if (!l) return;
      l.position.set(0, H - 1.06, pendantZs[pi]);
      l.intensity = 5;
    });
    // cull columns lost in the fog — long halls stay cheap
    colGroups.current.forEach((g, i) => {
      if (g && columns[i]) g.visible = Math.abs(columns[i].z - camZ) < 36;
    });
    gl.shadowMap.needsUpdate = true;
  };

  // static scene → bake shadow maps only when the rig moves
  useEffect(() => {
    gl.shadowMap.autoUpdate = false;
    gl.shadowMap.needsUpdate = true;
    return () => {
      gl.shadowMap.autoUpdate = true;
    };
  }, [gl]);

  useEffect(() => {
    const dn = (e: KeyboardEvent) => (keys.current[e.code] = true);
    const up = (e: KeyboardEvent) => (keys.current[e.code] = false);
    const click = (e: MouseEvent) => {
      if (lockedRef.current) {
        const entry = hoverUuid.current
          ? registry.get(hoverUuid.current)
          : null;
        if (entry) onOpen(entry.payload);
        return;
      }
      if (e.target !== gl.domElement) return;
      const rect = gl.domElement.getBoundingClientRect();
      const p = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      ray.setFromCamera(p, camera);
      const list = [...registry.values()];
      const hits = ray.intersectObjects(
        list.map((c) => c.mesh),
        false
      );
      if (hits.length && hits[0].distance < 17) {
        const entry = list.find((c) => c.mesh === hits[0].object);
        if (entry) onOpen(entry.payload);
      }
    };
    window.addEventListener("keydown", dn);
    window.addEventListener("keyup", up);
    window.addEventListener("click", click);
    return () => {
      window.removeEventListener("keydown", dn);
      window.removeEventListener("keyup", up);
      window.removeEventListener("click", click);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);

    if (lockedRef.current) {
      const k = keys.current;
      const speed = k.ShiftLeft || k.ShiftRight ? 7.0 : 4.2;
      camera.getWorldDirection(fwd);
      fwd.y = 0;
      fwd.normalize();
      rgt.set(-fwd.z, 0, fwd.x);
      const wish = new THREE.Vector3();
      if (k.KeyW || k.ArrowUp) wish.add(fwd);
      if (k.KeyS || k.ArrowDown) wish.sub(fwd);
      if (k.KeyD || k.ArrowRight) wish.add(rgt);
      if (k.KeyA || k.ArrowLeft) wish.sub(rgt);
      if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(speed);
      vel.current.lerp(wish, 1 - Math.exp(-9 * dt));
      camera.position.addScaledVector(vel.current, dt);
    } else {
      vel.current.multiplyScalar(Math.exp(-6 * dt));
    }
    camera.position.x = THREE.MathUtils.clamp(
      camera.position.x,
      -W / 2 + 0.55,
      W / 2 - 0.55
    );
    camera.position.z = THREE.MathUtils.clamp(
      camera.position.z,
      -L / 2 + 0.7,
      L / 2 - 0.7
    );
    camera.position.y = EYE;

    assignAcc.current += dt;
    if (assignAcc.current > 0.3) {
      assignAcc.current = 0;
      assignLights();
    }

    // crosshair hover
    if (lockedRef.current) {
      ray.setFromCamera(new THREE.Vector2(0, 0), camera);
      const list = [...registry.values()];
      const hits = ray.intersectObjects(
        list.map((c) => c.mesh),
        false
      );
      const entry =
        hits.length && hits[0].distance < 5.2
          ? list.find((c) => c.mesh === hits[0].object) ?? null
          : null;
      const uuid = entry?.mesh.uuid ?? null;
      if (uuid !== hoverUuid.current) {
        const prev = hoverUuid.current
          ? registry.get(hoverUuid.current)
          : null;
        if (prev?.glow) prev.glow.emissiveIntensity = 0;
        if (entry?.glow) entry.glow.emissiveIntensity = 0.38;
        hoverUuid.current = uuid;
        onHover(
          entry
            ? entry.payload.kind === "art"
              ? {
                  key: `art:${entry.payload.art.slug}`,
                  label: artDisplayTitle(
                    entry.payload.art.title,
                    entry.payload.art.story
                  ),
                  verb: "inspect",
                  narration:
                    entry.payload.art.narration ??
                    `${artDisplayTitle(entry.payload.art.title, entry.payload.art.story)}. ` +
                      (entry.payload.art.story ?? ""),
                  audioUrl: `/narration/art/${entry.payload.art.id}.mp3`,
                }
              : {
                  key: `chapter:${entry.payload.chapter.id}`,
                  label: entry.payload.chapter.title,
                  verb: "read",
                  narration:
                    entry.payload.chapter.narration ??
                    `${entry.payload.chapter.title}. ${entry.payload.chapter.body}`,
                }
            : null
        );
      }
    } else if (hoverUuid.current) {
      const prev = registry.get(hoverUuid.current);
      if (prev?.glow) prev.glow.emissiveIntensity = 0;
      hoverUuid.current = null;
      onHover(null);
    }
  });

  return (
    <group>
      <fog attach="fog" args={["#0a0908", 16, Math.max(48, L * 0.6)]} />

      {/* reflective floor */}
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[W, L]} />
        <MeshReflectorMaterial
          blur={[0, 0]}
          resolution={512}
          mixBlur={1}
          mixStrength={30}
          roughness={0.86}
          depthScale={1.1}
          minDepthThreshold={0.4}
          maxDepthThreshold={1.25}
          color="#0e0d0b"
          metalness={0.5}
          mirror={0.45}
        />
      </mesh>

      {/* walls + ceiling */}
      <mesh position={[0, H / 2, -L / 2]} receiveShadow>
        <planeGeometry args={[W, H]} />
        <meshStandardMaterial color={WALL} roughness={0.95} />
      </mesh>
      <mesh position={[0, H / 2, L / 2]} rotation-y={Math.PI} receiveShadow>
        <planeGeometry args={[W, H]} />
        <meshStandardMaterial color={WALL} roughness={0.95} />
      </mesh>
      <mesh position={[-W / 2, H / 2, 0]} rotation-y={Math.PI / 2} receiveShadow>
        <planeGeometry args={[L, H]} />
        <meshStandardMaterial color={WALL} roughness={0.95} />
      </mesh>
      <mesh position={[W / 2, H / 2, 0]} rotation-y={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[L, H]} />
        <meshStandardMaterial color={WALL} roughness={0.95} />
      </mesh>
      <mesh position={[0, H, 0]} rotation-x={Math.PI / 2}>
        <planeGeometry args={[W, L]} />
        <meshStandardMaterial color="#161410" roughness={1} />
      </mesh>

      {/* gold gallery rails + light tracks */}
      {[-1, 1].map((s) => (
        <mesh key={`rail${s}`} position={[s * (W / 2 - 0.02), 0.92, 0]}>
          <boxGeometry args={[0.02, 0.02, L - 0.4]} />
          <meshStandardMaterial color="#8a6f3a" metalness={0.85} roughness={0.35} />
        </mesh>
      ))}
      {[-1, 1].map((s) => (
        <mesh key={`track${s}`} position={[s * (W / 2 - 2.17), H - 0.04, 0]}>
          <boxGeometry args={[0.06, 0.05, L - 3]} />
          <meshStandardMaterial color="#15120e" metalness={0.7} roughness={0.5} />
        </mesh>
      ))}

      {/* fill light */}
      <ambientLight intensity={0.16} />
      <hemisphereLight args={["#46402f", "#0c0b09", 0.3]} />

      {/* pooled lighting rig */}
      {spotTargets.map((t, i) => (
        <group key={`pool${i}`}>
          <spotLight
            ref={(el) => {
              spotRefs.current[i] = el;
            }}
            angle={0.55}
            penumbra={0.55}
            intensity={0}
            distance={11}
            decay={1.8}
            color="#ffeecf"
            castShadow={i < 4}
            shadow-mapSize={[512, 512]}
            shadow-bias={-0.0004}
            target={t}
          />
          <primitive object={t} />
        </group>
      ))}
      {Array.from({ length: POOL_PENDANTS }, (_, i) => (
        <pointLight
          key={`pp${i}`}
          ref={(el) => {
            pendantRefs.current[i] = el;
          }}
          intensity={0}
          distance={11}
          decay={1.9}
          color="#f5e3bf"
        />
      ))}

      {/* pendant lamps down the aisle */}
      {pendantZs.map((z, i) => (
        <group key={`pd${i}`} position={[0, 0, z]}>
          <mesh position={[0, H - 0.42, 0]}>
            <cylinderGeometry args={[0.011, 0.011, 0.84, 8]} />
            <meshStandardMaterial color="#191613" metalness={0.7} roughness={0.45} />
          </mesh>
          <mesh position={[0, H - 0.92, 0]}>
            <cylinderGeometry args={[0.15, 0.27, 0.22, 20, 1, true]} />
            <meshStandardMaterial
              color="#1d1915"
              metalness={0.6}
              roughness={0.5}
              side={THREE.DoubleSide}
            />
          </mesh>
          <mesh position={[0, H - 1.0, 0]}>
            <sphereGeometry args={[0.062, 16, 12]} />
            <meshBasicMaterial color="#ffdf9e" toneMapped={false} />
          </mesh>
        </group>
      ))}

      {/* the collection, chapter by chapter */}
      {columns.map((col, ci) => (
        <group
          key={ci}
          position={[col.x, 0, col.z]}
          rotation-y={col.rotY}
          ref={(g) => {
            colGroups.current[ci] = g;
          }}
        >
          <TrackFixture
            position={[0, H - 0.52, 2.1]}
            targetPos={[0, col.arts.length > 1 ? 2.15 : 1.72, 0]}
          />
          {col.arts.map((a, ri) => (
            <ArtBoundary key={a.slug}>
              <Suspense fallback={null}>
                <Painting
                  art={a}
                  chapter={col.chapter}
                  y={col.arts.length > 1 ? (ri === 0 ? 1.32 : 3.04) : 1.78}
                  maxH={col.arts.length > 1 ? 1.28 : 1.68}
                  texW={salon ? 500 : 960}
                  entityEnd={entity.endYear}
                  registry={registry}
                />
              </Suspense>
            </ArtBoundary>
          ))}
        </group>
      ))}

      {/* end wall inscription */}
      <group position={[0, 0, -L / 2 + 0.06]}>
        <Text
          position={[0, 2.55, 0]}
          fontSize={0.4}
          letterSpacing={0.16}
          maxWidth={W - 1.6}
          textAlign="center"
          color="#dccfae"
          anchorX="center"
          anchorY="middle"
        >
          {entity.name.toUpperCase()}
        </Text>
        <Text
          position={[0, 1.92, 0]}
          fontSize={0.13}
          letterSpacing={0.34}
          color="#8d8064"
          anchorX="center"
          anchorY="middle"
        >
          {entity.datesLabel.toUpperCase()}
        </Text>
        <mesh position={[0, 2.22, 0]}>
          <boxGeometry args={[1.4, 0.012, 0.012]} />
          <meshStandardMaterial color="#8a6f3a" metalness={0.85} roughness={0.35} />
        </mesh>
        <TrackFixture position={[0, H - 0.32, 2.6]} targetPos={[0, 2.3, 0]} />
        <StaticSpot
          position={[0, H - 0.32, 2.6]}
          targetPos={[0, 2.3, 0]}
          intensity={18}
          angle={0.7}
          distance={9}
        />
      </group>
    </group>
  );
}

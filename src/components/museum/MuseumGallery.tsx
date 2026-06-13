"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { Environment, PointerLockControls } from "@react-three/drei";
import type { PointerLockControls as PLCImpl } from "three-stdlib";
import type { Artwork, Chapter, MuseumEntity } from "@/lib/types";
import {
  artDisplayTitle,
  cleanDateLabel,
  thumbAt,
} from "@/components/timeline/timeline-utils";
import Hall, { buildLayout, type HallHover, type HallTarget } from "./Hall";

export default function MuseumGallery({
  entity,
  artworks,
  chapters,
}: {
  entity: MuseumEntity;
  artworks: Artwork[];
  chapters: Chapter[];
}) {
  const [entered, setEntered] = useState(false);
  const [locked, setLocked] = useState(false);
  const [hovered, setHovered] = useState<HallHover | null>(null);
  const [inspect, setInspect] = useState<{
    art: Artwork;
    chapter: Chapter | null;
  } | null>(null);
  const [reader, setReader] = useState<Chapter | null>(null);
  const lockedRef = useRef(false);
  const controlsRef = useRef<PLCImpl | null>(null);

  const layout = useMemo(
    () => buildLayout(artworks, chapters),
    [artworks, chapters]
  );

  const kindLabel = entity.kind === "civilization" ? "Civilization" : "Major Event";

  const tryLock = () => {
    try {
      controlsRef.current?.lock();
    } catch {
      /* pointer lock unavailable — Resume button stays */
    }
  };

  const closeOverlays = () => {
    setInspect(null);
    setReader(null);
  };

  const open = (t: HallTarget) => {
    if (t.kind === "art") setInspect({ art: t.art, chapter: t.chapter });
    else setReader(t.chapter);
    controlsRef.current?.unlock();
  };

  // keyboard-first: esc/enter/backspace close overlays; enter opens the
  // crosshair target or the gallery
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const overlayOpen = inspect != null || reader != null;
      if (
        (e.key === "Escape" || e.key === "Enter" || e.key === "Backspace") &&
        overlayOpen
      ) {
        e.preventDefault();
        closeOverlays();
        tryLock();
        return;
      }
      if (e.key === "Enter" && !entered) {
        setEntered(true);
        tryLock();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspect, reader, entered]);

  const enter = () => {
    setEntered(true);
    tryLock();
  };

  return (
    <div className="mg-root" style={{ "--c": entity.color } as React.CSSProperties}>
      <Canvas
        shadows
        dpr={[1, 1.5]}
        camera={{
          fov: 68,
          near: 0.1,
          far: layout.length + 40,
          position: [0, 1.65, layout.length / 2 - 1.6],
        }}
        gl={{ antialias: true }}
        onCreated={({ gl, camera }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.12;
          gl.shadowMap.type = THREE.PCFSoftShadowMap;
          camera.lookAt(0, 1.6, 0);
        }}
      >
        <color attach="background" args={["#0a0908"]} />
        <Suspense fallback={null}>
          <Hall
            entity={entity}
            layout={layout}
            lockedRef={lockedRef}
            onHover={setHovered}
            onOpen={open}
          />
          <Environment preset="city" environmentIntensity={0.18} />
        </Suspense>
        <PointerLockControls
          ref={controlsRef}
          selector="#mg-no-autolock" // lock only via the Enter/Resume buttons
          onLock={() => {
            lockedRef.current = true;
            setLocked(true);
          }}
          onUnlock={() => {
            lockedRef.current = false;
            setLocked(false);
          }}
        />
      </Canvas>

      {/* chrome */}
      <a className="mg-exit" href={`/${entity.kind}/${entity.slug}`}>
        ← Back to the placard
      </a>
      <div className="mg-title">
        <span className="ey">
          {kindLabel} · {entity.periodName}
        </span>
        <span className="nm">{entity.name}</span>
      </div>

      {locked && <div className="mg-crosshair" />}
      {locked && hovered && (
        <div className="mg-hovercard">
          <i>⤷</i> {hovered.label}
          <span>click to {hovered.verb}</span>
        </div>
      )}
      {locked && (
        <div className="mg-hints">
          WASD — walk <i>◆</i> shift — stride <i>◆</i> click / enter — open{" "}
          <i>◆</i> esc — release
        </div>
      )}

      {/* first entry */}
      {!entered && (
        <button className="mg-enter" onClick={enter}>
          <span className="ey">
            {kindLabel} · {entity.datesLabel}
          </span>
          <span className="nm">{entity.name}</span>
          <span className="rule" />
          <span className="cta">Click to enter the gallery</span>
          <span className="sub">
            {artworks.length} works
            {chapters.length > 0 && ` · ${chapters.length} chapters`} · first
            person · WASD + mouse
          </span>
        </button>
      )}

      {/* paused (unlocked, after first entry) */}
      {entered && !locked && !inspect && !reader && (
        <button className="mg-resume" onClick={() => tryLock()}>
          Resume walking
        </button>
      )}

      {/* chapter reader — the narrated story, section by section */}
      {reader && (
        <div
          className="mg-inspect mg-about"
          onClick={() => {
            setReader(null);
            tryLock();
          }}
        >
          <aside className="mg-about-panel" onClick={(e) => e.stopPropagation()}>
            <div className="ey">
              Chapter {reader.idx + 1} · {entity.name}
            </div>
            <h2>{reader.title}</h2>
            <p className="story mg-prewrap">{reader.body}</p>
            <div className="foot">
              {entity.wikiUrl && (
                <a href={entity.wikiUrl} target="_blank" rel="noreferrer">
                  Source · Wikipedia ↗
                </a>
              )}
              <button
                onClick={() => {
                  setReader(null);
                  tryLock();
                }}
              >
                Back to the gallery
              </button>
            </div>
          </aside>
          <button
            className="mg-close"
            onClick={() => {
              setReader(null);
              tryLock();
            }}
            aria-label="Close"
          >
            ✕
          </button>
        </div>
      )}

      {/* inspect view: the work on the left, its history readable beside it */}
      {inspect && (
        <div className="mg-inspect" onClick={() => setInspect(null)}>
          <figure onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={
                thumbAt(
                  inspect.art.thumbUrl ?? inspect.art.imageUrl,
                  1280,
                  inspect.art.width
                ) ??
                inspect.art.imageUrl ??
                undefined
              }
              alt={inspect.art.title}
            />
          </figure>
          <aside onClick={(e) => e.stopPropagation()}>
            <div className="ey">
              {inspect.art.kind} · {entity.name}
            </div>
            <h2>{artDisplayTitle(inspect.art.title, inspect.art.story)}</h2>
            {(inspect.art.artist || inspect.art.yearLabel || inspect.art.year) && (
              <div className="byline">
                {inspect.art.artist && <span>{inspect.art.artist}</span>}
                {(cleanDateLabel(inspect.art.yearLabel) ?? inspect.art.year) && (
                  <span className="yr">
                    {cleanDateLabel(inspect.art.yearLabel) ?? inspect.art.year}
                  </span>
                )}
              </div>
            )}
            {inspect.art.story && (
              <p className="mg-caption">{inspect.art.story}</p>
            )}

            {inspect.chapter ? (
              <>
                <div className="mg-hist-h">
                  The History · {inspect.chapter.idx + 1} —{" "}
                  {inspect.chapter.title}
                </div>
                <p className="story mg-prewrap">{inspect.chapter.body}</p>
              </>
            ) : entity.summary ? (
              <>
                <div className="mg-hist-h">The History</div>
                <p className="story">{entity.summary}</p>
              </>
            ) : null}

            <dl className="facts">
              {inspect.art.license && (
                <>
                  <dt>License</dt>
                  <dd>{inspect.art.license}</dd>
                </>
              )}
              {inspect.art.credit && (
                <>
                  <dt>Credit</dt>
                  <dd>{inspect.art.credit}</dd>
                </>
              )}
            </dl>
            <div className="foot">
              {inspect.art.wikiUrl && (
                <a href={inspect.art.wikiUrl} target="_blank" rel="noreferrer">
                  Wikimedia Commons ↗
                </a>
              )}
              <button
                onClick={() => {
                  setInspect(null);
                  tryLock();
                }}
              >
                Back to the gallery
              </button>
            </div>
          </aside>
          <button
            className="mg-close"
            onClick={() => {
              setInspect(null);
              tryLock();
            }}
            aria-label="Close"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

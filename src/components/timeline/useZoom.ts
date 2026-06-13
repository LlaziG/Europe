"use client";

import { useCallback, useEffect, useRef } from "react";
import { select } from "d3-selection";
import {
  zoom as d3zoom,
  zoomIdentity,
  type D3ZoomEvent,
  type ZoomBehavior,
} from "d3-zoom";
import gsap from "gsap";

export type ZoomState = { k: number; x: number; y: number };

export type ZoomOpts = {
  scaleExtent: [number, number];
  translateExtent?: [[number, number], [number, number]];
  // "zoom": wheel zooms (cursor-anchored). "pan-y": wheel travels through
  // time; pinch / ctrl+wheel zooms.
  wheelMode?: "zoom" | "pan-y";
  onChange: (t: ZoomState) => void;
};

export function useZoom<E extends HTMLElement>(opts: ZoomOpts) {
  const ref = useRef<E | null>(null);
  const zoomRef = useRef<ZoomBehavior<E, unknown> | null>(null);
  const tRef = useRef<ZoomState>({ k: 1, x: 0, y: 0 });
  const tweenRef = useRef<gsap.core.Tween | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const sel = select(el);

    const zm = d3zoom<E, unknown>()
      .scaleExtent(optsRef.current.scaleExtent)
      .filter((ev: MouseEvent | WheelEvent | TouchEvent) => {
        if (ev.type === "wheel") {
          if (optsRef.current.wheelMode === "pan-y")
            return (ev as WheelEvent).ctrlKey || (ev as WheelEvent).metaKey;
          return true;
        }
        if (ev.type === "dblclick") return false; // reserved for dive-to-fit
        return !(ev as MouseEvent).button;
      })
      .wheelDelta((ev: WheelEvent) => {
        // gentler, GSAP-feeling wheel zoom
        return (
          -ev.deltaY *
          (ev.deltaMode === 1 ? 0.06 : ev.deltaMode ? 1 : 0.0024) *
          (ev.ctrlKey ? 6 : 1.6)
        );
      })
      .on("zoom", (ev: D3ZoomEvent<E, unknown>) => {
        const t = ev.transform;
        tRef.current = { k: t.k, x: t.x, y: t.y };
        optsRef.current.onChange(tRef.current);
      });

    if (optsRef.current.translateExtent)
      zm.translateExtent(optsRef.current.translateExtent);

    sel.call(zm);
    zoomRef.current = zm;

    const onWheel = (ev: WheelEvent) => {
      if (optsRef.current.wheelMode !== "pan-y") return;
      if (ev.ctrlKey || ev.metaKey) return; // d3 handles as zoom
      ev.preventDefault();
      tweenRef.current?.kill();
      zm.translateBy(sel, -ev.deltaX, -ev.deltaY);
    };
    el.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      el.removeEventListener("wheel", onWheel);
      tweenRef.current?.kill();
      sel.on(".zoom", null);
    };
  }, []);

  const setTransform = useCallback(
    (k: number, x: number, y: number, duration = 0) => {
      const el = ref.current;
      const zm = zoomRef.current;
      if (!el || !zm) return;
      const sel = select(el);
      tweenRef.current?.kill();
      if (duration <= 0) {
        sel.call(zm.transform, zoomIdentity.translate(x, y).scale(k));
        return;
      }
      const from = { ...tRef.current };
      const proxy = { p: 0 };
      tweenRef.current = gsap.to(proxy, {
        p: 1,
        duration,
        ease: "power3.inOut",
        onUpdate: () => {
          const kk = from.k * Math.pow(k / from.k, proxy.p);
          const xx = from.x + (x - from.x) * proxy.p;
          const yy = from.y + (y - from.y) * proxy.p;
          sel.call(zm.transform, zoomIdentity.translate(xx, yy).scale(kk));
        },
      });
    },
    []
  );

  const getTransform = useCallback(() => tRef.current, []);

  const setScaleExtent = useCallback((min: number, max: number) => {
    zoomRef.current?.scaleExtent([min, max]);
  }, []);

  return { ref, setTransform, getTransform, setScaleExtent };
}

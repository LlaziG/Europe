"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// The museum audioguide. Reads the already-ingested Wikipedia text aloud with
// the browser's built-in speech synthesis — no API keys, no network, nothing
// generated: it simply voices the sourced story of whatever you're looking at.
export function useNarration() {
  const supported =
    typeof window !== "undefined" && "speechSynthesis" in window;
  const [enabled, setEnabled] = useState(true);
  const [speaking, setSpeaking] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);

  useEffect(() => {
    if (!supported) return;
    const pick = () => {
      const vs = window.speechSynthesis.getVoices();
      voiceRef.current =
        vs.find((v) => /Daniel|Arthur|Serena|Sonia|Oliver/.test(v.name) && v.lang.startsWith("en")) ||
        vs.find((v) => /Samantha|Karen|Moira|Tessa|Fiona/.test(v.name)) ||
        vs.find((v) => v.lang === "en-GB") ||
        vs.find((v) => v.lang.startsWith("en")) ||
        vs[0] ||
        null;
    };
    pick();
    window.speechSynthesis.onvoiceschanged = pick;
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, [supported]);

  const stop = useCallback(() => {
    if (supported) window.speechSynthesis.cancel();
    setSpeaking(false);
    setCurrent(null);
  }, [supported]);

  // speak `text`; `label` is the short caption shown on screen
  const speak = useCallback(
    (text: string | null | undefined, label?: string) => {
      if (!supported || !enabled) return;
      const clean = (text ?? "").replace(/\s+/g, " ").trim();
      if (!clean) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(clean.slice(0, 1400));
      if (voiceRef.current) u.voice = voiceRef.current;
      u.rate = 0.95;
      u.pitch = 1;
      u.lang = voiceRef.current?.lang || "en-GB";
      u.onstart = () => setSpeaking(true);
      u.onend = () => {
        setSpeaking(false);
        setCurrent(null);
      };
      setCurrent(label ?? clean);
      window.speechSynthesis.speak(u);
    },
    [supported, enabled]
  );

  // killing narration when it's turned off, and on unmount
  useEffect(() => {
    if (!enabled) stop();
  }, [enabled, stop]);
  useEffect(
    () => () => {
      if (supported) window.speechSynthesis.cancel();
    },
    [supported]
  );

  return { supported, enabled, setEnabled, speak, stop, speaking, current };
}

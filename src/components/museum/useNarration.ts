"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// The museum audioguide. Plays a pre-recorded ElevenLabs MP3 when one exists
// for the piece, and falls back to the browser's speech synthesis otherwise.
// Either way it only voices the already-stored, sourced narration text.
export function useNarration() {
  // false during SSR and the first client render (so markup matches), then
  // true after mount — avoids hydration mismatches on window-only state
  const [supported, setSupported] = useState(false);
  const synth =
    typeof window !== "undefined" && "speechSynthesis" in window;
  const [enabled, setEnabled] = useState(true);
  const [speaking, setSpeaking] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    setSupported(true);
  }, []);

  useEffect(() => {
    if (!synth) return;
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
  }, [synth]);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    if (synth) window.speechSynthesis.cancel();
    setSpeaking(false);
    setCurrent(null);
  }, [synth]);

  const speakSynth = useCallback(
    (text: string, label?: string) => {
      const clean = (text ?? "").replace(/\s+/g, " ").trim();
      if (!synth || !clean) return;
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
    [synth]
  );

  // speak `text`; if `audioUrl` resolves to a real recording, play that instead
  const speak = useCallback(
    (text: string | null | undefined, label?: string, audioUrl?: string) => {
      if (!enabled) return;
      stop();
      const clean = (text ?? "").trim();
      if (audioUrl) {
        const a = new Audio(audioUrl);
        audioRef.current = a;
        a.onplaying = () => setSpeaking(true);
        a.onended = () => {
          setSpeaking(false);
          setCurrent(null);
          audioRef.current = null;
        };
        a.onerror = () => {
          // no recording for this piece yet → speak the text
          audioRef.current = null;
          speakSynth(clean, label);
        };
        setCurrent(label ?? clean);
        a.play().catch(() => speakSynth(clean, label));
        return;
      }
      speakSynth(clean, label);
    },
    [enabled, stop, speakSynth]
  );

  useEffect(() => {
    if (!enabled) stop();
  }, [enabled, stop]);
  useEffect(
    () => () => {
      if (synth) window.speechSynthesis.cancel();
    },
    [synth]
  );

  return { supported, enabled, setEnabled, speak, stop, speaking, current };
}

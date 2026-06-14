"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// The museum audioguide. Plays a pre-recorded ElevenLabs MP3 when one exists
// for the piece, and falls back to the browser's speech synthesis otherwise.
// Exposes `progress` (0–1 of the current narration) so the on-screen text can
// glow along as it's spoken.
export function useNarration() {
  const [supported, setSupported] = useState(false);
  const synth =
    typeof window !== "undefined" && "speechSynthesis" in window;
  const [enabled, setEnabled] = useState(true);
  const [speaking, setSpeaking] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
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

  // tear down cleanly — detach handlers FIRST so clearing src doesn't fire the
  // error handler (which would otherwise kick off the browser voice on a stop)
  const stop = useCallback(() => {
    const a = audioRef.current;
    if (a) {
      a.onplaying = null;
      a.onended = null;
      a.onerror = null;
      a.ontimeupdate = null;
      a.pause();
      a.removeAttribute("src");
      a.load();
      audioRef.current = null;
    }
    if (synth) window.speechSynthesis.cancel();
    setSpeaking(false);
    setCurrent(null);
    setProgress(0);
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
      u.onstart = () => {
        setSpeaking(true);
        setProgress(0);
      };
      u.onboundary = (e) =>
        setProgress(Math.min(1, e.charIndex / Math.max(1, clean.length)));
      u.onend = () => {
        setSpeaking(false);
        setProgress(1);
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
        a.ontimeupdate = () => {
          if (a.duration && isFinite(a.duration))
            setProgress(Math.min(1, a.currentTime / a.duration));
        };
        a.onended = () => {
          setSpeaking(false);
          setProgress(1);
          setCurrent(null);
          audioRef.current = null;
        };
        a.onerror = () => {
          // no recording for this piece yet → speak the text instead
          audioRef.current = null;
          speakSynth(clean, label);
        };
        setCurrent(label ?? clean);
        setProgress(0);
        a.play().catch((err) => {
          // a pause()/load() during start rejects with AbortError — ignore it;
          // only fall back for genuine playback blocks
          if (err && err.name === "AbortError") return;
          speakSynth(clean, label);
        });
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

  return { supported, enabled, setEnabled, speak, stop, speaking, current, progress };
}

"use client";

/**
 * Speak instead of type. Uses the browser's own speech recognition (Chrome,
 * Edge, Safari); nothing leaves the machine through us. Where the browser has
 * none, `supported` is false and callers hide the microphone.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

interface RecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}

interface RecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<RecognitionResultLike>;
}

interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type RecognitionCtor = new () => RecognitionLike;

function recognitionCtor(): RecognitionCtor | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

const subscribeNever = (): (() => void) => () => {};

export interface Dictation {
  /** False on browsers without speech recognition, and on the server. */
  supported: boolean;
  listening: boolean;
  /** Everything heard since `start`, final words plus the phrase still being recognised. */
  transcript: string;
  error: string | null;
  /** The browser refused the microphone; the person has to allow it in the address bar. */
  blocked: boolean;
  start: () => Promise<void>;
  stop: () => void;
  toggle: () => void;
}

const ERROR_WORDS: Record<string, string> = {
  "not-allowed": "Microphone blocked. Click the lock icon in the address bar, set Microphone to Allow, then reload this page.",
  "audio-capture": "No microphone was found.",
  network: "Speech recognition needs a network connection in this browser.",
  "no-speech": "Nothing was heard.",
};

export function useDictation(): Dictation {
  const supported = useSyncExternalStore(subscribeNever, () => recognitionCtor() !== undefined, () => false);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const recognition = useRef<RecognitionLike | null>(null);
  const finalWords = useRef("");

  const stop = useCallback(() => {
    recognition.current?.stop();
  }, []);

  const start = useCallback(async () => {
    const Ctor = recognitionCtor();
    if (!Ctor || recognition.current) return;
    // Ask for the microphone outright so the browser shows its permission
    // prompt; speech recognition alone can fail silently when it is still undecided.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const track of stream.getTracks()) track.stop();
    } catch (e) {
      const name = (e as { name?: string }).name ?? "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        setBlocked(true);
        setError(ERROR_WORDS["not-allowed"]!);
      } else if (name === "NotFoundError") {
        setError(ERROR_WORDS["audio-capture"]!);
      } else {
        setError("Could not open the microphone.");
      }
      return;
    }
    if (recognition.current) return;
    const r = new Ctor();
    r.lang = navigator.language || "en-US";
    r.continuous = true;
    r.interimResults = true;
    finalWords.current = "";
    setTranscript("");
    setError(null);
    r.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i]!;
        const words = result[0].transcript;
        if (result.isFinal) finalWords.current = `${finalWords.current}${words} `;
        else interim += words;
      }
      setTranscript(`${finalWords.current}${interim}`.replace(/\s+/g, " ").trim());
    };
    r.onerror = (event) => {
      const code = event.error ?? "";
      if (code === "aborted") return;
      if (code === "not-allowed" || code === "service-not-allowed") setBlocked(true);
      setError(ERROR_WORDS[code] ?? "Could not hear you. Try again.");
    };
    r.onend = () => {
      recognition.current = null;
      setListening(false);
    };
    recognition.current = r;
    setListening(true);
    try {
      r.start();
    } catch {
      recognition.current = null;
      setListening(false);
      setError("Could not start the microphone.");
    }
  }, []);

  const toggle = useCallback(() => {
    if (recognition.current) stop();
    else void start();
  }, [start, stop]);

  // Leaving the page mid-sentence must not keep the microphone open.
  useEffect(() => () => recognition.current?.abort(), []);

  return { supported, listening, transcript, error, blocked, start, stop, toggle };
}

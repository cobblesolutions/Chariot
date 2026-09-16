import * as React from "react";

/** Minimal Web Speech API surface (Chrome, Edge and Safari ship it; Firefox does not). */
type RecognitionAlternative = { transcript: string };
type RecognitionResult = { isFinal: boolean; 0: RecognitionAlternative };
type RecognitionEvent = {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
};
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type DictationState = "idle" | "listening";

/**
 * Voice typing on top of the browser's speech recognition. `onTranscript`
 * receives the whole dictated passage so far (final + interim words) each time
 * it changes; the caller decides where to put it.
 */
export function useDictation({
  onTranscript,
  onError,
  lang,
}: {
  onTranscript: (text: string, done: boolean) => void;
  onError?: (message: string) => void;
  lang?: string;
}) {
  const supported = React.useMemo(() => recognitionCtor() !== null, []);
  const [state, setState] = React.useState<DictationState>("idle");
  const recognitionRef = React.useRef<Recognition | null>(null);
  const finalRef = React.useRef("");
  // Everything shown so far (final + interim); kept on end so a stop never erases words.
  const shownRef = React.useRef("");
  const latest = React.useRef({ onTranscript, onError });
  latest.current = { onTranscript, onError };

  const stop = React.useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const start = React.useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    recognitionRef.current?.abort();
    const recognition = new Ctor();
    recognition.lang = lang ?? navigator.language ?? "en-GB";
    recognition.continuous = true;
    recognition.interimResults = true;
    finalRef.current = "";
    shownRef.current = "";
    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]!;
        if (result.isFinal) finalRef.current += result[0].transcript;
        else interim += result[0].transcript;
      }
      shownRef.current = `${finalRef.current}${interim}`;
      latest.current.onTranscript(shownRef.current, false);
    };
    recognition.onerror = (event) => {
      if (event.error === "aborted" || event.error === "no-speech") return;
      latest.current.onError?.(
        event.error === "not-allowed"
          ? "Microphone access was blocked. Allow it in the browser to dictate."
          : `Dictation stopped (${event.error}).`,
      );
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setState("idle");
      latest.current.onTranscript(shownRef.current || finalRef.current, true);
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setState("listening");
    } catch {
      latest.current.onError?.("Dictation could not start.");
    }
  }, [lang]);

  React.useEffect(() => () => recognitionRef.current?.abort(), []);

  return { supported, state, start, stop };
}

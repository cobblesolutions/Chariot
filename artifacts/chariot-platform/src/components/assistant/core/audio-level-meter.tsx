import * as React from "react";
import { cn } from "@/lib/utils";

const BARS = 5;
/** How quickly a bar follows the sound: 1 = instant, lower = smoother. */
const ATTACK = 0.5;
const RELEASE = 0.15;

/**
 * Live microphone level, drawn as a row of bars that rise and fall with the
 * sound while dictating. Opens its own mic stream through the Web Audio API and
 * releases it on unmount; if the mic can't be opened the bars just stay flat.
 */
function AudioLevelMeter({ className }: { className?: string }) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let frame = 0;
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let cancelled = false;
    const levels = new Array<number>(BARS).fill(0);

    const draw = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const scale = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (canvas.width !== width * scale || canvas.height !== height * scale) {
        canvas.width = width * scale;
        canvas.height = height * scale;
      }
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.clearRect(0, 0, width, height);

      if (analyser) {
        const data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);
        // Each bar watches a slice of the spectrum (voice lives in the lower bins).
        const usable = Math.floor(data.length * 0.6);
        const slice = Math.max(1, Math.floor(usable / BARS));
        for (let i = 0; i < BARS; i++) {
          let sum = 0;
          for (let j = i * slice; j < (i + 1) * slice; j++) sum += data[j] ?? 0;
          const target = Math.min(1, sum / slice / 120);
          const rate = target > levels[i]! ? ATTACK : RELEASE;
          levels[i] = levels[i]! + (target - levels[i]!) * rate;
        }
      }

      const gap = 2;
      const barWidth = (width - gap * (BARS - 1)) / BARS;
      const minHeight = 3;
      ctx.fillStyle = getComputedStyle(canvas).color;
      for (let i = 0; i < BARS; i++) {
        const barHeight = minHeight + (height - minHeight) * (levels[i] ?? 0);
        const x = i * (barWidth + gap);
        const y = (height - barHeight) / 2;
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, barWidth / 2);
        ctx.fill();
      }
      frame = requestAnimationFrame(draw);
    };

    const open = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) return;
        context = new AudioContext();
        analyser = context.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.6;
        context.createMediaStreamSource(stream).connect(analyser);
      } catch {
        // No microphone (or permission denied): keep drawing flat bars.
      }
    };

    void open();
    frame = requestAnimationFrame(draw);

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
      void context?.close();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label="Microphone level"
      data-testid="audio-meter"
      className={cn("h-5 w-9 shrink-0 text-destructive", className)}
    />
  );
}

export { AudioLevelMeter };

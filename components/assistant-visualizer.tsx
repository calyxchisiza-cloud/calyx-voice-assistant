'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { SessionStatus } from '@/lib/realtime';

type Vec3 = readonly [number, number, number];

type Point = {
  position: Vec3;
  weight: number;
  radius: number;
  hueShift: number;
};

type Props = {
  status: SessionStatus;
  inputLevel: number;
  outputLevel: number;
  voiceHint: string;
  onInterrupt: () => void;
  quality?: VisualQuality;
};

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/** Deterministic pseudo-random so the field is identical on every render. */
function scramble(index: number, salt: number) {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function buildCorePoints(count: number): Point[] {
  const points: Point[] = [];
  for (let index = 0; index < count; index += 1) {
    const y = 1 - (index / (count - 1)) * 2;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = GOLDEN * index;
    // Two thin rings on top of a dense shell: a gyroscope, not a fuzzball.
    const band = Math.abs(Math.sin(y * Math.PI * 3)) < 0.14;
    const scale = band ? 1.2 : 0.62 + scramble(index, 3) * 0.42;
    points.push({
      position: [Math.cos(theta) * radius * scale, y * 0.92, Math.sin(theta) * radius * scale],
      weight: 0.5 + scramble(index, 11) * 0.5,
      radius: band ? 1.35 + scramble(index, 5) * 0.4 : 0.75 + scramble(index, 5) * 0.5,
      hueShift: band ? 1 : 0,
    });
  }
  return points;
}

function buildCloudPoints(count: number): Point[] {
  const points: Point[] = [];
  for (let index = 0; index < count; index += 1) {
    const theta = scramble(index, 21) * Math.PI * 2;
    const phi = Math.acos(2 * scramble(index, 22) - 1);
    const radius = 1.24 + scramble(index, 23) * 0.5;
    const falloff = 1 - Math.pow((radius - 1.24) / 0.5, 2);
    points.push({
      position: [
        radius * Math.sin(phi) * Math.cos(theta),
        radius * Math.cos(phi) * 0.66,
        radius * Math.sin(phi) * Math.sin(theta),
      ],
      weight: 0.34 + falloff * 0.5,
      radius: 0.55 + scramble(index, 24) * 0.75,
      hueShift: 2,
    });
  }
  return points;
}

/** Wires a cube together so the field reads as a fabricated machine. */
function buildLatticePoints(): Point[] {
  const corners: Vec3[] = [
    [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
    [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
  ];
  const edges = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  const points: Point[] = [];
  for (const [from, to] of edges) {
    const start = corners[from];
    const end = corners[to];
    for (let step = 0; step <= 8; step += 1) {
      const t = step / 8;
      points.push({
        position: [
          start[0] + (end[0] - start[0]) * t,
          start[1] + (end[1] - start[1]) * t,
          start[2] + (end[2] - start[2]) * t,
        ],
        weight: 0.3,
        radius: 0.5,
        hueShift: 3,
      });
    }
  }
  return points;
}

function buildDustPoints(count: number): Point[] {
  const points: Point[] = [];
  for (let index = 0; index < count; index += 1) {
    points.push({
      position: [
        (scramble(index, 41) - 0.5) * 5.4,
        (scramble(index, 42) - 0.5) * 3.4,
        (scramble(index, 43) - 0.5) * 5.4,
      ],
      weight: 0.12 + scramble(index, 44) * 0.2,
      radius: 0.4,
      hueShift: 2,
    });
  }
  return points;
}

/** A flat annulus that reads as the console's equator line. */
function buildRingPoints(count: number, radius: number, thickness: number, hueShift: number): Point[] {
  const points: Point[] = [];
  for (let index = 0; index < count; index += 1) {
    const theta = (index / count) * Math.PI * 2;
    const wobble = 1 + (scramble(index, 51 + hueShift) - 0.5) * 0.012;
    const drift = (scramble(index, 61) - 0.5) * thickness;
    points.push({
      position: [Math.cos(theta) * (radius + drift) * wobble, 0, Math.sin(theta) * (radius + drift) * wobble],
      weight: 0.4 + scramble(index, 71) * 0.6,
      radius: 0.7,
      hueShift,
    });
  }
  return points;
}

function project(point: Vec3, cosX: number, sinX: number, cosY: number, sinY: number, cameraZ: number) {
  // Rotate around Y, then X. Classic pinhole divide for a genuine 3D read.
  const x1 = point[0] * cosY - point[2] * sinY;
  const z1 = point[0] * sinY + point[2] * cosY;
  const y2 = point[1] * cosX - z1 * sinX;
  const z2 = point[1] * sinX + z1 * cosX;
  const distance = z2 + cameraZ;
  if (distance <= 0.2) return null;
  const perspective = 1 / distance;
  return { sx: x1 * perspective, sy: y2 * perspective, depth: perspective, z: z2 };
}

/** Larger camera distance = flatter, calmer field; smaller = more dramatic. */
const CAMERA_DISTANCE = 4.15;

const STATUS_ENERGY: Record<SessionStatus, number> = {
  idle: 0.16,
  connecting: 0.42,
  listening: 0.28,
  thinking: 0.7,
  speaking: 0.85,
  reconnecting: 0.36,
  error: 0.1,
};

const PREFERS_REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/** Graphics quality: the user's choice over how much of the field to render. */
export type VisualQuality = 'auto' | 'low' | 'medium' | 'high' | 'off';

const QUALITY_BUDGETS: Record<Exclude<VisualQuality, 'auto'>, number | null> = {
  off: 0,
  low: 180,
  medium: 360,
  high: 620,
};

export function AssistantVisualizer({ status, inputLevel, outputLevel, voiceHint, onInterrupt, quality = 'auto' }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pointBudget, setPointBudget] = useState<number | null>(null);
  // False until a real frame lands. If rAF never fires (background tab, hardened
  // browser, automation), we keep the CSS fallback visible instead of a void.
  const [rendering, setRendering] = useState(false);

  // Keep the newest levels available to the animation loop without restarting it.
  const inputLevelRef = useRef(inputLevel);
  const outputLevelRef = useRef(outputLevel);
  const statusRef = useRef<SessionStatus>(status);
  inputLevelRef.current = inputLevel;
  outputLevelRef.current = outputLevel;
  statusRef.current = status;

  const field = useMemo(
    () => ({
      core: buildCorePoints(260),
      cloud: buildCloudPoints(520),
      lattice: buildLatticePoints(),
      dust: buildDustPoints(200),
      ring: buildRingPoints(220, 1.62, 0.05, 1),
      tilt: buildRingPoints(200, 1.94, 0.03, 3),
    }),
    [],
  );

  // Decide once whether a live canvas is worth it on this machine.
  useEffect(() => {
    const reduced = window.matchMedia(PREFERS_REDUCED_MOTION).matches;
    const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
    const cores = navigator.hardwareConcurrency ?? 4;

    if (quality !== 'auto') {
      const chosen = QUALITY_BUDGETS[quality];
      setPointBudget(reduced && chosen !== 0 ? 0 : chosen);
      return;
    }

    if (reduced || cores <= 2 || memory <= 2) {
      setPointBudget(0);
      return;
    }
    // hardwareConcurrency counts logical threads, which flatters older 2C/4T
    // mobile chips. Stay conservative: a slightly sparser field that holds a
    // steady frame rate looks far better than a dense one that stutters.
    const budget = cores <= 4 || memory <= 4 ? 420 : cores <= 8 || memory <= 8 ? 560 : 900;
    setPointBudget(budget);
  }, [quality]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || pointBudget === null) return;

    const context = canvas.getContext('2d', { alpha: true });
    if (!context) return;

    const reduced = window.matchMedia(PREFERS_REDUCED_MOTION).matches;
    let width = 0;
    let height = 0;
    let scale = 1;
    let frame = 0;
    let disposed = false;
    let firstFrameDone = false;
    let lastTime = performance.now();

    const energyRef = { value: STATUS_ENERGY[status] };
    const liveEnergy = { value: 0 };

    const allPoints: Point[] = [
      ...field.core,
      ...field.cloud,
      ...field.lattice,
      ...field.ring,
      ...field.tilt,
      ...field.dust,
    ];
    const step = Math.max(1, Math.ceil(allPoints.length / Math.max(160, pointBudget)));
    const active = allPoints.filter((_, index) => index % step === 0);

    const buffers = active.map(() => ({ x: 0, y: 0, depth: 0, z: 0, size: 0 }));
    const order = active.map((_, index) => index);

    // Points are drawn from pre-rendered sprites instead of per-point canvas arcs
    // with shadowBlur. Blurring every point individually is the single most
    // expensive thing this loop can do; baking the glow once into a small bitmap
    // and blitting it keeps the identical look for a fraction of the CPU.
    const SPRITE_PX = 64;
    const sprites = new Map<string, HTMLCanvasElement>();
    const spriteFor = (colour: string) => {
      const cached = sprites.get(colour);
      if (cached) return cached;
      const sprite = document.createElement('canvas');
      sprite.width = SPRITE_PX;
      sprite.height = SPRITE_PX;
      const sc = sprite.getContext('2d');
      if (sc) {
        const centre = SPRITE_PX / 2;
        const glow = sc.createRadialGradient(centre, centre, 0, centre, centre, centre);
        glow.addColorStop(0, colour);
        glow.addColorStop(0.42, colour);
        glow.addColorStop(1, 'transparent');
        sc.fillStyle = glow;
        sc.globalAlpha = 0.9;
        sc.beginPath();
        sc.arc(centre, centre, centre, 0, Math.PI * 2);
        sc.fill();
      }
      sprites.set(colour, sprite);
      return sprite;
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
      width = Math.max(1, Math.round(rect.width));
      height = Math.max(1, Math.round(rect.height));
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Fit the field to the smaller axis so it never clips on wide or tall rigs.
      scale = Math.min(width, height * 0.92) / (CAMERA_DISTANCE * 0.62);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    let angleY = -0.4;
    let angleX = -0.34;

    const render = (now: number) => {
      if (disposed) return;
      if (!firstFrameDone) {
        firstFrameDone = true;
        setRendering(true);
      }
      const delta = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      const currentStatus = statusRef.current;
      const live = liveEnergy.value;
      const target = STATUS_ENERGY[currentStatus] + live * 0.5;
      energyRef.value += (target - energyRef.value) * Math.min(1, delta * 4);
      const energy = energyRef.value;

      // The core tumbles steadily; energy spins it up, speech makes it breathe.
      const speed = currentStatus === 'idle' || currentStatus === 'error' ? 0.06 : 0.12 + energy * 0.5;
      angleY += delta * speed;
      angleX += delta * speed * 0.32;
      const breath = 1 + Math.sin(now / 620) * 0.012 + energy * 0.05;

      const cosY = Math.cos(angleY);
      const sinY = Math.sin(angleY);
      const cosX = Math.cos(angleX);
      const sinX = Math.sin(angleX);

      context.clearRect(0, 0, width, height);
      context.globalCompositeOperation = 'lighter';

      const jitter = liveEnergy.value * 0.42;
      for (let index = 0; index < active.length; index += 1) {
        const point = active[index];
        const pulse = 1 + jitter * Math.sin(now / 130 + point.weight * 9 + index);
        const projected = project(
          [point.position[0] * breath * pulse, point.position[1] * breath * pulse, point.position[2] * breath * pulse],
          cosX, sinX, cosY, sinY,
          CAMERA_DISTANCE,
        );
        const buffer = buffers[index];
        if (!projected) {
          buffer.size = 0;
          continue;
        }
        buffer.x = width / 2 + projected.sx * scale;
        buffer.y = height / 2 + projected.sy * scale;
        buffer.depth = projected.depth;
        buffer.z = projected.z;
        // Point size tracks true perspective so near nodes bloom and far ones recede.
        buffer.size = point.radius * projected.depth * (0.9 + energy * 0.7) * 7;
      }

      // Painter's algorithm: far points first so near ones glow on top.
      order.sort((a, b) => buffers[a].z - buffers[b].z);

      const hueBase = currentStatus === 'error' ? 4 : currentStatus === 'thinking' ? 268 : currentStatus === 'listening' ? 178 : 196;
      const weightEnergy = 0.62 + energy * 0.5;
      for (const index of order) {
        const buffer = buffers[index];
        if (buffer.size <= 0.05) continue;
        const point = active[index];
        // depth is 1/distance, so ~0.21 (far) to ~0.29 (near). Remap that to 0..1.
        const near = Math.min(1, Math.max(0, (buffer.depth - 0.2) / 0.1));
        const alpha = Math.min(0.95, (0.34 + near * 0.66) * point.weight * weightEnergy);
        const half = Math.max(0.8, Math.min(8, buffer.size * 1.4));
        const hsl = point.hueShift === 0
          ? `hsl(${hueBase - 14} 100% 74%)`
          : point.hueShift === 1
            ? `hsl(${hueBase + 12} 100% 82%)`
            : point.hueShift === 3
              ? `hsl(${hueBase - 30} 92% 66%)`
              : `hsl(${hueBase} 96% 70%)`;
        context.globalAlpha = alpha;
        context.drawImage(spriteFor(hsl), buffer.x - half, buffer.y - half, half * 2, half * 2);
      }
      context.globalAlpha = 1;
      context.globalCompositeOperation = 'source-over';

      if (!reduced) frame = requestAnimationFrame(render);
    };

    const syncLive = () => {
      liveEnergy.value = statusRef.current === 'speaking' ? outputLevelRef.current : inputLevelRef.current;
    };

    frame = requestAnimationFrame(render);
    const levelTimer = window.setInterval(syncLive, 60);

    // Stop animating when the window is hidden, minimised, or in a background tab.
    // Without this the field keeps burning a full CPU core off-screen, which is
    // wasted work on any machine and painful on a low-memory one.
    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(frame);
        frame = 0;
      } else if (!frame && !reduced && !disposed) {
        lastTime = performance.now();
        frame = requestAnimationFrame(render);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    // If no frame lands shortly after mount, assume rAF is unavailable and reveal
    // the CSS fallback rather than leaving an empty stage.
    const watchdog = window.setTimeout(() => {
      if (!firstFrameDone) setRendering(false);
    }, 1200);

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      window.clearInterval(levelTimer);
      window.clearTimeout(watchdog);
      document.removeEventListener('visibilitychange', onVisibility);
      observer.disconnect();
    };
    // Level values are read through refs so the field never restarts mid-session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field, pointBudget]);

  const live = status === 'speaking' ? outputLevel : inputLevel;
  const energy = Math.min(1, STATUS_ENERGY[status] + live * 0.55);

  return (
    <section
      className={`rig rig-${status} ${rendering ? 'rig-cpu' : 'rig-fallback-active'}`}
      style={{ '--rig-energy': energy.toFixed(3), '--rig-live': live.toFixed(3) } as React.CSSProperties}
    >
      <div className="rig-hud" aria-hidden="true">
        <span className="hud-corner hud-tl" /><span className="hud-corner hud-tr" />
        <span className="hud-corner hud-bl" /><span className="hud-corner hud-br" />
        <span className="hud-axis hud-axis-x">X</span>
        <span className="hud-axis hud-axis-y">Y</span>
        <span className="hud-axis hud-axis-z">Z</span>
        <span className="hud-reticle" />
        <span className="hud-readout hud-readout-left">
          SYNTH CORE<br />
          <b>{Math.round(energy * 100).toString().padStart(3, '0')}%</b> LOAD
        </span>
        <span className="hud-readout hud-readout-right">
          {pointBudget === null ? 'CALIBRATING' : pointBudget === 0 ? 'LOW POWER' : `${pointBudget} NODES`}<br />
          <b>{status === 'speaking' ? 'TX' : status === 'listening' ? 'RX' : 'IDLE'}</b> {voiceHint}
        </span>
      </div>

      <canvas className="rig-canvas" ref={canvasRef} aria-hidden="true" />

      {/* CSS-only twins: the real 3D field on capable machines, this everywhere else. */}
      <div className="rig-fallback" aria-hidden="true">
        <div className="fallback-halo" />
        <div className="fallback-orbit fallback-orbit-a" />
        <div className="fallback-orbit fallback-orbit-b" />
        <div className="fallback-orbit fallback-orbit-c" />
        <div className="fallback-cores">
          {Array.from({ length: 46 }, (_, index) => (
            <span key={index} style={{ '--i': index } as React.CSSProperties} />
          ))}
        </div>
      </div>

      <button
        className="rig-interrupt"
        type="button"
        onClick={onInterrupt}
        disabled={status !== 'speaking'}
        aria-label="Interrupt assistant"
      >
        <span className="interrupt-bars"><i /><i /><i /><i /></span>
        Interrupt
      </button>
    </section>
  );
}

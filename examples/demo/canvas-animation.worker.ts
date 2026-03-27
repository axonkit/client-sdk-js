/// <reference lib="webworker" />

type InitMessage = {
  type: 'init';
  canvas: OffscreenCanvas;
  width: number;
  height: number;
};

type StopMessage = { type: 'stop' };

type WorkerInMessage = InitMessage | StopMessage;

let ctx: OffscreenCanvasRenderingContext2D | null = null;
let width = 640;
let height = 360;
let startedAt = 0;
let stopRequested = false;
let rafId = 0;
let intervalId: ReturnType<typeof setInterval> | undefined;

function drawFrame(now: number) {
  if (!ctx) return;
  const elapsed = (now - startedAt) / 1000;

  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, `hsl(${(elapsed * 40) % 360}, 85%, 60%)`);
  gradient.addColorStop(1, `hsl(${(elapsed * 40 + 120) % 360}, 75%, 30%)`);

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  for (let index = 0; index < 5; index += 1) {
    const offset = elapsed * 0.8 + index * 0.9;
    const x = width * (0.15 + 0.18 * index) + Math.sin(offset) * 18;
    const y = height * 0.58 + Math.cos(offset * 1.2) * 65;
    const radius = 26 + ((Math.sin(offset * 2) + 1) / 2) * 18;
    ctx.beginPath();
    ctx.fillStyle = `hsla(${(elapsed * 90 + index * 35) % 360}, 95%, 70%, 0.85)`;
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  const barWidth = width / 16;
  for (let index = 0; index < 12; index += 1) {
    const amplitude = (Math.sin(elapsed * 2.4 + index * 0.55) + 1) / 2;
    const barHeight = 35 + amplitude * 110;
    const x = 22 + index * (barWidth + 6);
    const y = height - barHeight - 20;
    ctx.fillStyle = `hsla(${(elapsed * 120 + index * 18) % 360}, 90%, 65%, 0.72)`;
    ctx.fillRect(x, y, barWidth, barHeight);
  }

  ctx.fillStyle = 'rgba(255, 255, 255, 0.96)';
  ctx.font = 'bold 36px system-ui, sans-serif';
  ctx.fillText('AxonKit Canvas', 24, 54);
  ctx.font = '20px system-ui, sans-serif';
  ctx.fillText(`Animated source ${elapsed.toFixed(1)}s`, 24, 88);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  for (let x = 0; x <= width; x += 8) {
    const y = height * 0.3 + Math.sin(elapsed * 2.2 + x / 38) * 26;
    if (x === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
}

function loop(now: number) {
  if (stopRequested || !ctx) return;
  drawFrame(now);
  if (typeof self.requestAnimationFrame === 'function') {
    rafId = self.requestAnimationFrame(loop);
  }
}

function stopLoop() {
  stopRequested = true;
  if (rafId !== 0 && typeof self.cancelAnimationFrame === 'function') {
    self.cancelAnimationFrame(rafId);
    rafId = 0;
  }
  if (intervalId !== undefined) {
    clearInterval(intervalId);
    intervalId = undefined;
  }
  ctx = null;
}

self.onmessage = (e: MessageEvent<WorkerInMessage>) => {
  const msg = e.data;
  if (msg.type === 'stop') {
    stopLoop();
    return;
  }
  if (msg.type !== 'init') return;

  stopLoop();
  stopRequested = false;
  width = msg.width;
  height = msg.height;
  msg.canvas.width = width;
  msg.canvas.height = height;
  startedAt = performance.now();

  const c = msg.canvas.getContext('2d');
  if (!c) {
    self.postMessage({ type: 'error', message: 'OffscreenCanvas 2d context unavailable' });
    return;
  }
  ctx = c;

  if (typeof self.requestAnimationFrame === 'function') {
    rafId = self.requestAnimationFrame(loop);
  } else {
    intervalId = self.setInterval(() => drawFrame(performance.now()), 1000 / 30);
  }
};

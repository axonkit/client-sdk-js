export const DEMO_CANVAS_WIDTH = 640;
export const DEMO_CANVAS_HEIGHT = 360;

let canvasEl: HTMLCanvasElement | undefined;
let worker: Worker | undefined;

/**
 * Starts the off-thread canvas animation. The returned canvas is still visible
 * in supported browsers and can be used with captureStream().
 */
export function startDemoCanvasWorkerAnimation(): HTMLCanvasElement {
  if (canvasEl) {
    return canvasEl;
  }

  const canvas = document.createElement('canvas');
  canvas.width = DEMO_CANVAS_WIDTH;
  canvas.height = DEMO_CANVAS_HEIGHT;
  const offscreen = canvas.transferControlToOffscreen();

  worker = new Worker(new URL('./canvas-animation.worker.ts', import.meta.url), {
    type: 'module',
  });
  worker.onmessage = (ev: MessageEvent<{ type: string; message?: string }>) => {
    if (ev.data?.type === 'error' && ev.data.message) {
      console.error('[canvas worker]', ev.data.message);
    }
  };

  worker.postMessage(
    {
      type: 'init',
      canvas: offscreen,
      width: DEMO_CANVAS_WIDTH,
      height: DEMO_CANVAS_HEIGHT,
    },
    [offscreen],
  );

  canvasEl = canvas;
  return canvas;
}

export function getDemoCanvasElement(): HTMLCanvasElement | undefined {
  return canvasEl;
}

/**
 * Stops the worker loop. Does not stop any MediaStreamTrack.
 */
export function stopDemoCanvasWorkerAnimation(): void {
  worker?.postMessage({ type: 'stop' });
  worker?.terminate();
  worker = undefined;
  canvasEl = undefined;
}

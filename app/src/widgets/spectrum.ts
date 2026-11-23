// Visualizer frames (levels then peaks, 0–255) arrive about 60 times a second. They bypass the
// stores: the visualizer draws them straight to its canvas.
type Listener = (levels: readonly number[]) => void;

const listeners = new Set<Listener>();

export function emitSpectrum(levels: readonly number[]): void {
  for (const l of listeners) l(levels);
}

export function onSpectrum(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

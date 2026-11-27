// Visualizer audio frames arrive about 60 times a second. They bypass the stores so the
// visualizer draws them straight to its canvas/WebGL surface.
export interface StereoFrame {
  leftRms: number;
  rightRms: number;
  left: readonly number[];
  right: readonly number[];
}

type SpectrumListener = (levels: readonly number[]) => void;
type WaveformListener = (samples: readonly number[]) => void;
type StereoListener = (frame: StereoFrame) => void;

const spectrumListeners = new Set<SpectrumListener>();
const waveformListeners = new Set<WaveformListener>();
const stereoListeners = new Set<StereoListener>();

export function emitSpectrum(levels: readonly number[]): void {
  for (const l of spectrumListeners) l(levels);
}

export function onSpectrum(listener: SpectrumListener): () => void {
  spectrumListeners.add(listener);
  return () => {
    spectrumListeners.delete(listener);
  };
}

export function emitWaveform(samples: readonly number[]): void {
  for (const l of waveformListeners) l(samples);
}

export function onWaveform(listener: WaveformListener): () => void {
  waveformListeners.add(listener);
  return () => {
    waveformListeners.delete(listener);
  };
}

export function emitStereo(frame: StereoFrame): void {
  for (const l of stereoListeners) l(frame);
}

export function onStereo(listener: StereoListener): () => void {
  stereoListeners.add(listener);
  return () => {
    stereoListeners.delete(listener);
  };
}

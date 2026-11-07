// Interpolation name resolution matching matplotlib.image._resample.
export type InterpName = 'nearest' | 'none' | 'antialiased' | 'auto' | 'hanning';

/** Resolve auto/antialiased → nearest | hanning, as matplotlib.image._resample. */
export function resolveInterp(interp: InterpName, dataW: number, dataH: number, dispW: number, dispH: number): 'nearest' | 'hanning' {
  if (interp === 'nearest' || interp === 'none') return 'nearest';
  if (interp === 'hanning') return 'hanning';
  const dispx = Math.abs(dispW), dispy = Math.abs(dispH);
  if (((dispx > 3 * dataW || dispx === dataW || dispx === 2 * dataW)
    && (dispy > 3 * dataH || dispy === dataH || dispy === 2 * dataH))) {
    return 'nearest';
  }
  return 'hanning';
}

/** dispx/dataW factor used by matplotlib interpolation_stage auto. */
export function interpolationStage(dataW: number, dataH: number, dispW: number, dispH: number): 'data' | 'rgba' {
  const dispx = Math.abs(dispW) / dataW, dispy = Math.abs(dispH) / dataH;
  return (dispx < 3 || dispy < 3) ? 'data' : 'rgba';
}

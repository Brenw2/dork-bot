// Page zoom for the desktop app (card 33, Dynamic Type): Ctrl + / Ctrl - / Ctrl 0, and Ctrl + the mouse wheel.
// The window has no menu (`removeMenu`), and Electron's zoom shortcuts live in the menu, so without this the keys do
// nothing. Pure functions, so test/desktopZoom.test.ts can check them without Electron.

/** Electron's zoom levels: 0 is 100%, each step is 20% (1.2 ** level). */
export const ZOOM_STEP = 0.5;
export const ZOOM_MIN = -3; // about 58%
export const ZOOM_MAX = 5; // about 249%

/**
 * What a key press asks for: 'in', 'out', 'reset', or null (not a zoom key). `input` is Electron's before-input-event
 * input: { type, key, control, meta, alt }. Ctrl, or Cmd on a Mac.
 */
export function zoomAction(input) {
  if (!input || input.type !== 'keyDown' || input.alt) return null;
  if (!(input.control || input.meta)) return null;
  const k = input.key;
  if (k === '+' || k === '=' || k === 'Add') return 'in';
  if (k === '-' || k === '_' || k === 'Subtract') return 'out';
  if (k === '0') return 'reset';
  return null;
}

/** The next zoom level for an action, held between ZOOM_MIN and ZOOM_MAX. */
export function nextZoom(level, action) {
  if (action === 'reset') return 0;
  const next = level + (action === 'in' ? ZOOM_STEP : action === 'out' ? -ZOOM_STEP : 0);
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
}

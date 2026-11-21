import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nextZoom, ZOOM_MAX, ZOOM_MIN, zoomAction } from '../desktop/zoom.mjs';

const key = (k: string, extra: object = {}) => ({ type: 'keyDown', key: k, control: true, ...extra });

describe('desktop zoom keys (the window has no menu, so main.mjs handles them)', () => {
  it('ships zoom.mjs and main.mjs uses it', () => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    expect(JSON.parse(readFileSync(join(root, 'desktop/package.json'), 'utf8')).build.files).toContain('zoom.mjs');
    expect(readFileSync(join(root, 'desktop/main.mjs'), 'utf8')).toMatch(/before-input-event[\s\S]*zoomAction/);
  });
  it('Ctrl + and Ctrl = zoom in, Ctrl - zooms out, Ctrl 0 resets', () => {
    expect(zoomAction(key('+'))).toBe('in');
    expect(zoomAction(key('=', { shift: false }))).toBe('in');
    expect(zoomAction(key('-'))).toBe('out');
    expect(zoomAction(key('0'))).toBe('reset');
    expect(zoomAction({ type: 'keyDown', key: '+', control: false, meta: true })).toBe('in');
  });
  it('ignores everything else', () => {
    expect(zoomAction(key('a'))).toBeNull();
    expect(zoomAction({ type: 'keyDown', key: '-' })).toBeNull(); // a plain minus is typing
    expect(zoomAction(key('-', { alt: true }))).toBeNull();
    expect(zoomAction({ type: 'keyUp', key: '-', control: true })).toBeNull();
    expect(zoomAction(null)).toBeNull();
  });
  it('steps and stays in range', () => {
    expect(nextZoom(0, 'in')).toBe(0.5);
    expect(nextZoom(0.5, 'out')).toBe(0);
    expect(nextZoom(2, 'reset')).toBe(0);
    expect(nextZoom(ZOOM_MAX, 'in')).toBe(ZOOM_MAX);
    expect(nextZoom(ZOOM_MIN, 'out')).toBe(ZOOM_MIN);
  });
});

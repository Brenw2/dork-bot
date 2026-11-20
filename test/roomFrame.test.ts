import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Card 29: the group chat has to be built like the 1:1 chat, or the message box ends up under the keyboard on a
// real device. These read the source so they hold without a device.
const root = fileURLToPath(new URL('..', import.meta.url));
const read = (p: string) => readFileSync(join(root, p), 'utf8');

function sources(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(join(root, dir))) {
    if (f === 'node_modules' || f.startsWith('.')) continue;
    const rel = join(dir, f);
    if (statSync(join(root, rel)).isDirectory()) sources(rel, out);
    else if (/\.(tsx?|mjs)$/.test(f)) out.push(rel);
  }
  return out;
}

describe('room screen frame', () => {
  it('room/[id] and chat/[bot] both draw their own header (headerShown: false)', () => {
    const layout = read('app/_layout.tsx');
    expect(layout).toMatch(/name="room\/\[id\]" options=\{\{[^}]*headerShown: false/);
    expect(layout).toMatch(/name="chat\/\[bot\]" options=\{\{[^}]*headerShown: false/);
  });

  it('the room route sets no native header options', () => {
    expect(read('app/room/[id].tsx')).not.toMatch(/Stack\.Screen|headerSides|headerTitle/);
  });

  it('ChatView and RoomChat both render through ScreenFrame', () => {
    for (const f of ['components/ChatView.tsx', 'components/RoomChat.tsx']) {
      const src = read(f);
      expect(src, f).toContain('<ScreenFrame');
      expect(src, f).not.toContain('KeyboardAvoidingView');
    }
  });

  it('ScreenFrame uses offset 0 and pads on iOS', () => {
    const src = read('components/ScreenFrame.tsx');
    expect(src).toContain('KEYBOARD_OFFSET = 0');
    expect(src).toContain('keyboardVerticalOffset={KEYBOARD_OFFSET}');
    expect(src).toContain("'padding'");
  });

  it('no computed keyboard offset anywhere', () => {
    expect(existsSync(join(root, 'lib/keyboardOffset.ts'))).toBe(false);
    const bad = sources('app')
      .concat(sources('components'), sources('lib'))
      .filter((f) => {
        const s = read(f);
        const kvo = [...s.matchAll(/keyboardVerticalOffset=\{([^}]*)\}/g)].map((m) => m[1]);
        return /keyboardOffset|measureInWindow|useHeaderHeight/.test(s) || kvo.some((v) => v !== '0' && v !== 'KEYBOARD_OFFSET');
      });
    expect(bad).toEqual([]);
  });

  it('the header menu has no gear; ⋯ is the one button', () => {
    const src = read('components/RoomChat.tsx');
    expect(src).not.toContain('⚙');
    expect(src).not.toContain('Group settings');
    expect(src).toContain('name="ellipsis"');
  });
});

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Guards for docs/design/UI-KIT.md (card 31). Plain source scans, like test/headerItems.test.ts: a screen that drifts
// from the kit fails here instead of in review. Each guard has a short allow-list; a new entry needs Design's OK.
const root = fileURLToPath(new URL('..', import.meta.url));
const read = (p: string) => readFileSync(join(root, p), 'utf8');

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(join(root, dir))) {
    if (f === 'node_modules' || f.startsWith('.')) continue;
    const rel = `${dir}/${f}`;
    if (statSync(join(root, rel)).isDirectory()) walk(rel, out);
    else if (/\.tsx?$/.test(f)) out.push(rel);
  }
  return out;
}

const files = [...walk('app'), ...walk('components')];
/** The source without comments, so a doc line that names a glyph or a key is not a violation. */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const offenders = (test: (path: string, src: string) => boolean) => files.filter((f) => test(f, code(f)));

/** The opening tags of a JSX element, up to the `>` that ends a line (arrow functions end in `=>`, which is skipped). */
function tags(src: string, name: string): string[] {
  return [...src.matchAll(new RegExp(`<${name}\\b[\\s\\S]*?[^=]>[ \\t]*(?:\\r?\\n|$)`, 'g'))].map((m) => m[0]);
}

describe('G1 headers: only the shared header files set header options', () => {
  const KEYS = /\b(headerLeft|headerRight|unstable_headerLeftItems|unstable_headerRightItems|headerTitle)\b|\bheaderSides\(/;
  const ALLOW = ['components/Sheet.tsx', 'components/ChatHeader.tsx'];
  it('no screen or component builds its own header items', () => {
    expect(offenders((f, s) => !ALLOW.includes(f) && KEYS.test(s))).toEqual([]);
  });
});

describe('G2 icons: AppIcons only', () => {
  const union = read('components/AppIcons.tsx').match(/export type IconName =([^;]*);/)![1];
  const names = new Set([...union.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]));
  it('every <Icon name="..."> literal is in IconName', () => {
    const bad: string[] = [];
    for (const f of files) for (const m of code(f).matchAll(/<Icon\b[^>]*?\bname="([^"]+)"/g)) if (!names.has(m[1])) bad.push(`${f}: ${m[1]}`);
    expect(bad).toEqual([]);
  });
  // BotSprite draws sprites, UsageParts the gauge and the chart (the provider chip glyph in it is a follow-up).
  const SVG_OK = ['components/AppIcons.tsx', 'components/BotSprite.tsx', 'components/UsageParts.tsx'];
  it('react-native-svg is imported only where something is drawn that is not an icon', () => {
    expect(offenders((f, s) => !SVG_OK.includes(f) && /react-native-svg/.test(s))).toEqual([]);
  });
  it('icons.tsx is gone, and ChatIcons.tsx draws nothing itself', () => {
    expect(files).not.toContain('components/icons.tsx');
    if (files.includes('components/ChatIcons.tsx')) expect(code('components/ChatIcons.tsx')).not.toMatch(/react-native-svg|<Svg|<Path/);
  });
});

describe('G3 buttons: one button set', () => {
  // Buttons.tsx is the set; Sheet and Overlay draw header controls; Composer draws the round Send/Stop (K3).
  const ALLOW = ['components/Buttons.tsx', 'components/Sheet.tsx', 'components/Overlay.tsx', 'components/Composer.tsx'];
  // Still to move onto Chip / Badge / ErrorBanner (K9, K10: ChatErrors, ChatHeader and UsageParts banner buttons, the
  // step chip, the Jump pill, the gauge pill). Each leaves this list when its component lands.
  const PENDING = ['components/ChatErrors.tsx', 'components/ChatHeader.tsx', 'components/ChatStatus.tsx', 'components/JumpPill.tsx', 'components/UsageParts.tsx'];
  function handBuilt(f: string, src: string): boolean {
    if (ALLOW.includes(f) || PENDING.includes(f)) return false;
    const pill = (s: string) => {
      const radius = [...s.matchAll(/borderRadius:\s*(\d+)/g)].some((m) => Number(m[1]) >= 15);
      const fill = /backgroundColor/.test(s);
      const size = /\bheight:\s*(50|44)\b/.test(s);
      return (radius && fill) || (radius && size);
    };
    // Style entries of this file by name, so `style={styles.x}` on a Pressable can be checked.
    const entries = new Map<string, string>();
    for (const m of src.matchAll(/^\s*(\w+):\s*\{([^{}]*)\},?\s*$/gm)) entries.set(m[1], m[2]);
    return tags(src, 'Pressable').some((tag) => {
      if (pill(tag)) return true;
      return [...tag.matchAll(/styles\.(\w+)/g)].some((m) => pill(entries.get(m[1]) ?? ''));
    });
  }
  it('no Pressable is a hand-built pill (radius >= 15 with a fill, or a 44/50 tall rounded button)', () => {
    expect(offenders(handBuilt)).toEqual([]);
  });
});

describe('G4 no glyph icons', () => {
  // Markdown renders message content. Composer's remove-thumbnail glyph waits for the paste-photos PR (it edits that file).
  const ALLOW = ['components/Markdown.tsx', 'components/Composer.tsx'];
  const GLYPHS = /[⚙⋯✓✕›‹⌄▾▸↻＋⚠]/;
  it('no text glyph is used as an icon', () => {
    expect(offenders((f, s) => !ALLOW.includes(f) && GLYPHS.test(s))).toEqual([]);
  });
});

describe('G6 switches', () => {
  it('every <Switch> spreads switchProps', () => {
    expect(offenders((_f, s) => tags(s, 'Switch').some((t) => !/\.\.\.switchProps/.test(t)))).toEqual([]);
  });
});

describe('G9 sheet header', () => {
  const layout = read('app/_layout.tsx');
  // Popups that are only a popup on desktop (Usage) draw their own page header on the phone.
  const popups = [...layout.matchAll(/<Stack\.Screen name="([^"]+)" options=\{popup\(/g)].map((m) => m[1]);
  it('finds the popups', () => {
    expect(popups.length).toBeGreaterThan(10);
  });
  for (const name of popups) {
    it(`${name} renders <Sheet title="...">`, () => {
      const path = name === 'room-new' ? 'app/room-new.tsx' : `app/${name}.tsx`;
      const screen = read(path);
      // A screen may hand the sheet to a component it renders (room-new is RoomNew).
      const parts = [screen, ...[...screen.matchAll(/from '@\/components\/(\w+)'/g)].map((m) => (files.includes(`components/${m[1]}.tsx`) ? read(`components/${m[1]}.tsx`) : ''))];
      const title = parts.join('\n').match(/<Sheet\b[^>]*?\btitle=(?:"([^"]+)"|\{(\w+)\})/);
      expect(title, `${path} has no <Sheet title>`).not.toBeNull();
    });
  }
});

describe('G11 menu icons', () => {
  // Composer's "Add a picture" menu (paste-photos PR edits that file) is the one without icons.
  const ALLOW = ['components/Composer.tsx'];
  it('every Menu.show item except Cancel has an icon', () => {
    const bad: string[] = [];
    for (const f of files) {
      if (ALLOW.includes(f)) continue;
      const src = code(f);
      for (const m of src.matchAll(/Menu\.show\(/g)) {
        const rest = src.slice(m.index!);
        const open = rest.indexOf('[');
        let depth = 0;
        let end = open;
        for (; end < rest.length; end++) {
          if (rest[end] === '[') depth++;
          else if (rest[end] === ']' && --depth === 0) break;
        }
        const list = rest.slice(open, end);
        for (const it of list.matchAll(/\{\s*text:[^{}]*\}/g)) {
          if (/style:\s*'cancel'/.test(it[0])) continue;
          if (!/\bicon:/.test(it[0])) bad.push(`${f}: ${it[0].slice(0, 60)}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

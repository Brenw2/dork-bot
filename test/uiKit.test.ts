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
  it('icons.tsx and ChatIcons.tsx are gone', () => {
    expect(files).not.toContain('components/icons.tsx');
    expect(files).not.toContain('components/ChatIcons.tsx');
  });
});

describe('G3 buttons: one button set', () => {
  // Buttons.tsx is the set; Sheet and Overlay draw header controls; Composer draws the round Send/Stop (K3).
  const ALLOW = ['components/Buttons.tsx', 'components/Sheet.tsx', 'components/Overlay.tsx', 'components/Composer.tsx'];
  // Design-specified controls that are not buttons from the set: the floating Jump pill (K13), the usage gauge pill,
  // the segmented control. Each has its own spec in the kit or the comps.
  const PENDING = ['components/JumpPill.tsx', 'components/UsageParts.tsx'];
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
  // Markdown renders message content.
  const ALLOW = ['components/Markdown.tsx'];
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
  it('every Menu.show item except Cancel has an icon', () => {
    const bad: string[] = [];
    for (const f of files) {
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

describe('G5 no hex in screens and components', () => {
  // Sprites draw pixel art; Markdown's syntax colors wait for the theme work; theme.tsx owns the white switch thumb;
  // pickImages.web paints a canvas, not UI.
  const ALLOW = ['components/BotSprite.tsx', 'components/Markdown.tsx', 'components/theme.tsx', 'components/pickImages.web.ts'];
  it('no #hex color literal outside the theme', () => {
    expect(offenders((f, s) => !ALLOW.includes(f) && /['"`]#[0-9a-fA-F]{3,8}['"`]/.test(s))).toEqual([]);
  });
});

describe('G7 states: empty, loading and error go through the shared components', () => {
  it('no screen or component styles its own empty or error text', () => {
    expect(offenders((f, s) => f !== 'components/States.tsx' && /styles\.(empty|error)\b/.test(s))).toEqual([]);
  });
  it('no page spinner is hand-placed: <ActivityIndicator style={{ marginTop }}> becomes <Loading>', () => {
    const bad: string[] = [];
    for (const f of files.filter((x) => x !== 'components/States.tsx')) {
      for (const m of code(f).matchAll(/<ActivityIndicator[^>]*marginTop[^>]*>/g)) bad.push(`${f}: ${m[0].slice(0, 70)}`);
    }
    expect(bad).toEqual([]);
  });
  it('every app/ screen that spins a page spinner imports Loading', () => {
    const bad = files.filter((f) => f.startsWith('app/') && /<ActivityIndicator/.test(code(f)) && !/\bLoading\b/.test(code(f)) && !/right=|size="small"/.test(code(f)));
    expect(bad).toEqual([]);
  });
  it('a raw <TextInput> is only in Field, SearchField, the Composer, Dialogs (the desktop prompt) and the select-text screen', () => {
    const ALLOW = ['components/Fields.tsx', 'components/Composer.tsx', 'components/Dialogs.tsx', 'app/select-text.tsx'];
    expect(offenders((f, s) => !ALLOW.includes(f) && /<TextInput\b/.test(s))).toEqual([]);
  });
});

describe('G8 rooms share the chat surface', () => {
  const room = read('components/RoomChat.tsx');
  it('RoomChat draws the shared header, composer and jump pill', () => {
    expect(room).toMatch(/from '@\/components\/ChatHeader'/);
    expect(room).toMatch(/from '@\/components\/Composer'/);
    expect(room).toMatch(/from '@\/components\/JumpPill'/);
    expect(room).toContain('<JumpPill');
    expect(room).toContain('<PageHeader');
  });
  it('and has no keyboard strategy of its own', () => {
    expect(room).not.toMatch(/KeyboardAvoidingView|keyboardOffset|measureInWindow/);
  });
});

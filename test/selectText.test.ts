import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Source scans for card 32 (select part of a message). The behaviour itself is in the layout suite (desktop drag and
// copy, the sheet's boxes) and on a device (iOS selection handles); these keep the wiring from drifting.
const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('Select Text wiring', () => {
  it('the sheet is a read-only, non-scrolling multiline TextInput under the shared sheet header', () => {
    const src = read('app/select-text.tsx');
    expect(src).toContain('<Sheet title="Select Text"');
    expect(src).toContain('editable={false}');
    expect(src).toContain('scrollEnabled={false}');
    expect(src).toContain('multiline');
    expect(src).toContain('Copy All');
    expect(src).toMatch(/fontFamily: mono/); // code stays monospaced
  });

  it('is a registered sheet route', () => {
    const layout = read('app/_layout.tsx');
    expect(layout).toContain("'select-text'");
    expect(layout).toContain('<Stack.Screen name="select-text"');
  });

  it('every place that shows a message offers the menu: chat, group, work session (via Reply/Mine), routine cards and results', () => {
    for (const f of ['components/ChatView.tsx', 'components/RoomChat.tsx', 'components/RoutineCard.tsx', 'app/routine-results/[bot].tsx', 'app/routines/[bot].tsx']) {
      expect(read(f), f).toContain("from '@/components/MessageMenu'");
    }
    const work = read('app/work-session/[bot].tsx');
    expect(work).toContain('<Mine');
    expect(work).toContain('<Reply');
  });

  it('the menu has Copy, Select Text and Cancel, and on the web adds no Pressable that could capture a drag', () => {
    const src = read('components/MessageMenu.tsx');
    expect(src).toContain("text: 'Copy'");
    expect(src).toContain("text: 'Select Text'");
    expect(src).toContain("style: 'cancel'");
    expect(src).toMatch(/if \(WEB_SELECT\) return <View style=\{style\}>\{children\}<\/View>/);
  });

  it('message text is mouse-selectable on the web and never switches selection off', () => {
    const md = read('components/Markdown.tsx');
    expect(md).toContain("const SELECTABLE = Platform.OS === 'web'");
    expect(md).not.toMatch(/<Text[^>]*\sselectable(\s|>)/); // always selectable={SELECTABLE}
    for (const f of ['components/Markdown.tsx', 'components/ChatView.tsx', 'components/RoomChat.tsx', 'components/RoutineCard.tsx', 'components/MessageMenu.tsx', 'app/select-text.tsx']) {
      expect(read(f), f).not.toMatch(/userSelect\s*:\s*['"]none['"]|user-select:\s*none/);
    }
  });
});

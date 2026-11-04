import { describe, expect, it } from 'vitest';
import { attachmentProblem, dataUrlBytes, fitSize, MAX_IMAGES, messageBody, splitStoredImages } from '@/lib/attachments';
import { chatReducer, initialChat } from '@/lib/chatState';
import { toChatMessages } from '@/lib/hermes';
import { colorFor, highlight, languageFor, parseHtml } from '@/lib/highlight';
import { mix, onColor } from '@/lib/color';

// The exact text Hermes stored for a message with one picture (b-lab, 2026-11-04, chief).
const STORED =
  'What word and number are written in this image? Answer in five words or fewer.\n\n' +
  '[Image attached at: /home/b/.hermes/profiles/chief/cache/documents/native-inputs/b9bd/api_b9bd.png]\n[screenshot]';

describe('pictures in chats', () => {
  it('sends text plus image parts, the shape Hermes accepted live', () => {
    expect(messageBody('hi', [])).toBe('hi');
    expect(messageBody('what is this?', [{ dataUrl: 'data:image/jpeg;base64,AAAA' }])).toEqual([
      { type: 'text', text: 'what is this?' },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } },
    ]);
    // A picture alone still carries text, which Hermes requires.
    expect((messageBody('  ', [{ dataUrl: 'data:image/png;base64,A' }]) as { text?: string }[])[0].text).toBe('Here’s a picture.');
  });

  it("reads Hermes's stored message back into text and picture paths", () => {
    expect(splitStoredImages(STORED)).toEqual({
      text: 'What word and number are written in this image? Answer in five words or fewer.',
      images: ['/home/b/.hermes/profiles/chief/cache/documents/native-inputs/b9bd/api_b9bd.png'],
    });
    expect(splitStoredImages('Here’s a picture.\n\n[Image attached at: /x/a.png]\n[screenshot]')).toEqual({ text: '', images: ['/x/a.png'] });
    expect(splitStoredImages('plain [Image] talk')).toEqual({ text: 'plain [Image] talk', images: [] });
    const [m] = toChatMessages([{ id: 7, role: 'user', content: STORED, timestamp: 1 }]);
    expect(m).toMatchObject({ role: 'user', images: ['/home/b/.hermes/profiles/chief/cache/documents/native-inputs/b9bd/api_b9bd.png'] });
    expect(m.content).not.toContain('Image attached');
  });

  it('shows a just-sent picture at once, before the history reloads', () => {
    const s = chatReducer(initialChat, { type: 'send', text: 'look', images: ['data:image/jpeg;base64,AA'] });
    expect(s.messages[0]).toMatchObject({ role: 'user', content: 'look', localImages: ['data:image/jpeg;base64,AA'] });
  });

  it('keeps a message under the 10 MB request limit and the picture count', () => {
    const big = { dataUrl: `data:image/jpeg;base64,${'A'.repeat(8_000_000)}` };
    expect(dataUrlBytes(big.dataUrl)).toBe(6_000_000);
    expect(attachmentProblem([big])).toBeNull();
    expect(attachmentProblem([big, big])).toMatch(/too big/);
    expect(attachmentProblem(Array.from({ length: MAX_IMAGES + 1 }, () => ({ dataUrl: 'data:image/png;base64,A' })))).toMatch(/Up to/);
  });

  it('shrinks to 2000 px on the long side, never up', () => {
    expect(fitSize(4032, 3024)).toEqual({ width: 2000, height: 1500 });
    expect(fitSize(1170, 2532)).toEqual({ width: 924, height: 2000 });
    expect(fitSize(800, 600)).toEqual({ width: 800, height: 600 });
  });
});

describe('code highlighting', () => {
  it('colors keywords, strings and numbers, line by line', () => {
    const lines = highlight('const x = "hi";\nreturn 42;', 'ts');
    expect(lines).toHaveLength(2);
    expect(lines[0].find((t) => t.text === 'const')?.scope).toBe('keyword');
    expect(lines[0].find((t) => t.text === '"hi"')?.scope).toBe('string');
    expect(lines[1].find((t) => t.text === '42')?.scope).toBe('number');
    expect(lines.map((l) => l.map((t) => t.text).join('')).join('\n')).toBe('const x = "hi";\nreturn 42;');
  });

  it('turns escaped characters back into code', () => {
    const lines = highlight('if (a < b && c > "d") {}', 'js');
    expect(lines[0].map((t) => t.text).join('')).toBe('if (a < b && c > "d") {}');
  });

  it('keeps multi-line tokens (block comments, strings) colored on every line', () => {
    const lines = highlight('/* one\ntwo */\nx = 1', 'javascript');
    expect(lines[0][0]).toEqual({ text: '/* one', scope: 'comment' });
    expect(lines[1][0]).toEqual({ text: 'two */', scope: 'comment' });
  });

  it('knows the fence names bots use, and leaves unknown ones plain', () => {
    expect(languageFor('sh')).toBe('bash');
    expect(languageFor('TSX')).toBe('typescript');
    expect(languageFor('python title="x.py"')).toBe('python');
    expect(languageFor('klingon')).toBeNull();
    expect(highlight('just text', 'klingon')).toEqual([[{ text: 'just text', scope: null }]]);
    expect(highlight('', undefined)).toEqual([[{ text: '', scope: null }]]);
  });

  it('parses nested spans to the innermost scope', () => {
    expect(parseHtml('<span class="hljs-meta">#!<span class="hljs-keyword">x</span></span>y')).toEqual([
      { text: '#!', scope: 'meta' },
      { text: 'x', scope: 'keyword' },
      { text: 'y', scope: null },
    ]);
    expect(colorFor('title.function')).toBeDefined();
    expect(colorFor('title.function.invoke')).toBeDefined();
    expect(colorFor(null)).toBeUndefined();
  });
});

describe('bot colors on buttons', () => {
  it('picks readable text for every bot color in the palette', () => {
    for (const c of ['#8B7CF6', '#4CC38A', '#F2A65A', '#5AB0F2', '#F06A9A', '#C8D35A', '#FFFFFF', '#222222']) {
      const t = onColor(c);
      expect(['#FFFFFF', '#0F1012']).toContain(t);
    }
    expect(onColor('#C8D35A')).toBe('#0F1012'); // light lime: dark text
    expect(onColor('#222222')).toBe('#FFFFFF');
    expect(mix('#FFFFFF', 0)).toBe('#0f1012');
    expect(mix('#FFFFFF', 1)).toBe('#ffffff');
  });
});

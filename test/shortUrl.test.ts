import { describe, expect, it } from 'vitest';
import { isBareLink, shortUrl, URL_MAX } from '@/lib/shortUrl';

describe('shortUrl', () => {
  it('drops the scheme', () => {
    expect(shortUrl('https://github.com/Brenw2/dork-bot')).toBe('github.com/Brenw2/dork-bot');
    expect(shortUrl('http://a.co')).toBe('a.co');
  });
  it('cuts a long one to 40 characters with an ellipsis', () => {
    const s = shortUrl('https://github.com/Brenw2/dork-bot/blob/main/docs/design/REVIEW.md');
    expect([...s].length).toBeLessThanOrEqual(URL_MAX);
    expect(s.endsWith('…')).toBe(true);
    expect(s.startsWith('github.com/Brenw2/dork-bot/blob/main/')).toBe(true);
  });
  it('leaves exactly 40 alone', () => {
    const u = 'a'.repeat(URL_MAX);
    expect(shortUrl(`https://${u}`)).toBe(u);
  });
  it('knows a bare link from a named one', () => {
    expect(isBareLink('https://x.co/a', 'https://x.co/a')).toBe(true);
    expect(isBareLink('the docs', 'https://x.co/a')).toBe(false);
  });
});

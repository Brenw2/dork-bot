// Bot replies as formatted text: markdown parsed with marked's lexer and drawn with React Native
// components, so it looks the same on the phone and the desktop (no WebView). Code blocks get
// syntax colors (lib/highlight.ts), a language label, Copy, and sideways scrolling.
import * as Clipboard from 'expo-clipboard';
import { memo, useMemo, useState, type ReactNode } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View, type TextStyle } from 'react-native';
import { marked, type Token, type Tokens } from 'marked';
import { colorFor, highlight, languageFor } from '@/lib/highlight';
import { onColor } from '@/lib/color';
import { mono } from '@/lib/theme';
import { isDesktop } from '@/components/desktop';
import { isBareLink, shortUrl } from '@/lib/shortUrl';
import { Icon } from '@/components/AppIcons';
import { splitStreaming } from '@/lib/streamBlocks';
import { decodeEntities } from '@/lib/plainText';
import { makeStyles, useTheme } from '@/components/theme';
import type { Colors } from '@/lib/themes';

// Code shows the exact characters: no ligatures (">=" must not turn into "≥"), and a real
// programming font where the desktop has one.
const CODE_FONT = Platform.OS === 'web' ? 'ui-monospace, "JetBrains Mono", "Fira Code", "Cascadia Mono", Menlo, Consolas, monospace' : mono;
export const NO_LIGATURES = Platform.OS === 'web' ? ({ fontVariantLigatures: 'none', fontFeatureSettings: '"liga" 0, "calt" 0' } as object) : null;

// Web and desktop: drag-select any part of a reply with the mouse. Phone: not selectable here, because iOS can only copy
// the whole block and the touch is taken from the long press; <MessageMenu> offers Copy and Select Text instead.
const SELECTABLE = Platform.OS === 'web';

/** Reply text size: 17 on the phone, 16 on the desktop (design fix 7). Lines are 24 on both. */
export const BODY_SIZE = isDesktop ? 16 : 17;

/**
 * A reply that is still arriving: finished blocks are formatted, the last open block is plain text (an open code
 * fence is plain monospace inside its box), so half-written markdown doesn't flicker or reflow what's on screen.
 * When the reply ends the whole text is formatted at once: the same result as a reply loaded from history.
 */
export function StreamingMarkdown({ text, accent }: { text: string; accent: string }) {
  const styles = useStyles();
  const { done, open, fence } = useMemo(() => splitStreaming(text), [text]);
  return (
    <View style={styles.doc}>
      {done.trim() ? <Markdown text={done} accent={accent} /> : null}
      {open.trim() ? <Text style={styles.p}>{open.replace(/\s+$/, '')}</Text> : null}
      {fence ? <CodeBlock code={fence.code} lang={fence.lang} plain /> : null}
    </View>
  );
}

export const Markdown = memo(function Markdown({ text, accent }: { text: string; accent: string }) {
  const { colors, theme } = useTheme();
  const styles = useStyles();
  const tokens = useMemo(() => {
    try {
      return marked.lexer(text, { gfm: true, breaks: false });
    } catch {
      return null;
    }
  }, [text]);
  if (!tokens) return <Text style={styles.p}>{text}</Text>;
  return <View style={styles.doc}>{blocks(tokens, accent, { styles, colors, marks: theme.shape.brackets })}</View>;
});

function blocks(tokens: Token[], accent: string, look: Look, keyPrefix = ''): ReactNode[] {
  const { colors, styles } = look;
  const out: ReactNode[] = [];
  tokens.forEach((t, i) => {
    const key = `${keyPrefix}${i}`;
    switch (t.type) {
      case 'space':
        break;
      case 'paragraph':
        out.push(
          <Text key={key} style={styles.p} selectable={SELECTABLE}>
            {inline((t as Tokens.Paragraph).tokens, accent, look)}
          </Text>,
        );
        break;
      case 'text': {
        // Tight list items hold their text as a "text" token with inline children.
        const tt = t as Tokens.Text;
        out.push(
          <Text key={key} style={styles.p} selectable={SELECTABLE}>
            {tt.tokens ? inline(tt.tokens, accent, look) : tt.text}
          </Text>,
        );
        break;
      }
      case 'heading': {
        const h = t as Tokens.Heading;
        // Terminal: a heading is the accent color behind its "##" marks, like markdown source.
        out.push(
          <Text key={key} style={[styles.h, heading(colors)[Math.min(h.depth, 4) - 1], look.marks && { color: colors.accent }]} selectable={SELECTABLE} accessibilityRole="header">
            {look.marks ? `${'#'.repeat(Math.min(h.depth, 6))} ` : null}
            {inline(h.tokens, accent, look)}
          </Text>,
        );
        break;
      }
      case 'code': {
        const c = t as Tokens.Code;
        out.push(<CodeBlock key={key} code={c.text} lang={c.lang} />);
        break;
      }
      case 'blockquote':
        out.push(
          <View key={key} style={[styles.quote, { borderLeftColor: accent }]}>
            {blocks((t as Tokens.Blockquote).tokens, accent, look, `${key}.`)}
          </View>,
        );
        break;
      case 'list': {
        const l = t as Tokens.List;
        const start = typeof l.start === 'number' ? l.start : 1;
        out.push(
          <View key={key} style={styles.list}>
            {l.items.map((item, j) => (
              <View key={j} style={styles.item}>
                {item.task ? (
                  <View
                    style={[styles.check, item.checked ? { backgroundColor: accent, borderColor: accent } : { borderColor: colors.dim }]}
                    accessibilityLabel={item.checked ? 'Done' : 'Not done'}
                  >
                    {item.checked ? <Text style={[styles.checkMark, { color: onColor(accent) }]}>✓</Text> : null}
                  </View>
                ) : (
                  <Text style={[styles.marker, l.ordered ? styles.number : { color: accent }]}>{l.ordered ? `${start + j}.` : '•'}</Text>
                )}
                <View style={styles.itemBody}>{blocks(item.tokens, accent, look, `${key}.${j}.`)}</View>
              </View>
            ))}
          </View>,
        );
        break;
      }
      case 'table':
        out.push(<Table key={key} table={t as Tokens.Table} accent={accent} />);
        break;
      case 'hr':
        out.push(<View key={key} style={styles.hr} />);
        break;
      case 'html':
        out.push(
          <Text key={key} style={styles.p} selectable={SELECTABLE}>
            {(t as Tokens.HTML).text.trim()}
          </Text>,
        );
        break;
      default:
        if ('text' in t && typeof t.text === 'string') {
          out.push(
            <Text key={key} style={styles.p} selectable={SELECTABLE}>
              {t.text}
            </Text>,
          );
        }
    }
  });
  return out;
}

function inline(tokens: Token[] | undefined, accent: string, look: Look): ReactNode[] {
  const { styles } = look;
  if (!tokens) return [];
  return tokens.map((t, i) => {
    switch (t.type) {
      case 'strong':
        return (
          <Text key={i} style={styles.strong}>
            {inline((t as Tokens.Strong).tokens, accent, look)}
          </Text>
        );
      case 'em':
        return (
          <Text key={i} style={styles.em}>
            {inline((t as Tokens.Em).tokens, accent, look)}
          </Text>
        );
      case 'del':
        return (
          <Text key={i} style={styles.del}>
            {inline((t as Tokens.Del).tokens, accent, look)}
          </Text>
        );
      case 'codespan':
        return (
          <Text key={i} style={styles.codespan}>
            {decode((t as Tokens.Codespan).text)}
          </Text>
        );
      case 'link': {
        const l = t as Tokens.Link;
        // A bare address shows short (no scheme, one line, cut at 40); a link with its own words keeps them.
        // Tap opens the full address and long-press copies it.
        const bare = isBareLink(l.text, l.href);
        return (
          <Text
            key={i}
            style={[styles.link, { color: accent }]}
            numberOfLines={bare ? 1 : undefined}
            onPress={() => void Linking.openURL(l.href)}
            onLongPress={() => void Clipboard.setStringAsync(l.href)}
            accessibilityRole="link"
            accessibilityHint={bare ? 'Opens the link. Press and hold to copy it.' : undefined}
          >
            {bare ? shortUrl(l.href) : inline(l.tokens, accent, look)}
          </Text>
        );
      }
      case 'image': {
        const im = t as Tokens.Image;
        return (
          <Text key={i} style={[styles.link, { color: accent }]} onPress={() => void Linking.openURL(im.href)} accessibilityRole="link">
            {im.text || im.href}
          </Text>
        );
      }
      case 'br':
        return '\n';
      case 'text': {
        const tt = t as Tokens.Text;
        return tt.tokens ? <Text key={i}>{inline(tt.tokens, accent, look)}</Text> : decode(tt.text);
      }
      case 'escape':
        return decode((t as Tokens.Escape).text);
      default:
        return 'text' in t && typeof t.text === 'string' ? decode(t.text) : null;
    }
  });
}

const decode = decodeEntities;

/** `plain`: no colouring (a fence still being written: colours would flicker as the code grows). */
export function CodeBlock({ code, lang, plain = false }: { code: string; lang?: string; plain?: boolean }) {
  const { colors, theme, label: say } = useTheme();
  const styles = useStyles();
  const term = theme.shape.brackets;
  const [copied, setCopied] = useState(false);
  const lines = useMemo(() => highlight(code.replace(/\n$/, ''), plain ? undefined : lang), [code, lang, plain]);
  const label = languageFor(lang) ?? (lang?.trim() || 'text');
  const copy = async () => {
    await Clipboard.setStringAsync(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <View style={styles.code}>
      <View style={styles.codeHeader}>
        <Text style={styles.codeLang}>{label}</Text>
        <Pressable onPress={copy} hitSlop={{ top: 4, bottom: 4, left: 8, right: 8 }} accessibilityRole="button" accessibilityLabel={copied ? 'Copied' : 'Copy code'} style={styles.copy}>
          {copied || term ? null : <Icon name="copy" size={15} color={colors.text} stroke={2.88} />}
          <Text style={[styles.copyText, term && { color: colors.accent }]}>{say(copied ? 'Copied' : 'Copy')}</Text>
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.codeScroll}>
        <Text style={styles.codeText} selectable={SELECTABLE}>
          {lines.map((line, i) => (
            <Text key={i}>
              {line.map((tok, j) =>
                tok.scope ? (
                  <Text key={j} style={{ color: colorFor(tok.scope) }}>
                    {tok.text}
                  </Text>
                ) : (
                  tok.text
                ),
              )}
              {i < lines.length - 1 ? '\n' : ''}
            </Text>
          ))}
        </Text>
      </ScrollView>
    </View>
  );
}

function Table({ table, accent }: { table: Tokens.Table; accent: string }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const look = { styles, colors };
  // Column width from its longest cell, within limits, so wide tables scroll sideways.
  const widths = table.header.map((h, c) => {
    const longest = Math.max(h.text.length, ...table.rows.map((r) => r[c]?.text.length ?? 0));
    return Math.min(280, Math.max(70, longest * 8 + 24));
  });
  const align = (c: number): TextStyle => ({ textAlign: (table.align[c] ?? 'left') as TextStyle['textAlign'] });
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator style={styles.tableWrap} contentContainerStyle={styles.tableBody}>
      <View style={styles.table}>
        <View style={[styles.tr, styles.thead]}>
          {table.header.map((h, c) => (
            <Text key={c} style={[styles.th, align(c), { width: widths[c] }]} selectable={SELECTABLE}>
              {inline(h.tokens, accent, look)}
            </Text>
          ))}
        </View>
        {table.rows.map((r, i) => (
          <View key={i} style={[styles.tr, i % 2 === 1 && styles.zebra]}>
            {r.map((cell, c) => (
              <Text key={c} style={[styles.td, align(c), { width: widths[c] }]} selectable={SELECTABLE}>
                {inline(cell.tokens, accent, look)}
              </Text>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

type Look = { styles: ReturnType<typeof useStyles>; colors: Colors; /** Terminal: headings show their ## marks, in the accent. */ marks?: boolean };
const BODY = BODY_SIZE;
const heading = (colors: Colors): TextStyle[] => [
  { fontSize: 22, marginTop: 6 },
  { fontSize: 19, marginTop: 4 },
  { fontSize: 17 },
  { fontSize: 16, color: colors.dim },
];

const useStyles = makeStyles(({ colors }) => StyleSheet.create({
  doc: { gap: 10 },
  p: { color: colors.text, fontSize: BODY, lineHeight: 24 },
  h: { color: colors.text, fontWeight: '700', lineHeight: 28 },
  strong: { fontWeight: '700' },
  em: { fontStyle: 'italic' },
  del: { textDecorationLine: 'line-through', color: colors.dim },
  link: { textDecorationLine: 'underline' },
  codespan: {
    fontFamily: CODE_FONT,
    ...NO_LIGATURES,
    fontSize: BODY - 2,
    backgroundColor: colors.inlineCode,
    color: colors.codeText,
    ...(Platform.OS === 'web' ? { paddingHorizontal: 5, paddingVertical: 1, borderRadius: 5 } : null),
  },
  quote: { borderLeftWidth: 3, paddingLeft: 12, gap: 8, opacity: 0.9 },
  list: { gap: 6 },
  item: { flexDirection: 'row', gap: 8 },
  marker: { color: colors.dim, fontSize: BODY, lineHeight: 24, minWidth: 16, textAlign: 'right' },
  number: { minWidth: 22, fontVariant: ['tabular-nums'] },
  itemBody: { flex: 1, gap: 6 },
  hr: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: 6 },
  code: { backgroundColor: colors.code, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, overflow: 'hidden' },
  codeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 36,
    paddingLeft: 12,
    paddingRight: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  codeLang: { color: colors.dim, fontSize: 12, fontFamily: CODE_FONT, textTransform: 'lowercase' },
  // 36 tall inside the header; hitSlop on the Pressable makes the touch area 44.
  copy: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36 },
  copyText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  codeScroll: { paddingVertical: 10, paddingHorizontal: 12 },
  codeText: { fontFamily: CODE_FONT, fontSize: 13, lineHeight: 20, color: colors.codeText, ...NO_LIGATURES },
  // Hugs the table, and scrolls sideways when it's wider than the chat.
  tableWrap: { alignSelf: 'flex-start', maxWidth: '100%', borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  tableBody: { flexGrow: 0 },
  table: {},
  check: { width: 18, height: 18, borderRadius: 5, borderWidth: 1.5, marginTop: 3, alignItems: 'center', justifyContent: 'center' },
  checkMark: { fontSize: 12, fontWeight: '800', lineHeight: 14 },
  tr: { flexDirection: 'row' },
  thead: { backgroundColor: colors.card, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  zebra: { backgroundColor: 'transparent' },
  th: { color: colors.dim, fontWeight: '600', fontSize: 13, lineHeight: 18, paddingHorizontal: 12, paddingVertical: 8 },
  td: { color: colors.text, fontSize: 15, lineHeight: 20, paddingHorizontal: 12, paddingVertical: 8 },
}));

import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTint } from '@/components/Buttons';
import { useColumnStyle } from '@/components/Column';
import { NO_LIGATURES } from '@/components/Markdown';
import { Sheet, type SheetAction } from '@/components/Sheet';
import { plainSegments, plainText } from '@/lib/plainText';
import { colors, mono } from '@/lib/theme';

// "Select Text" (card 32): one message as plain text in read-only TextInputs, so the phone's own selection works:
// handles to pick part of it, then Copy, Look Up, Share and Translate. A TextInput is used because selectable <Text>
// on iOS can only copy the whole block. Prose and code are separate boxes so code stays monospaced. Copy All is the
// sheet header's action (icon on the left, Done on the right). Phone only: the desktop selects in the chat itself.
export default function SelectTextScreen() {
  const { text = '', bot, raw } = useLocalSearchParams<{ text?: string; bot?: string; raw?: string }>();
  const column = useColumnStyle();
  const tint = useTint(bot || undefined);
  const { bottom } = useSafeAreaInsets();
  const segments = useMemo(() => (raw ? (text ? [{ kind: 'text' as const, text }] : []) : plainSegments(text)), [text, raw]);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const all = raw ? text : plainText(text);
  const copyAll = useRef(async () => {});
  copyAll.current = async () => {
    await Clipboard.setStringAsync(all);
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  };
  const action = useMemo<SheetAction>(() => ({ label: copied ? 'Copied' : 'Copy All', icon: copied ? 'check' : 'copy', onPress: () => void copyAll.current() }), [copied]);

  return (
    <View style={styles.screen}>
      <Sheet title="Select Text" bot={bot || undefined} action={action} />
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.body, column, { paddingBottom: bottom + 16 }]} keyboardShouldPersistTaps="handled">
        {segments.map((s, i) => (
          <ReadOnlyBox key={i} text={s.text} code={s.kind === 'code'} tint={tint} />
        ))}
      </ScrollView>
    </View>
  );
}

// The chat's body text (17 / 24 on the phone), so the words don't jump when the sheet opens; code 13 / 20 like the chat's code block.
const TEXT_LINE = 24;
const CODE_LINE = 20;

/**
 * Read-only, multiline, and not scrolling inside the page's scroll: it is as tall as its lines (the box's content
 * height; padding sits on the wrapper so it is never counted twice), and the page scrolls.
 */
function ReadOnlyBox({ text, code, tint }: { text: string; code: boolean; tint: string }) {
  const [height, setHeight] = useState<number | undefined>();
  const [epoch, setEpoch] = useState(0);
  const width = useRef<number | undefined>(undefined);
  const lineHeight = code ? CODE_LINE : TEXT_LINE;
  return (
    <View
      style={code ? styles.codeBox : undefined}
      // A new width re-wraps the text: forget the old height so the box is measured again (it can shrink as well as grow).
      onLayout={(e) => {
        const w = Math.round(e.nativeEvent.layout.width);
        if (w !== width.current) {
          width.current = w;
          setHeight(undefined);
          setEpoch((n) => n + 1); // a fresh box reports its content size again, even when the number is the same as before
        }
      }}
    >
      <TextInput
        key={epoch}
        value={text}
        multiline
        editable={false}
        numberOfLines={1}
        scrollEnabled={false}
        caretHidden
        selectionColor={tint}
        // Whole lines only: a measured height can carry a stray extra line, so snap it to the line grid.
        onContentSizeChange={(e) => setHeight(Math.max(1, Math.round(e.nativeEvent.contentSize.height / lineHeight)) * lineHeight)}
        accessibilityLabel={code ? 'Code' : 'Message text'}
        style={[code ? styles.code : styles.text, height ? { height } : null]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  body: { padding: 16, gap: 12 },
  text: { color: colors.text, fontSize: 17, lineHeight: TEXT_LINE, padding: 0 },
  codeBox: { backgroundColor: colors.code, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 10 },
  code: { color: colors.text, fontFamily: mono, fontSize: 13, lineHeight: CODE_LINE, padding: 0, ...NO_LIGATURES },
});

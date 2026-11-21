import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, useTint } from '@/components/Buttons';
import { useColumnStyle } from '@/components/Column';
import { Sheet } from '@/components/Sheet';
import { plainSegments, plainText } from '@/lib/plainText';
import { colors, mono } from '@/lib/theme';

// "Select Text" (card 32): one message as plain text in read-only TextInputs, so the phone's own selection works:
// handles to pick part of it, then Copy, Look Up, Share and Translate. A TextInput is used because selectable <Text>
// on iOS can only copy the whole block. Prose and code are separate boxes so code stays monospaced. Phone only: the
// desktop selects in the chat itself.
export default function SelectTextScreen() {
  const { text = '', bot, raw } = useLocalSearchParams<{ text?: string; bot?: string; raw?: string }>();
  const column = useColumnStyle();
  const tint = useTint(bot || undefined);
  const { bottom } = useSafeAreaInsets();
  const segments = useMemo(() => (raw ? (text ? [{ kind: 'text' as const, text }] : []) : plainSegments(text)), [text, raw]);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copyAll = async () => {
    await Clipboard.setStringAsync(raw ? text : plainText(text));
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  };

  return (
    <View style={styles.screen}>
      <Sheet title="Select Text" bot={bot || undefined} />
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.body, column]} keyboardShouldPersistTaps="handled">
        {segments.map((s, i) => (
          <ReadOnlyBox key={i} text={s.text} code={s.kind === 'code'} tint={tint} />
        ))}
      </ScrollView>
      <View style={[styles.footer, column, { paddingBottom: Math.max(16, bottom + 8) }]}>
        <Button label={copied ? 'Copied' : 'Copy All'} kind="secondary" bot={bot || undefined} onPress={() => void copyAll()} />
      </View>
    </View>
  );
}

/**
 * Read-only, multiline, and not scrolling inside the page's scroll: it is as tall as its text (the box's own content
 * height; padding sits on the wrapper so it is never counted twice), and the page scrolls.
 */
function ReadOnlyBox({ text, code, tint }: { text: string; code: boolean; tint: string }) {
  const [height, setHeight] = useState<number | undefined>();
  return (
    <View style={code ? styles.codeBox : undefined}>
      <TextInput
        value={text}
        multiline
        editable={false}
        scrollEnabled={false}
        caretHidden
        selectionColor={tint}
        onContentSizeChange={(e) => setHeight(Math.ceil(e.nativeEvent.contentSize.height))}
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
  // The chat's body text (17 / 24 on the phone), so the words don't jump when the sheet opens.
  text: { color: colors.text, fontSize: 17, lineHeight: 24, padding: 0 },
  codeBox: { backgroundColor: colors.code, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 10 },
  code: { color: colors.text, fontFamily: mono, fontSize: 13, lineHeight: 20, padding: 0 },
  footer: { paddingHorizontal: 16, paddingTop: 8 },
});

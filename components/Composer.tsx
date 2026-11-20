import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowUpIcon, PlusIcon, StopIcon } from '@/components/ChatIcons';
import { Menu } from '@/components/alert';
import { useDesk } from '@/components/ChatStatus';
import { PICK_SOURCES, pickImages, useImageDrop, type PickSource } from '@/components/pickImages';
import { MAX_IMAGES, type Attachment } from '@/lib/attachments';
import { isSendEnter } from '@/lib/enterKey';
import { onColor } from '@/lib/theme';
import { makeStyles, useTheme } from '@/components/theme';

const WEB = Platform.OS === 'web';
const INPUT_PANE_SHARE = 0.4; // desktop: the message box grows to this share of the chat pane's height

type KeyEvent = { nativeEvent: { key: string; shiftKey?: boolean; isComposing?: boolean }; preventDefault?: () => void };

export interface ComposerProps {
  value: string;
  onChangeText: (t: string) => void;
  onSend: () => void;
  canSend: boolean;
  placeholder: string;
  label: string;
  /** Send circle color (the bot's color in a 1:1 chat, the accent in a room). */
  color: string;
  /** Stop circle: shown when there is nothing to send. Omit for no Stop. */
  stop?: { onPress: () => void; disabled?: boolean; label?: string };
  /** False while there's no connection: the field is dimmed and read-only, and Add a picture is off. */
  enabled?: boolean;
  dimmed?: boolean;
  /** Pictures. Leave `onImages` out and the plus button is not drawn. */
  images?: Attachment[];
  onImages?: (more: Attachment[]) => void;
  onRemoveImage?: (index: number) => void;
  attachError?: string | null;
  onAttachError?: (message: string) => void;
  /** Height of the chat pane, so the box can grow to 40% of it on the desktop. */
  paneHeight?: number;
  /** Chat column (maxWidth, centered). */
  column?: object | null;
  /** Screen-specific key handling (a room's @-mention picker). Return true to skip the shared Enter-to-send. */
  onKey?: (e: KeyEvent) => boolean | void;
  onSelectionChange?: (end: number) => void;
  /** Drawn above the field, inside the composer's frame (the @-mention popover). */
  above?: ReactNode;
}

/**
 * The message box shared by the bot chat and the group chat (card 28): the plus, the pill field that grows with
 * its text, the round Send/Stop inside the field, Enter/Shift+Enter on the desktop, the picture row.
 * Keyboard avoidance stays with the screen (KeyboardAvoidingView), since it depends on the header above.
 */
export function Composer(p: ComposerProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const desk = useDesk();
  const fieldMin = desk ? 44 : 36;
  const enabled = p.enabled ?? true;
  const images = p.images ?? [];
  const inputRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  const [focused, setFocused] = useState(false);
  const [inputHeight, setInputHeight] = useState<number | undefined>(undefined);
  const inputCap = p.paneHeight ? Math.round(p.paneHeight * INPUT_PANE_SHARE) : undefined;
  // Desktop (web): the box starts at one line and grows with its text up to 40% of the chat pane, then scrolls.
  // The field is 44 tall on the desktop, 36 on the phone (design fix 3); the textarea has no border or padding of its
  // own beyond the text's, so its height is the field's height.
  useLayoutEffect(() => {
    if (!WEB) return;
    const el = inputRef.current as unknown as HTMLTextAreaElement | null;
    if (!el || !el.style) return;
    const was = el.style.height; // React's own value; put it back so an unchanged height stays applied
    el.style.height = '0px'; // measure the content on its own, so the box can shrink too
    const border = el.offsetHeight - el.clientHeight; // scrollHeight leaves the border out
    const h = el.scrollHeight < fieldMin + 10 ? fieldMin : el.scrollHeight + border;
    el.style.height = was;
    const next = Math.max(fieldMin, inputCap ? Math.min(h, inputCap) : h);
    // No scrollbar until the text reaches the cap (a box under it never needs one).
    el.style.overflowY = inputCap && h >= inputCap ? 'auto' : 'hidden';
    setInputHeight(next);
  }, [p.value, inputCap, fieldMin]);

  const onImages = p.onImages;
  useImageDrop((more) => onImages?.(more), enabled && !!onImages);
  const attach = (source: PickSource) => void pickImages(source, images.length).then((m) => onImages?.(m)).catch((e: Error) => p.onAttachError?.(e.message));
  const openAttach = (anchor?: { x: number; y: number }) =>
    PICK_SOURCES.length === 1
      ? attach(PICK_SOURCES[0].source)
      : Menu.show('Add a picture', [...PICK_SOURCES.map((s) => ({ text: s.label, onPress: () => attach(s.source) })), { text: 'Cancel', style: 'cancel' as const }], anchor);

  // Send/Stop: a 30 circle 3 in from the field's corner (desktop 32, 6 in); the field's own line is a hairline.
  const roundSize = desk
    ? { width: 32, height: 32, borderRadius: 16, right: 6 - StyleSheet.hairlineWidth, bottom: 6 - StyleSheet.hairlineWidth }
    : { width: 30, height: 30, borderRadius: 15, right: 3 - StyleSheet.hairlineWidth, bottom: 3 - StyleSheet.hairlineWidth };

  const keyProps = WEB
    ? {
        // Desktop: Enter sends, Shift+Enter is a new line. The screen's own handler (a mention pick) goes first.
        onKeyPress: (e: KeyEvent) => {
          if (p.onKey?.(e)) return;
          if (isSendEnter(e)) {
            e.preventDefault?.();
            p.onSend();
          }
        },
        // The web build (layout tests, previews) draws a multiline box two rows tall; iOS starts at one.
        numberOfLines: 1,
      }
    : { onKeyPress: p.onKey ? (e: unknown) => void p.onKey?.(e as KeyEvent) : undefined };

  return (
    <>
      {images.length ? (
        <ScrollView horizontal style={[styles.attachRow, p.column]} contentContainerStyle={styles.attachRowBody} keyboardShouldPersistTaps="handled">
          {images.map((im, i) => (
            <View key={i} style={styles.thumbWrap}>
              <Image source={{ uri: im.dataUrl }} style={styles.thumb} accessibilityLabel={`Picture ${i + 1}`} />
              <Pressable style={styles.thumbRemove} onPress={() => p.onRemoveImage?.(i)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Remove picture ${i + 1}`}>
                <Text style={styles.thumbRemoveText}>✕</Text>
              </Pressable>
            </View>
          ))}
        </ScrollView>
      ) : null}
      {p.attachError ? <Text style={[styles.error, p.column]}>{p.attachError}</Text> : null}
      <View style={[{ paddingTop: 8, paddingHorizontal: 12, paddingBottom: Math.max(insets.bottom, 8) }, p.column]}>
        {p.above}
        <View style={styles.composer}>
          {onImages ? (
            <Pressable
              style={({ pressed }) => [styles.attach, { width: fieldMin, height: fieldMin, borderRadius: fieldMin / 2 }, pressed && { opacity: 0.6 }]}
              onPress={(e) => openAttach({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })}
              disabled={!enabled || images.length >= MAX_IMAGES}
              hitSlop={4}
              accessibilityRole="button"
              accessibilityLabel="Add a picture"
            >
              <PlusIcon size={18} color={colors.dim} />
            </Pressable>
          ) : null}
          <View testID="composer-field" style={[styles.field, { minHeight: fieldMin, borderRadius: fieldMin / 2 }, p.dimmed && { opacity: 0.5 }]}>
            <TextInput
              ref={inputRef}
              style={[
                styles.input,
                desk ? { fontSize: 16, lineHeight: 24, paddingVertical: 10, paddingRight: 44 } : { fontSize: 17, lineHeight: 22, paddingVertical: 7, paddingRight: 36, maxHeight: 6 * 22 + 14 },
                WEB && inputHeight !== undefined && { height: inputHeight, maxHeight: inputCap ?? 140 },
                WEB && ({ outlineStyle: 'none' } as object),
              ]}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              value={p.value}
              onChangeText={p.onChangeText}
              onSelectionChange={p.onSelectionChange ? (e) => p.onSelectionChange?.(e.nativeEvent.selection.end) : undefined}
              placeholder={p.placeholder}
              placeholderTextColor={colors.faint}
              accessibilityLabel={p.label}
              multiline
              editable={enabled}
              {...keyProps}
            />
            <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.fieldLine, { borderRadius: fieldMin / 2 }]} />
            {p.canSend ? (
              <Pressable testID="composer-send" style={[styles.roundButton, roundSize, { backgroundColor: p.color }]} onPress={p.onSend} accessibilityRole="button" accessibilityLabel="Send" hitSlop={6}>
                <ArrowUpIcon size={16} color={onColor(p.color)} />
              </Pressable>
            ) : p.stop ? (
              <Pressable testID="composer-stop" style={[styles.roundButton, roundSize, { backgroundColor: colors.text }]} onPress={p.stop.onPress} disabled={p.stop.disabled} accessibilityRole="button" accessibilityLabel={p.stop.label ?? 'Stop'} hitSlop={6}>
                <StopIcon color={colors.bg} />
              </Pressable>
            ) : null}
          </View>
        </View>
        {desk && focused ? (
          <Text style={styles.hintLine} accessibilityElementsHidden importantForAccessibility="no">
            Enter to send · Shift+Enter for a new line
          </Text>
        ) : null}
      </View>
    </>
  );
}


const useStyles = makeStyles(({ colors }) => StyleSheet.create({
  attachRow: { flexGrow: 0, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  attachRowBody: { gap: 8, paddingHorizontal: 12, paddingTop: 10 },
  thumbWrap: { width: 64, height: 64 },
  thumb: { width: 64, height: 64, borderRadius: 10, backgroundColor: colors.card },
  thumbRemove: { position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: 11, backgroundColor: '#000', borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  thumbRemoveText: { color: colors.text, fontSize: 11, fontWeight: '700' },
  attach: { backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  error: { color: colors.bad, fontSize: 14, paddingHorizontal: 16, paddingBottom: 6 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end', // the plus stays level with the bottom line as the field grows
    gap: 8,
  },
  // The field holds its Send/Stop circle (design fix 3), so they never change its width.
  field: { flex: 1, backgroundColor: colors.card, justifyContent: 'center' },
  fieldLine: { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  input: { color: colors.text, paddingLeft: 14 },
  roundButton: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  hintLine: { color: colors.faint, fontSize: 12, lineHeight: 16, marginTop: 6, marginLeft: 52 },
}));

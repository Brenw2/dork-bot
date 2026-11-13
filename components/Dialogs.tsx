// In-app menus and dialogs for the web build (the desktop app), in the app's own style instead
// of the system's. components/alert.web.ts and Menu.show put them up; <DialogHost/> (in
// app/_layout.tsx) draws them. The phone uses React Native's Alert instead (components/alert.ts).
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { Icon, type IconName } from '@/components/Icons';
import { colors } from '@/lib/theme';

export interface DialogButton {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: (value?: string) => void;
  /** Menus only: a 16 px icon, a right-aligned shortcut hint, and a separator above this item. */
  icon?: IconName;
  shortcut?: string;
  sepBefore?: boolean;
}

export type DialogSpec =
  | { kind: 'menu'; title?: string; anchor?: { x: number; y: number }; items: DialogButton[]; accent?: string }
  | { kind: 'alert'; title: string; message?: string; buttons: DialogButton[]; accent?: string }
  /** Typed confirm: the destructive button stays off until `expected` is typed. */
  | { kind: 'prompt'; title: string; message?: string; buttons: DialogButton[]; expected?: string; accent?: string };

let current: DialogSpec | null = null;
const listeners = new Set<(d: DialogSpec | null) => void>();
const set = (d: DialogSpec | null) => {
  current = d;
  listeners.forEach((fn) => fn(d));
};

export function showDialog(d: DialogSpec): void {
  set(d);
}

export function DialogHost() {
  const [d, setD] = useState<DialogSpec | null>(current);
  useEffect(() => {
    listeners.add(setD);
    return () => void listeners.delete(setD);
  }, []);
  if (!d) return null;
  const close = () => set(null);
  return d.kind === 'menu' ? <MenuView spec={d} close={close} /> : <DialogView spec={d} close={close} />;
}

function useEscape(close: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    // Capture, so Esc closes the dialog and not the panel under it.
    globalThis.addEventListener?.('keydown', onKey, true);
    return () => globalThis.removeEventListener?.('keydown', onKey, true);
  }, [close]);
}

const MENU_WIDTH = 248;
const ITEM_H = 32;

function MenuView({ spec, close }: { spec: Extract<DialogSpec, { kind: 'menu' }>; close: () => void }) {
  const { width, height } = useWindowDimensions();
  useEscape(close);
  const items = spec.items.filter((i) => i.style !== 'cancel');
  const [active, setActive] = useState(-1);
  // Arrow keys move through the items, Enter picks one (Esc closes, above).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((i) => (e.key === 'ArrowDown' ? (i + 1) % items.length : (i <= 0 ? items.length : i) - 1));
      } else if (e.key === 'Enter' && active >= 0) {
        e.preventDefault();
        close();
        items[active]?.onPress?.();
      }
    };
    globalThis.addEventListener?.('keydown', onKey, true);
    return () => globalThis.removeEventListener?.('keydown', onKey, true);
  }, [items, active, close]);
  const estHeight = items.length * ITEM_H + items.filter((i) => i.sepBefore).length * 13 + 12;
  const a = spec.anchor ?? { x: width / 2 - MENU_WIDTH / 2, y: height / 3 };
  // Open below and to the left of the ⋯, kept on screen.
  const left = Math.max(8, Math.min(a.x - MENU_WIDTH + 24, width - MENU_WIDTH - 8));
  const top = a.y + estHeight + 8 > height ? Math.max(8, a.y - estHeight - 8) : a.y + 8;
  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable style={StyleSheet.absoluteFill} onPress={close} accessible={false} />
      <View style={[styles.menu, { left, top, width: MENU_WIDTH }]} role="menu" aria-label={spec.title}>
        {items.map((it, i) => (
          <View key={i}>
            {it.sepBefore ? <View style={styles.menuSep} /> : null}
            <Pressable
              role="menuitem"
              onPress={() => {
                close();
                it.onPress?.();
              }}
              style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => [styles.menuItem, (hovered || pressed || i === active) && styles.menuItemHover]}
            >
              {it.icon ? <Icon name={it.icon} size={16} color={it.style === 'destructive' ? colors.bad : colors.dim} /> : null}
              <Text style={[styles.menuText, it.style === 'destructive' && { color: colors.bad }]} numberOfLines={1}>{it.text.replace(/…$/, '')}</Text>
              {it.shortcut ? <Text style={styles.menuShortcut}>{it.shortcut}</Text> : null}
            </Pressable>
          </View>
        ))}
      </View>
    </View>
  );
}

function DialogView({ spec, close }: { spec: Exclude<DialogSpec, { kind: 'menu' }>; close: () => void }) {
  const [typed, setTyped] = useState('');
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);
  useEscape(close);
  const expected = spec.kind === 'prompt' ? spec.expected : undefined;
  const matches = !expected || typed.trim().toLowerCase() === expected;
  useEffect(() => {
    if (spec.kind === 'prompt') setTimeout(() => input.current?.focus(), 50);
  }, [spec.kind]);
  const press = (b: DialogButton) => {
    if (b.style !== 'cancel' && !matches && spec.kind === 'prompt') return;
    close();
    b.onPress?.(spec.kind === 'prompt' ? typed : undefined);
  };
  const buttons = spec.buttons.length ? spec.buttons : [{ text: 'OK' }];
  const primary = [...buttons].reverse().find((b) => b.style !== 'cancel');
  return (
    <View style={[StyleSheet.absoluteFill, styles.backdrop]}>
      <Pressable style={StyleSheet.absoluteFill} onPress={close} accessible={false} />
      <View style={styles.dialog} role="alertdialog" aria-modal aria-label={spec.title}>
        <Text style={styles.title}>{spec.title}</Text>
        {spec.message ? <Text style={styles.message}>{spec.message}</Text> : null}
        {spec.kind === 'prompt' ? (
          <TextInput
            ref={input}
            style={styles.input}
            value={typed}
            onChangeText={setTyped}
            placeholder={expected ? `Type ${expected}` : ''}
            placeholderTextColor={colors.dim}
            autoCapitalize="none"
            autoCorrect={false}
            onSubmitEditing={() => primary && press(primary)}
            accessibilityLabel={expected ? `Type ${expected} to confirm` : 'Answer'}
          />
        ) : null}
        <View style={styles.buttons}>
          {buttons.map((b, i) => {
            const off = b.style !== 'cancel' && spec.kind === 'prompt' && !matches;
            const danger = b.style === 'destructive';
            const isPrimary = b === primary;
            return (
              <Pressable
                key={i}
                onPress={() => press(b)}
                disabled={off}
                accessibilityRole="button"
                accessibilityState={{ disabled: off }}
                style={[
                  styles.button,
                  b.style === 'cancel' && styles.cancel,
                  isPrimary && !off && { backgroundColor: danger ? colors.bad : (spec.accent ?? colors.accent), borderColor: 'transparent' },
                  off && styles.off,
                ]}
              >
                <Text style={[styles.buttonText, isPrimary && !off && { color: '#fff' }, off && { color: colors.dim }]}>{b.text}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  menu: {
    position: 'absolute',
    backgroundColor: colors.raised,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.menuBorder,
    padding: 6,
    boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
  },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, height: ITEM_H, borderRadius: 7 },
  menuItemHover: { backgroundColor: colors.menuHover },
  menuText: { flex: 1, color: colors.text, fontSize: 14 },
  menuShortcut: { color: colors.faint, fontSize: 12 },
  menuSep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.menuBorder, marginVertical: 6, marginHorizontal: -0 },
  backdrop: { backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  dialog: {
    width: 420,
    maxWidth: '92%',
    backgroundColor: '#1A1C21',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 22,
    gap: 12,
    boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
  },
  title: { color: colors.text, fontSize: 18, fontWeight: '700' },
  message: { color: colors.dim, fontSize: 15, lineHeight: 22 },
  input: {
    color: colors.text,
    fontSize: 15,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 6 },
  button: { height: 38, paddingHorizontal: 18, borderRadius: 19, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  cancel: { backgroundColor: 'transparent' },
  off: { backgroundColor: colors.card },
  buttonText: { color: colors.text, fontSize: 15, fontWeight: '600' },
});

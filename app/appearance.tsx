import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useColumnStyle } from '@/components/Column';
import { Icon } from '@/components/AppIcons';
import { onColor } from '@/lib/color';
import { Group, GroupFootnote, GroupHeader } from '@/components/Grouped';
import { Sheet } from '@/components/Sheet';
import { makeStyles, useTheme } from '@/components/theme';
import { loadThemeFonts } from '@/components/themeFonts';
import { PICKER_THEMES, THEMES, type ThemeId } from '@/lib/themes';
import { skinStyle, PROMPT } from '@/lib/themeSkin';

// Appearance (design-comps/dork-bot-redesign-2026-11-19, appearance-*.png): one row per theme with a small live
// preview drawn from that theme's own colors, its name and one line, and a radio. It applies right away and is kept
// on this device. The menu entry only shows once there is more than one theme in the picker (lib/themes.ts PICKER_THEMES).
const DESCRIPTION: Record<ThemeId, string> = {
  classic: 'Today’s look. Dark, purple accent, Messages-style.',
  terminal: 'Near-black console. Mint highlights, one mono font, square corners.',
};

// The preview is drawn in its own theme, so it is made with that theme's skin (its font, its corners). Until the
// theme's font file is loaded it keeps the system font, so there is no flash of an unstyled font.
function Preview({ id, fontsReady }: { id: ThemeId; fontsReady: boolean }) {
  const t = THEMES[id];
  const c = t.colors;
  const look = fontsReady ? t : { ...t, fonts: null };
  const s = <T,>(style: T): T => skinStyle(style, look);
  const rule = t.shape.userRule;
  return (
    <View style={s({ width: 104, height: 80, borderRadius: 12, backgroundColor: c.bg, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, padding: 8 })} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
        <View style={s({ width: 16, height: 16, borderRadius: 8, backgroundColor: c.card, borderWidth: 1, borderColor: c.accent })} />
        <Text style={s({ color: c.text, fontSize: 8, fontWeight: '700' })}>chief</Text>
      </View>
      <View
        style={
          rule
            ? { marginTop: 8, backgroundColor: c.card, borderLeftWidth: 2, borderLeftColor: c.accent, paddingHorizontal: 6, paddingVertical: 3 }
            : s({ alignSelf: 'flex-end', marginTop: 8, backgroundColor: c.user, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 3 })
        }
      >
        <Text style={s({ color: c.userText, fontSize: 8 })}>{rule ? `${PROMPT} ship it?` : 'Ship it?'}</Text>
      </View>
      <View style={s({ alignSelf: 'flex-start', marginTop: 6, backgroundColor: c.accent, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 })}>
        <Text style={s({ color: onColor(c.accent), fontSize: 8, fontWeight: '700' })}>{t.shape.brackets ? '[send]' : 'Send'}</Text>
      </View>
    </View>
  );
}

export default function AppearanceScreen() {
  const styles = useStyles();
  const column = useColumnStyle();
  const { theme, colors, setTheme, label } = useTheme();
  // Load every offered theme's fonts, so each preview is drawn in its own font.
  const [loaded, setLoaded] = useState<Record<string, boolean>>({});
  useEffect(() => {
    let live = true;
    for (const id of PICKER_THEMES) void loadThemeFonts(THEMES[id]).then((ok) => live && ok && setLoaded((r) => ({ ...r, [id]: true })));
    return () => {
      live = false;
    };
  }, []);
  return (
    <>
      <Sheet title="Appearance" />
      <ScrollView contentContainerStyle={[styles.body, column]}>
        <GroupHeader>Theme</GroupHeader>
        <Group inset={0}>
          {PICKER_THEMES.map((id) => {
            const selected = id === theme.id;
            return (
              <Pressable
                key={id}
                onPress={() => setTheme(id)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={`${THEMES[id].name}, theme, ${selected ? 'selected' : 'not selected'}`}
                accessibilityHint={DESCRIPTION[id]}
                style={({ pressed }) => [styles.row, selected && { backgroundColor: colors.raised }, pressed && { opacity: 0.6 }]}
              >
                <Preview id={id} fontsReady={!!loaded[id]} />
                <View style={styles.texts}>
                  <Text style={styles.name}>{label(THEMES[id].name)}</Text>
                  <Text style={styles.desc}>{DESCRIPTION[id]}</Text>
                </View>
                <View style={[styles.radio, selected && { backgroundColor: colors.accent, borderColor: colors.accent }]}>
                  {selected ? <Icon name="check" size={14} color={onColor(colors.accent)} stroke={3} /> : null}
                </View>
              </Pressable>
            );
          })}
        </Group>
        <GroupFootnote>Changes right away on this device. Your bots look the same in every theme.</GroupFootnote>
      </ScrollView>
    </>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    body: { paddingVertical: 8 },
    row: { flexDirection: 'row', alignItems: 'center', minHeight: 104, padding: 12, gap: 14 },
    texts: { flex: 1 },
    name: { color: colors.text, fontSize: 17, fontWeight: '700', lineHeight: 22 },
    desc: { color: colors.dim, fontSize: 15, lineHeight: 20, marginTop: 2 },
    radio: { width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, borderColor: colors.chevron, alignItems: 'center', justifyContent: 'center' },
  }),
);

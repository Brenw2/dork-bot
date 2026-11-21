import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useColumnStyle } from '@/components/Column';
import { Icon } from '@/components/AppIcons';
import { onColor } from '@/lib/color';
import { Group, GroupFootnote, GroupHeader } from '@/components/Grouped';
import { Sheet } from '@/components/Sheet';
import { makeStyles, useTheme } from '@/components/theme';
import { THEME_IDS, THEMES, type ThemeId } from '@/lib/themes';

// Appearance (design-comps/dork-bot-redesign-2026-11-19, appearance-*.png): one row per theme with a small live
// preview drawn from that theme's own colors, its name and one line, and a radio. It applies right away and is kept
// on this device. The menu entry only shows once there is more than one theme (lib/themes.ts THEME_IDS).
const DESCRIPTION: Record<ThemeId, string> = {
  classic: 'Today’s look. Dark, purple accent, Messages-style.',
};

function Preview({ id }: { id: ThemeId }) {
  const c = THEMES[id].colors;
  return (
    <View style={{ width: 104, height: 80, borderRadius: 12, backgroundColor: c.bg, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, padding: 8 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
        <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: c.card, borderWidth: 1, borderColor: c.accent }} />
        <Text style={{ color: c.text, fontSize: 8, fontWeight: '700' }}>chief</Text>
      </View>
      <View style={{ alignSelf: 'flex-end', marginTop: 8, backgroundColor: c.user, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 3 }}>
        <Text style={{ color: c.text, fontSize: 8 }}>Ship it?</Text>
      </View>
      <View style={{ alignSelf: 'flex-start', marginTop: 6, backgroundColor: c.accent, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 }}>
        <Text style={{ color: onColor(c.accent), fontSize: 8, fontWeight: '700' }}>Send</Text>
      </View>
    </View>
  );
}

export default function AppearanceScreen() {
  const styles = useStyles();
  const column = useColumnStyle();
  const { theme, colors, setTheme } = useTheme();
  return (
    <>
      <Sheet title="Appearance" />
      <ScrollView contentContainerStyle={[styles.body, column]}>
        <GroupHeader>Theme</GroupHeader>
        <Group inset={0}>
          {THEME_IDS.map((id) => {
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
                <Preview id={id} />
                <View style={styles.texts}>
                  <Text style={styles.name}>{THEMES[id].name}</Text>
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

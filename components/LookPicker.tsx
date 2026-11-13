import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Sprite } from '@/components/BotSprite';
import { Group, GroupHeader, GroupRow, LEADING_INSET } from '@/components/Grouped';
import { BOT_COLORS, CHARACTER_IDS, CHARACTERS, lookName, looksOf, type Look } from '@/lib/sprites';
import { colors } from '@/lib/theme';

/**
 * Pick a bot's look: color, character, and which version of that character
 * (e.g. a square, round or tall robot). The picked one plays its happy animation.
 */
export function LookPicker({ value, onChange }: { value: Look; onChange: (look: Look) => void }) {
  const looks = looksOf(value.character);
  return (
    <View style={{ gap: 14 }}>
      <View style={styles.colors} accessibilityRole="radiogroup" accessibilityLabel="Color">
        {BOT_COLORS.map((c) => {
          const on = c.toLowerCase() === value.color.toLowerCase();
          return (
            <Pressable
              key={c}
              onPress={() => onChange({ ...value, color: c })}
              style={[styles.swatchRing, on && { borderColor: colors.text }]}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`Color ${c}`}
              hitSlop={4}
            >
              <View style={[styles.swatch, { backgroundColor: c }]} />
            </Pressable>
          );
        })}
      </View>

      <View style={styles.grid} accessibilityRole="radiogroup" accessibilityLabel="Character">
        {CHARACTER_IDS.map((id) => {
          const on = id === value.character;
          return (
            <Pressable
              key={id}
              onPress={() => onChange({ ...value, character: id, variant: on ? value.variant : 0 })}
              style={[styles.cell, on && { borderColor: value.color, backgroundColor: colors.card }]}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={CHARACTERS[id].name}
            >
              <Sprite character={id} variant={on ? value.variant : 0} color={value.color} mood={on ? 'done' : 'idle'} size={52} seed={id.length} />
              <Text style={[styles.label, on && { color: colors.text }]}>{CHARACTERS[id].name}</Text>
            </Pressable>
          );
        })}
      </View>

      {looks.length > 1 ? (
        <View>
          <GroupHeader>Style</GroupHeader>
          <Group inset={LEADING_INSET}>
            {looks.map((_, v) => {
              const on = v === value.variant;
              const name = lookName(value.character, v);
              return (
                <GroupRow
                  key={v}
                  label={name}
                  leading={<Sprite character={value.character} variant={v} color={value.color} mood="idle" size={32} seed={v} />}
                  right={on ? <Text style={[styles.check, { color: value.color }]}>✓</Text> : undefined}
                  onPress={() => onChange({ ...value, variant: v })}
                  accessibilityLabel={name}
                />
              );
            })}
          </Group>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  colors: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  swatchRing: { padding: 3, borderRadius: 18, borderWidth: 2, borderColor: 'transparent' },
  swatch: { width: 26, height: 26, borderRadius: 13 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  looks: { gap: 8 },
  cell: {
    width: 76,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: 'transparent',
    gap: 2,
  },
  heading: { color: colors.dim, fontSize: 13 },
  label: { color: colors.dim, fontSize: 12 },
  check: { fontSize: 22, fontWeight: '700' },
});

import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Sprite } from '@/components/BotSprite';
import { CHARACTER_IDS, CHARACTERS, type CharacterId } from '@/lib/sprites';
import { colors } from '@/lib/theme';

/** A grid of the pixel characters; the picked one waves (plays its 'done' animation). */
export function CharacterPicker({ value, onChange, color }: { value: CharacterId; onChange: (id: CharacterId) => void; color: string }) {
  return (
    <View style={styles.grid} accessibilityRole="radiogroup">
      {CHARACTER_IDS.map((id) => {
        const on = id === value;
        return (
          <Pressable
            key={id}
            onPress={() => onChange(id)}
            style={[styles.cell, on && { borderColor: color, backgroundColor: colors.card }]}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={CHARACTERS[id].name}
          >
            <Sprite character={id} color={color} mood={on ? 'done' : 'idle'} size={52} seed={id.length} />
            <Text style={[styles.label, on && { color: colors.text }]}>{CHARACTERS[id].name}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cell: {
    width: 76,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: 'transparent',
    gap: 2,
  },
  label: { color: colors.dim, fontSize: 12 },
});

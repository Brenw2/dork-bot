// The approval card's answer buttons, one component for the 1:1 chat and the group chat (UI-KIT K3).
// Phone: a 2 x 2 grid, 44 tall. Desktop: one row, 36 tall. Radius 12, 15/600. Allow once = tint fill, Deny = `bad`
// outline (1 wide, as in the locked comp 05-approval), the other choices = mix(tint, 0.2).
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { onColor } from '@/lib/theme';
import { makeStyles, useTheme } from '@/components/theme';

export function ApprovalButtons({
  choices,
  labels,
  color,
  desk,
  disabled,
  dim,
  onAnswer,
}: {
  /** In display order (the 1:1 chat and the room both order them with approvalOrder). */
  choices: string[];
  labels: Record<string, string>;
  color: string;
  desk: boolean;
  /** Stops taps. */
  disabled?: boolean;
  /** Fades the buttons (an answer is in flight, or was given). */
  dim?: boolean;
  onAnswer: (choice: string) => void;
}) {
  const { colors, mix, label, theme } = useTheme();
  const styles = useStyles();
  const rows: string[][] = [];
  if (desk) rows.push(choices);
  else for (let i = 0; i < choices.length; i += 2) rows.push(choices.slice(i, i + 2));
  const height = desk ? 36 : 44;
  const fill = (c: string) => (c === 'once' ? { backgroundColor: color } : c === 'deny' ? { borderColor: colors.bad } : { backgroundColor: mix(color, 0.2) });
  const text = (c: string) => (c === 'once' ? onColor(color) : c === 'deny' ? colors.bad : colors.text);
  // Terminal: the choices that do something read [ label ]; Deny stays a plain word in its red outline.
  const shown = (c: string) => (theme.shape.brackets && c !== 'deny' ? `[${label(labels[c] ?? c)}]` : label(labels[c] ?? c));
  return (
    <View style={styles.buttons}>
      {rows.map((row, r) => (
        <View key={r} style={styles.row}>
          {row.map((c) => (
            <Pressable
              key={c}
              disabled={disabled}
              onPress={() => onAnswer(c)}
              accessibilityRole="button"
              accessibilityLabel={labels[c] ?? c}
              testID={`approval-${c}`}
              style={({ pressed }) => [styles.button, { height }, fill(c), (pressed || dim) && { opacity: 0.6 }]}
            >
              <Text style={[styles.text, { color: text(c) }]} numberOfLines={1} maxFontSizeMultiplier={1.4}>
                {shown(c)}
              </Text>
            </Pressable>
          ))}
          {!desk && row.length === 1 ? <View style={{ flex: 1 }} /> : null}
        </View>
      ))}
    </View>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  buttons: { gap: 8 },
  row: { flexDirection: 'row', gap: 8 },
  button: { flex: 1, borderRadius: 12, borderWidth: 1, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  text: { fontSize: 15, fontWeight: '600' },
}));

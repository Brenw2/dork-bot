// The app's one button set (docs/design/REVIEW.md, fix 9), and the accent rule: inside a bot's context the
// interactive color is that bot's color; everywhere else (no `bot`) it is the theme's accent (Classic #8B7CF6).
import { ActivityIndicator, Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { useDesk } from '@/components/ChatStatus';
import { useBotLook } from '@/components/useBotLook';
import { onColor } from '@/lib/theme';
import { makeStyles, useTheme } from '@/components/theme';
import { maxScale } from '@/lib/type';

/** The tint for a screen: the bot's color inside its context, the accent outside it. */
export function useTint(bot?: string): string {
  const { colors } = useTheme();
  const { color } = useBotLook(bot ?? '');
  return bot ? color : colors.accent;
}

/**
 * Primary: 50 tall pill (desktop 40), 17 semibold, tint fill, `onColor` text; one per screen (in sheets the action lives
 * in the header instead). Secondary: the same with a `mix(tint, 0.2)` fill and #ECEDEF text.
 */
export function Button({
  label,
  onPress,
  bot,
  color,
  kind = 'primary',
  disabled,
  busy,
  style,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  bot?: string;
  /** Overrides the tint: `colors.bad` for a destructive primary, a dialog's accent. */
  color?: string;
  kind?: 'primary' | 'secondary';
  disabled?: boolean;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const { colors, mix, label: say, skin, theme } = useTheme();
  const styles = useStyles();
  const botTint = useTint(bot);
  const tint = color ?? botTint;
  const desk = useDesk();
  const off = disabled || busy;
  const fill = off ? colors.card : kind === 'primary' ? tint : mix(tint, 0.2);
  const text = off && !busy ? colors.faint : kind === 'primary' ? onColor(tint) : colors.text;
  // Terminal writes an enabled button as [ label ] (lowercase); a disabled one is just its label.
  const shown = theme.shape.brackets && !off ? `[${say(label)}]` : say(label);
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!disabled, busy: !!busy }}
      style={({ pressed }) => [styles.big, skin({ minHeight: desk ? 40 : 50, borderRadius: desk ? 20 : 25, backgroundColor: fill }), pressed && { opacity: 0.7 }, style]}
    >
      {busy ? <ActivityIndicator color={text} /> : null}
      <Text style={[styles.bigText, { color: text }]} numberOfLines={2} maxFontSizeMultiplier={theme.shape.brackets ? maxScale.mono : maxScale.chrome}>
        {shown}
      </Text>
    </Pressable>
  );
}

export type SmallTone = 'filled' | 'tint' | 'neutral' | 'danger';

/**
 * A row action: 30 tall (desktop 28), radius 15, padding 0 12, 13 semibold, with a 44 pt hit area.
 * filled: the one action the row needs now ("Sign in"). tint: Connect, Add, Run now. neutral: Details.
 * danger: Remove. Prefer swipe or ⋯ for destructive row actions.
 */
export function SmallButton({ label, onPress, bot, tone = 'tint', disabled, busy, accessibilityLabel }: { label: string; onPress: () => void; bot?: string; tone?: SmallTone; disabled?: boolean; busy?: boolean; accessibilityLabel?: string }) {
  const { colors, mix, label: say, theme } = useTheme();
  const styles = useStyles();
  const tint = useTint(bot);
  const desk = useDesk();
  const bg = tone === 'filled' ? tint : tone === 'tint' ? mix(tint, 0.2) : tone === 'neutral' ? colors.raised : mix(colors.bad, 0.2);
  const fg = tone === 'filled' ? onColor(tint) : tone === 'danger' ? colors.bad : colors.text;
  // Terminal: filled and tint read [ label ]; neutral is an outlined box and danger a red outline, both plain words.
  const term = theme.shape.brackets;
  const outline = term && (tone === 'neutral' || tone === 'danger') ? { backgroundColor: disabled ? colors.card : colors.bg, borderWidth: 1, borderColor: tone === 'danger' ? colors.bad : colors.border } : null;
  const shown = term && (tone === 'filled' || tone === 'tint') && !disabled ? `[${say(label)}]` : say(label);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      hitSlop={desk ? 2 : { top: 7, bottom: 7, left: 4, right: 4 }}
      style={({ pressed }) => [styles.small, { minHeight: desk ? 28 : 30, backgroundColor: disabled ? colors.card : bg }, outline, (pressed || busy) && { opacity: 0.6 }]}
    >
      <Text style={[styles.smallText, { color: disabled ? colors.faint : fg }]} maxFontSizeMultiplier={term ? maxScale.mono : maxScale.chrome}>
        {shown}
      </Text>
    </Pressable>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  big: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  bigText: { fontSize: 17, fontWeight: '600' },
  small: { borderRadius: 15, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  smallText: { fontSize: 13, fontWeight: '600' },
}));

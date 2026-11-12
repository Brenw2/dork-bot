import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBotLook } from '@/components/useBotLook';
import { useWorkingOn } from '@/components/workWatch';
import { workingOnLine } from '@/lib/work';

/**
 * "Working on: <title>" under the bot's name while it is busy with work the app didn't start (a
 * terminal run, another bot…). Tap to read that work as it happens. Nothing when the bot is idle.
 */
export function WorkingOn({ bot }: { bot: string }) {
  const { color } = useBotLook(bot);
  const work = useWorkingOn(bot);
  const { width } = useWindowDimensions();
  const { left, right } = useSafeAreaInsets();
  if (!work) return null;
  // The header's other items (back, avatar, Chats, ⋯) take about 220 pt; the line gets the rest, up to 240.
  const maxWidth = Math.max(96, Math.min(240, width - left - right - 220));
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/work-session/[bot]', params: { bot, id: work.id } })}
      accessibilityRole="button"
      accessibilityLabel={workingOnLine(work.title)}
      accessibilityHint="Opens this work to read"
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      style={({ pressed }) => [{ maxWidth, overflow: 'hidden' }, pressed && { opacity: 0.6 }]}
    >
      <Text style={[styles.line, { color }]} numberOfLines={1}>
        {workingOnLine(work.title)} ›
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  line: { fontSize: 12, lineHeight: 16 },
});

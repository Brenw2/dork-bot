import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { isDesktop } from '@/components/desktop';
import { MemberStack } from '@/components/RoomAvatar';
import { timeLabel, type RoomRow as Row } from '@/lib/rooms';
import { colors } from '@/lib/theme';

/**
 * A room in the bot list (comp g1). Same geometry as the bot rows beside it (components/BotList.tsx BotRow):
 * phone = full-bleed, 80 wide avatar column, inset hairline from x80; sidebar = 64 tall, inset 12, radius 10, 40 stack.
 */
export function RoomListRow({
  row,
  label,
  onPress,
  selected = false,
  compact = false,
}: {
  row: Row;
  /** member id -> shown name */
  label: (id: string) => string;
  onPress: () => void;
  selected?: boolean;
  compact?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const big = !isDesktop;
  const working = row.status === 'working' && row.workingId ? `${label(row.workingId)} is working…` : null;
  const held = row.status === 'held' ? 'You stopped the room.' : null;
  const preview = row.preview;
  const time = timeLabel(row.at);
  const a11y = `${row.name}, group of ${row.count}${row.needsYou ? ', needs you' : ''}${time ? `, ${time}` : ''}`;

  const line = working ? (
    <Text style={{ color: colors.text }}>{working}</Text>
  ) : held ? (
    held
  ) : preview ? (
    <>
      <Text style={{ color: colors.text }}>{preview.speaker}: </Text>
      {preview.text}
    </>
  ) : (
    'No messages yet'
  );
  const badge = row.needsYou ? (
    <View style={styles.badge}>
      <Text style={styles.badgeText} maxFontSizeMultiplier={1.4}>
        Needs you
      </Text>
    </View>
  ) : null;

  if (compact) {
    return (
      <Pressable
        onPress={onPress}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        accessibilityRole="button"
        accessibilityLabel={a11y}
        accessibilityHint="Opens the group chat."
        style={({ pressed }) => [styles.sideRow, hovered && !selected && { backgroundColor: colors.hover }, (selected || pressed) && { backgroundColor: colors.raised }]}
      >
        <MemberStack profiles={row.members.map((m) => m.profile)} size={40} />
        <View style={styles.sideText}>
          <View style={styles.line1}>
            <Text style={[styles.sideName, { fontSize: big ? 16 : 15, lineHeight: 20 }]} numberOfLines={1} maxFontSizeMultiplier={1.4}>
              {row.name}
              <Text style={styles.count}> · {row.count}</Text>
            </Text>
            <Text style={styles.sideTime} maxFontSizeMultiplier={1.4}>
              {time}
            </Text>
          </View>
          <View style={styles.line2}>
            <Text style={[styles.sidePreview, { fontSize: big ? 14 : 13, lineHeight: 18 }]} numberOfLines={1} maxFontSizeMultiplier={1.4}>
              {line}
            </Text>
            {badge}
          </View>
        </View>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityHint="Opens the group chat."
      style={({ pressed }) => [styles.row, (pressed || selected) && { backgroundColor: colors.raised }]}
    >
      <View style={styles.rowAvatar}>
        <MemberStack profiles={row.members.map((m) => m.profile)} size={52} />
      </View>
      <View style={styles.rowBody}>
        <View style={styles.rowInner}>
          <View style={styles.line1}>
            <Text style={styles.name} numberOfLines={1} maxFontSizeMultiplier={1.4}>
              {row.name}
              <Text style={styles.count}> · {row.count}</Text>
            </Text>
            <Text style={styles.time} maxFontSizeMultiplier={1.4}>
              {time}
            </Text>
            <Text style={styles.chevron}>›</Text>
          </View>
          <View style={styles.line2}>
            <Text style={styles.preview} numberOfLines={2} maxFontSizeMultiplier={1.4}>
              {line}
            </Text>
            {badge}
          </View>
        </View>
      </View>
    </Pressable>
  );
}

// Numbers copied from BotList.tsx so room rows and bot rows line up.
const styles = StyleSheet.create({
  row: { flexDirection: 'row', minHeight: 76 },
  rowAvatar: { width: 80, paddingLeft: 16, paddingTop: 12 },
  rowBody: { flex: 1, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowInner: { paddingTop: 10, paddingBottom: 10, paddingRight: 16, gap: 1 },
  line1: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  line2: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flex: 1, color: colors.text, fontSize: 17, lineHeight: 22, fontWeight: '600' },
  count: { color: colors.dim, fontWeight: '400' },
  time: { color: colors.dim, fontSize: 15, lineHeight: 20 },
  chevron: { color: colors.chevron, fontSize: 15, lineHeight: 20 },
  preview: { flex: 1, color: colors.dim, fontSize: 15, lineHeight: 20 },
  badge: { height: 20, borderRadius: 10, paddingHorizontal: 8, backgroundColor: colors.bad, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#1A0B0B', fontSize: 12, fontWeight: '700' },
  sideRow: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 64, paddingHorizontal: 12, borderRadius: 10 },
  sideText: { flex: 1, gap: 1 },
  sideName: { flex: 1, color: colors.text, fontWeight: '600' },
  sideTime: { color: colors.dim, fontSize: 12, lineHeight: 16 },
  sidePreview: { flex: 1, color: colors.dim },
});

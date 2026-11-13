import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MemberStack } from '@/components/RoomAvatar';
import { timeLabel, type RoomRow as Row } from '@/lib/rooms';
import { colors } from '@/lib/theme';

/**
 * A room in the bot list (comp g1): the member stack, "name · count", time, ›, and line 2 = "speaker: text",
 * "<bot> is working…", "You stopped the room." or the Needs you badge beside the preview.
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
  const working = row.status === 'working' && row.workingId ? `${label(row.workingId)} is working…` : null;
  const held = row.status === 'held' ? 'You stopped the room.' : null;
  const preview = row.preview;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${row.name}, group of ${row.count}${row.needsYou ? ', needs you' : ''}`}
      accessibilityHint="Opens the group chat."
      style={({ pressed }) => [styles.row, compact && styles.rowCompact, (pressed || selected) && { backgroundColor: colors.raised }]}
    >
      <MemberStack profiles={row.members.map((m) => m.profile)} size={compact ? 40 : 52} />
      <View style={[styles.body, compact && { gap: 1 }]}>
        <View style={styles.line1}>
          <Text style={[styles.name, compact && styles.nameCompact]} numberOfLines={1}>
            {row.name}
            <Text style={styles.count}> · {row.count}</Text>
          </Text>
          <Text style={styles.time}>{timeLabel(row.at)}</Text>
          <Text style={styles.chev}>›</Text>
        </View>
        <View style={styles.line2}>
          <Text style={[styles.preview, { flex: 1 }]} numberOfLines={2}>
            {working ? (
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
            )}
          </Text>
          {row.needsYou ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>Needs you</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, minHeight: 76, paddingLeft: 16, paddingRight: 12, paddingVertical: 12 },
  rowCompact: { minHeight: 60, paddingLeft: 10, paddingRight: 8, paddingVertical: 8, gap: 10 },
  body: { flex: 1, gap: 2 },
  line1: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flex: 1, color: colors.text, fontSize: 17, lineHeight: 22, fontWeight: '600' },
  nameCompact: { fontSize: 15, lineHeight: 20 },
  count: { color: colors.dim, fontWeight: '400' },
  time: { color: colors.dim, fontSize: 15, lineHeight: 20 },
  chev: { color: '#4B4F56', fontSize: 15 },
  line2: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  preview: { color: colors.dim, fontSize: 15, lineHeight: 20 },
  badge: { height: 20, borderRadius: 10, paddingHorizontal: 8, backgroundColor: colors.bad, justifyContent: 'center' },
  badgeText: { color: '#1A0B0B', fontSize: 12, fontWeight: '700' },
});

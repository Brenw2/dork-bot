import { StyleSheet, View } from 'react-native';
import { Sprite } from '@/components/BotSprite';
import { useBotLook } from '@/components/useBotLook';
import type { Mood } from '@/lib/sprites';
import { colors, mix } from '@/lib/theme';

/** One bot as a disc: its sprite at 76% on mix(color, tint). The room's own animation state, not the 1:1 chat's. */
export function MemberDisc({ bot, size, tint = 0.18, mood = 'idle', ring = false }: { bot: string; size: number; tint?: number; mood?: Mood; ring?: boolean }) {
  const look = useBotLook(bot);
  const seed = [...bot].reduce((a, c) => a + c.charCodeAt(0), 0) % 11;
  return (
    <View
      style={[
        { width: size, height: size, borderRadius: size / 2, backgroundColor: mix(look.color, tint), alignItems: 'center', justifyContent: 'center' },
        ring && { borderWidth: 2, borderColor: colors.bg },
      ]}
    >
      <Sprite character={look.character} variant={look.variant} color={look.color} mood={mood} size={Math.round(size * 0.76)} seed={seed} />
    </View>
  );
}

/**
 * The room's picture: a stack of its members (G1). 3+ members: three discs of 0.56x at (11,0), (0,23), (23,23) in a
 * 52 box. 2 members: two discs of 0.64x at (0,0) and (19,19). Each disc is mix(color, 0.22) with a 2 px bg ring.
 * Other sizes scale from the 52 box (desktop uses 40).
 */
export function MemberStack({ profiles, size = 52 }: { profiles: string[]; size?: number }) {
  const k = size / 52;
  const two = profiles.length === 2;
  const d = Math.round((two ? 33 : 29) * k);
  const spots = two ? [[0, 0], [19, 19]] : [[11, 0], [0, 23], [23, 23]];
  return (
    <View style={{ width: size, height: size }} accessible={false} importantForAccessibility="no-hide-descendants">
      {profiles.slice(0, spots.length).map((p, i) => (
        <View key={p} style={[styles.abs, { left: spots[i][0] * k, top: spots[i][1] * k }]}>
          <MemberDisc bot={p} size={d} tint={0.22} ring />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({ abs: { position: 'absolute' } });

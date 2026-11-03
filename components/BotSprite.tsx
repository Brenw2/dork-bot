import { useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useBotLook } from '@/components/useBotLook';
import { useBotMood } from '@/components/useBotMood';
import { CANVAS, FRAME_MS, framePaths, frameSpec, renderFrame, type CharacterId, type Mood } from '@/lib/sprites';

/**
 * A pixel character, animated for its mood at a retro frame rate (FRAME_MS per frame).
 * With Reduce Motion on it holds one still frame.
 */
export function Sprite({
  character,
  variant = 0,
  color,
  mood = 'idle',
  size = 42,
  seed = 0,
}: {
  character: CharacterId;
  variant?: number;
  color: string;
  mood?: Mood;
  size?: number;
  seed?: number;
}) {
  const [t, setT] = useState(0);
  const still = useReduceMotion();

  useEffect(() => {
    if (still) return;
    const id = setInterval(() => setT((n) => n + 1), FRAME_MS);
    return () => clearInterval(id);
  }, [still]);

  const paths = useMemo(
    () => framePaths(renderFrame(character, color, frameSpec(mood, still ? 1 : t, seed), variant)),
    [character, variant, color, mood, t, seed, still],
  );

  return (
    <View style={{ width: size, height: size }} accessible={false} importantForAccessibility="no-hide-descendants">
      <Svg width={size} height={size} viewBox={`0 0 ${CANVAS} ${CANVAS}`}>
        {paths.map((p) => (
          <Path key={p.color} d={p.d} fill={p.color} />
        ))}
      </Svg>
    </View>
  );
}

/** A saved bot's character in its color, showing what the bot is doing right now. */
export function BotSprite({ bot, size = 42, mood }: { bot: string; size?: number; mood?: Mood }) {
  const look = useBotLook(bot);
  const live = useBotMood(bot);
  const seed = useMemo(() => [...bot].reduce((a, c) => a + c.charCodeAt(0), 0) % 11, [bot]);
  return <Sprite character={look.character} variant={look.variant} color={look.color} mood={mood ?? live} size={size} seed={seed} />;
}

function useReduceMotion(): boolean {
  const [still, setStill] = useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((v) => live && setStill(!!v))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v) => setStill(!!v));
    return () => {
      live = false;
      sub?.remove?.();
    };
  }, []);
  return still;
}

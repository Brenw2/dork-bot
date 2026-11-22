import { useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useBotLook } from '@/components/useBotLook';
import { useBotMood } from '@/components/useBotMood';
import { useTheme } from '@/components/theme';
import { mix } from '@/lib/color';
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

/** The bot's avatar: its pixel character at 76% inside a disc of its color at 18% (docs/design/REVIEW.md). Terminal: a square tile with a 1 pt line in the bot's color. */
export function BotAvatar({ bot, size = 52, mood }: { bot: string; size?: number; mood?: Mood }) {
  const { color } = useBotLook(bot);
  const { theme, colors } = useTheme();
  const tile = theme.shape.square;
  // Arcade: a solid tile of the bot's color with a 3 pt edge a shade darker (the sprite itself is the same).
  if (theme.pixel?.tile) {
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: Math.round(size * 0.29),
          backgroundColor: color,
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: mix(color, 0.55, '#000000'),
          shadowOffset: { width: 0, height: theme.pixel.depth },
          shadowOpacity: 1,
          shadowRadius: 0,
        }}
      >
        <BotSprite bot={bot} size={Math.round(size * 0.74)} mood={mood} />
      </View>
    );
  }
  const ring = theme.shape.ring;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: tile ? 0 : size / 2,
        backgroundColor: mix(color, 0.18, theme.mixBase),
        alignItems: 'center',
        justifyContent: 'center',
        ...(tile ? { borderWidth: 1, borderColor: mix(color, 0.5, theme.mixBase) } : null),
        // Paper: the disc keeps its tint and gets a ring in the ink color.
        ...(ring ? { borderWidth: ring, borderColor: colors.text } : null),
      }}
    >
      <BotSprite bot={bot} size={Math.round(size * 0.76)} mood={mood} />
    </View>
  );
}

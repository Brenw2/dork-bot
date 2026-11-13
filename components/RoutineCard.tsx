// A routine's result in the chat (card 24, docs/design/REVIEW.md "Fix 11"): a full-width, bot-tinted card,
// collapsed by default to one row (clock disc, name, time, one-line preview, ›), tap to open the output.
// Opened from a notification, it expands and flashes once. Same on the phone and the desktop.
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Icon } from '@/components/AppIcons';
import { Markdown } from '@/components/Markdown';
import { colors } from '@/lib/theme';
import { ROUTINE_MOTION, routineHasBody, routineHint, routineLabel, routinePreview, routineTints } from '@/lib/routineCard';

interface Props {
  name: string;
  when: string;
  text: string;
  /** The bot's colour. */
  color: string;
  expanded: boolean;
  onToggle: () => void;
  /** Bumped each time the card should flash (a tapped notification); 0 = never. */
  highlight: number;
  onLayoutHeight?: (h: number) => void;
}

function useReduceMotion(): boolean {
  const [still, setStill] = useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((v) => live && setStill(!!v))
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v) => setStill(!!v));
    return () => {
      live = false;
      sub?.remove?.();
    };
  }, []);
  return still;
}

export function RoutineCard({ name, when, text, color, expanded, onToggle, highlight, onLayoutHeight }: Props) {
  const tint = routineTints(color);
  const still = useReduceMotion();
  const body = routineHasBody(text);

  // open: 0 = collapsed, 1 = expanded (chevron, body fade); `height` animates the body's box.
  const open = useRef(new Animated.Value(expanded ? 1 : 0)).current;
  const height = useRef(new Animated.Value(0)).current;
  const bodyH = useRef(0);
  const [mounted, setMounted] = useState(expanded); // the body is in the tree
  const [settled, setSettled] = useState(expanded); // fully open: height is natural, not animated
  const first = useRef(true);

  const run = (to: 'open' | 'closed') => {
    const opening = to === 'open';
    const dur = still ? 0 : opening ? ROUTINE_MOTION.expand : ROUTINE_MOTION.collapse;
    const ease = opening ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic);
    const finish = () => {
      if (opening) {
        setMounted(true);
        setSettled(true);
      } else setMounted(false);
    };
    if (dur === 0) {
      open.setValue(opening ? 1 : 0);
      finish();
      return;
    }
    if (opening) {
      // Wait for the body to measure itself, then grow to its height.
      setMounted(true);
      setSettled(false);
      height.setValue(0);
      const start = () =>
        Animated.parallel([
          Animated.timing(height, { toValue: bodyH.current, duration: dur, easing: ease, useNativeDriver: false }),
          Animated.timing(open, { toValue: 1, duration: dur, easing: ease, useNativeDriver: false }),
        ]).start(({ finished }) => finished && finish());
      pendingStart.current = start;
      if (bodyH.current > 0) {
        pendingStart.current = null;
        start();
      }
    } else {
      pendingStart.current = null;
      height.setValue(bodyH.current);
      setSettled(false);
      Animated.parallel([
        Animated.timing(height, { toValue: 0, duration: dur, easing: ease, useNativeDriver: false }),
        Animated.timing(open, { toValue: 0, duration: dur, easing: ease, useNativeDriver: false }),
      ]).start(({ finished }) => finished && finish());
    }
  };
  const pendingStart = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    run(expanded ? 'open' : 'closed');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  // The flash: fill and border go to the highlight colours, hold, then fade back (Reduce Motion: hold 1 s, snap).
  const flash = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!highlight) return;
    flash.stopAnimation();
    flash.setValue(1);
    const hold = still ? ROUTINE_MOTION.highlightHoldStill : ROUTINE_MOTION.highlightHold;
    const anim = Animated.sequence([
      Animated.delay(hold),
      still ? Animated.timing(flash, { toValue: 0, duration: 0, useNativeDriver: false }) : Animated.timing(flash, { toValue: 0, duration: ROUTINE_MOTION.highlightFade, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
    ]);
    anim.start();
    return () => anim.stop();
  }, [highlight, flash, still]);

  const fill = flash.interpolate({ inputRange: [0, 1], outputRange: [tint.fill, tint.highlightFill] });
  const borderColor = flash.interpolate({ inputRange: [0, 1], outputRange: [tint.border, tint.highlightBorder] });
  // The extra 1 pt that makes the border 1.5 while it flashes is drawn inside the card, so nothing moves.
  const ring = flash.interpolate({ inputRange: [0, 1], outputRange: ['rgba(0,0,0,0)', tint.highlightBorder] });
  const rotate = open.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '90deg'] });

  const tappable = body;
  const header = (hovered: boolean, pressed: boolean) => [styles.header, (pressed || hovered) && tappable && { backgroundColor: tint.pressed }];

  return (
    <Animated.View
      style={[styles.card, { backgroundColor: fill, borderColor }]}
      onLayout={onLayoutHeight ? (e) => onLayoutHeight(e.nativeEvent.layout.height) : undefined}
    >
      <Pressable
        onPress={tappable ? onToggle : undefined}
        disabled={!tappable}
        accessibilityRole={tappable ? 'button' : undefined}
        accessibilityLabel={routineLabel(name, when)}
        accessibilityHint={tappable ? routineHint(expanded) : undefined}
        aria-expanded={tappable ? expanded : undefined}
        style={(s) => header(!!(s as { hovered?: boolean }).hovered, s.pressed)}
      >
        <View style={[styles.disc, { backgroundColor: tint.disc }]}>
          <Icon name="clock" size={16} color={color} stroke={1.8} />
        </View>
        <View style={styles.texts}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>
              {name}
            </Text>
            <Text style={styles.when} numberOfLines={1}>
              {when}
            </Text>
          </View>
          {!expanded && body ? (
            <Text style={styles.preview} numberOfLines={1}>
              {routinePreview(text)}
            </Text>
          ) : null}
        </View>
        {body ? (
          <View style={styles.chevronBox}>
            <Animated.View style={{ transform: [{ rotate }] }}>
              <Svg width={9} height={15} viewBox="0 0 9 15" fill="none">
                <Path d="M1.5 1.5 7.5 7.5 1.5 13.5" stroke={colors.disclosure} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </Animated.View>
          </View>
        ) : null}
      </Pressable>
      {body && mounted ? (
        <Animated.View style={[styles.bodyClip, !settled && { height }, { opacity: settled ? 1 : open.interpolate({ inputRange: [0, 1], outputRange: [0, 1] }) }]}>
          <View
            onLayout={(e) => {
              bodyH.current = e.nativeEvent.layout.height;
              const go = pendingStart.current;
              if (go && bodyH.current > 0) {
                pendingStart.current = null;
                go();
              }
            }}
          >
            <View style={[styles.divider, { backgroundColor: tint.border }]} />
            <View style={styles.body}>
              <Markdown text={text} accent={color} />
            </View>
          </View>
        </Animated.View>
      ) : null}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.ring, { borderColor: ring }]} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { alignSelf: 'stretch', borderRadius: 16, borderWidth: 0.5, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingTop: 10, paddingBottom: 10, paddingLeft: 12, paddingRight: 4 },
  disc: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  texts: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'baseline' },
  name: { color: colors.text, fontSize: 15, lineHeight: 20, fontWeight: '600', flexShrink: 1 },
  when: { color: colors.dim, fontSize: 13, lineHeight: 18, marginLeft: 8, flexShrink: 0 },
  preview: { color: colors.dim, fontSize: 13, lineHeight: 18 },
  chevronBox: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginVertical: -10 },
  bodyClip: { overflow: 'hidden' },
  divider: { height: 0.5 },
  body: { paddingTop: 12, paddingHorizontal: 16, paddingBottom: 14 },
  ring: { borderWidth: 1, borderRadius: 16 },
});

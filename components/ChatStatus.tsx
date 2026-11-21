// What the chat shows while a reply is on its way (design fixes 4 and 5): the typing bubble, the live step
// chip and its step list, the inline approval card and the chip it collapses to.
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { BotSprite } from '@/components/BotSprite';
import { Icon } from '@/components/AppIcons';
import { ApprovalButtons } from '@/components/ApprovalButtons';
import { Chip } from '@/components/Chips';
import { isDesktop } from '@/components/desktop';
import { useBotLook } from '@/components/useBotLook';
import { useBotName } from '@/components/useBotName';
import { activityLine, APPROVAL_TIMEOUT_S, countdown, stillWorking, type Decision, type ToolCall } from '@/lib/chatState';
import type { ApprovalChoice, ApprovalRequest } from '@/lib/hermes';
import { mono, onColor } from '@/lib/theme';
import { makeStyles, useTheme } from '@/components/theme';
import { maxScale } from '@/lib/type';

/** The desktop app, and the web build in a desktop-sized window: desktop sizes instead of the phone's. */
export function useDesk(): boolean {
  const { width } = useWindowDimensions();
  return isDesktop || (Platform.OS === 'web' && width >= 1000);
}

function useReduceMotion(): boolean {
  const [still, setStill] = useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => live && setStill(v), () => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setStill);
    return () => {
      live = false;
      sub.remove();
    };
  }, []);
  return still;
}

/** The three dots pulse in sequence over 1.2 s; with Reduce Motion they hold still. */
function Dots() {
  const styles = useStyles();
  const still = useReduceMotion();
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (still) return;
    const loop = Animated.loop(Animated.timing(t, { toValue: 1, duration: 1200, easing: Easing.linear, useNativeDriver: Platform.OS !== 'web' }));
    loop.start();
    return () => loop.stop();
  }, [still, t]);
  return (
    <View style={styles.dots}>
      {[0, 1, 2].map((i) => {
        const s = i * 0.2;
        const opacity = still ? 0.7 : t.interpolate({ inputRange: [0, s, s + 0.2, s + 0.4, 1], outputRange: [0.35, 0.35, 1, 0.35, 0.35] });
        return <Animated.View key={i} style={[styles.dot, { opacity }]} />;
      })}
    </View>
  );
}

/**
 * The reply is on its way: the bot's character in its thinking mood, then a bubble with three dots (36 tall). After
 * 10 s "Still working · 48 s" shows under it, indented past the avatar. `since` is when the run started (Hermes's
 * time when it was picked up from another device, so it reads "2 min" there).
 */
export function TypingRow({ bot, since }: { bot: string; since: number }) {
  const styles = useStyles();
  const [now, setNow] = useState(() => Date.now());
  const start = useRef(since || Date.now()).current;
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const note = stillWorking(now - start);
  return (
    <View accessibilityLabel={note ? `Typing. ${note}` : 'Typing'} accessibilityLiveRegion="polite">
      <View style={styles.typingRow}>
        <BotSprite bot={bot} size={28} />
        <View style={styles.typingBubble}>
          <Dots />
        </View>
      </View>
      {note ? (
        <Text style={styles.still} maxFontSizeMultiplier={maxScale.chrome}>
          {note}
        </Text>
      ) : null}
    </View>
  );
}

/** A 12 px spinner. */
function Spinner() {
  const styles = useStyles();
  const still = useReduceMotion();
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (still) return;
    const loop = Animated.loop(Animated.timing(t, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: Platform.OS !== 'web' }));
    loop.start();
    return () => loop.stop();
  }, [still, t]);
  const rotate = t.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return <Animated.View style={[styles.spinner, { transform: [{ rotate }] }]} />;
}

/**
 * A run of tool calls is one chip that updates in place: a spinner and the friendly name of the running step, then
 * "✓ Used Trello, Web search · 4 steps ›" when it's done. Tap it for the steps, tap a step for what it ran.
 */
export function Activity({ tools, live }: { tools: ToolCall[]; live: boolean }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [open, setOpen] = useState(false);
  const [openStep, setOpenStep] = useState<number | null>(null);
  const failed = tools.some((t) => t.status === 'failed');
  const label = activityLine(tools, live);
  return (
    <View style={styles.activity}>
      <Chip
        status
        label={label}
        numberOfLines={1}
        onPress={() => setOpen(!open)}
        accessibilityState={{ expanded: open }}
        leading={live ? <Spinner /> : failed ? <Icon name="close" size={12} color={colors.bad} stroke={4.4} /> : <Icon name="check" size={12} color={colors.dim} stroke={4.4} />}
        trailing={live ? null : <Icon name={open ? 'chevron-down' : 'chevron'} size={12} color={colors.dim} stroke={3} />}
      />
      {open
        ? tools.map((t, i) => (
            <Pressable key={i} onPress={() => setOpenStep(openStep === i ? null : i)} disabled={!t.preview} accessibilityRole="button" style={styles.stepRow}>
              <View style={styles.stepLine}>
                {t.status === 'running' ? null : <Icon name={t.status === 'failed' ? 'close' : 'check'} size={11} color={t.status === 'failed' ? colors.bad : colors.dim} stroke={3} />}
                <Text style={[styles.step, t.status === 'failed' && { color: colors.bad }]} numberOfLines={1}>
                  {t.status === 'running' ? '… ' : ''}{t.name}
                </Text>
              </View>
              {openStep === i && t.preview ? (
                <Text style={[styles.step, styles.preview]} numberOfLines={12}>
                  {t.preview}
                </Text>
              ) : null}
            </Pressable>
          ))
        : null}
    </View>
  );
}

const CHOICE_LABEL: Record<ApprovalChoice, string> = {
  once: 'Allow once',
  session: 'Allow in this chat',
  always: 'Always allow',
  deny: 'Deny',
};
const CHOICE_DONE: Record<ApprovalChoice, string> = {
  once: 'Allowed once',
  session: 'Allowed in this chat',
  always: 'Always allowed',
  deny: 'Denied',
};
/** Phone: a 2x2 grid (Allow once, Deny / Allow in this chat, Always allow). Desktop: one row. Only what Hermes sent. */
export function approvalOrder(choices: ApprovalChoice[], desk: boolean): ApprovalChoice[] {
  const order: ApprovalChoice[] = desk ? ['once', 'session', 'always', 'deny'] : ['once', 'deny', 'session', 'always'];
  return order.filter((c) => choices.includes(c));
}

/** Seconds left of Hermes's 300 s, counted from when the card appeared. */
function useSecondsLeft(): number {
  const start = useRef(Date.now()).current;
  const [now, setNow] = useState(start);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return APPROVAL_TIMEOUT_S - (now - start) / 1000;
}

/**
 * Hermes paused the reply to ask before running a risky command. It's the last thing in the transcript, where the
 * bot's next step would be, and scrolls with the chat. One tap answers; while it's in flight the buttons dim.
 */
export function ApprovalCard({ request, bot, busy, onAnswer }: { request: ApprovalRequest; bot: string; busy: boolean; onAnswer: (choice: ApprovalChoice) => void }) {
  const { colors, mix } = useTheme();
  const styles = useStyles();
  const { color } = useBotLook(bot);
  const name = useBotName(bot);
  const desk = useDesk();
  const left = useSecondsLeft();
  const buttons = approvalOrder(request.choices, desk);
  return (
    <View testID="approval-card" style={[styles.approval, { borderColor: mix(color, 0.55) }, desk && { maxWidth: 560 }]} accessibilityLiveRegion="polite">
      <View style={styles.approvalHead}>
        <BotSprite bot={bot} size={24} />
        <View style={{ flex: 1 }}>
          <Text style={styles.approvalTitle} maxFontSizeMultiplier={maxScale.chrome}>
            Run this command?
          </Text>
          <Text style={styles.approvalSub} maxFontSizeMultiplier={maxScale.chrome} numberOfLines={1}>
            {name} needs your OK
          </Text>
        </View>
      </View>
      {request.command ? (
        <ScrollView horizontal style={styles.approvalCode} contentContainerStyle={styles.approvalCodeBody}>
          <Text style={styles.approvalCommand} selectable>
            {request.command}
          </Text>
        </ScrollView>
      ) : null}
      {request.description ? <Text style={styles.approvalWhy}>Hermes flagged it: {request.description}</Text> : null}
      <ApprovalButtons choices={buttons} labels={CHOICE_LABEL} color={color} desk={desk} disabled={busy} dim={busy} onAnswer={(c) => onAnswer(c as ApprovalChoice)} />
      <View style={styles.approvalFoot}>
        <Text style={styles.approvalNote}>Answers right away. No answer counts as Deny.</Text>
        <Text style={styles.approvalNote} accessibilityLabel={`${countdown(left)} left to answer`}>
          {countdown(left)}
        </Text>
      </View>
    </View>
  );
}

/** An answered approval, collapsed to one line: "✓ Allowed once · rm -rf ~/notes". */
export function DecisionChip({ decision, bot }: { decision: Decision; bot: string }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { color } = useBotLook(bot);
  const denied = decision.choice === 'deny';
  return (
    <Chip
      status
      label={`${CHOICE_DONE[decision.choice]}${decision.command ? ` · ${decision.command}` : ''}`}
      numberOfLines={1}
      accessibilityLabel={`${CHOICE_DONE[decision.choice]}: ${decision.command}`}
      leading={denied ? <Icon name="close" size={12} color={colors.bad} stroke={4.4} /> : <Icon name="check" size={12} color={color} stroke={4.4} />}
    />
  );
}

const useStyles = makeStyles(({ colors }) => StyleSheet.create({
  typingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start' },
  typingBubble: { height: 36, borderRadius: 18, backgroundColor: colors.card, paddingHorizontal: 16, justifyContent: 'center' },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: colors.dim },
  still: { color: colors.dim, fontSize: 13, lineHeight: 18, marginTop: 4, marginLeft: 36 },
  spinner: { width: 12, height: 12, borderRadius: 6, borderWidth: 1.5, borderColor: colors.dim, borderTopColor: 'transparent' },
  activity: { alignSelf: 'flex-start', maxWidth: '100%', gap: 6 },
  stepRow: { paddingLeft: 12 },
  stepLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  step: { color: colors.dim, fontSize: 13, lineHeight: 20 },
  preview: { fontFamily: mono, paddingLeft: 16 },
  approval: { alignSelf: 'stretch', padding: 14, gap: 10, borderRadius: 16, borderWidth: 1, backgroundColor: colors.card },
  approvalHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  approvalTitle: { color: colors.text, fontSize: 15, lineHeight: 20, fontWeight: '600' },
  approvalSub: { color: colors.dim, fontSize: 13, lineHeight: 18 },
  approvalCode: { flexGrow: 0, borderRadius: 8, backgroundColor: colors.code },
  approvalCodeBody: { paddingHorizontal: 12, paddingVertical: 10 },
  approvalCommand: { color: colors.text, fontFamily: mono, fontSize: 13, lineHeight: 18 },
  approvalWhy: { color: colors.dim, fontSize: 13, lineHeight: 18 },
  approvalFoot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  approvalNote: { color: colors.dim, fontSize: 12, lineHeight: 16 },
}));

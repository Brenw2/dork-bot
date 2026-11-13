// Errors in plain words (design fix 6): the banner under the nav for connection and key problems, the card in the
// transcript for a turn that failed, and the "Not sent" line under your bubble. Copy and rules: lib/errors.ts.
import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/AppIcons';
import { SmallButton } from '@/components/Buttons';
import { CHROME_SCALE } from '@/components/ChatStatus';
import { describeFailure, type Failure } from '@/lib/errors';
import { colors, mix } from '@/lib/theme';

/** Counts 5, 4, 3, 2, 1 and starts over: the load retries every 5 s. `restart` changes when a try happens. */
export function useRetryCountdown(active: boolean, restart: number, every = 5): number {
  const [left, setLeft] = useState(every);
  useEffect(() => {
    setLeft(every);
    if (!active) return;
    const id = setInterval(() => setLeft((n) => (n <= 1 ? every : n - 1)), 1000);
    return () => clearInterval(id);
  }, [active, restart, every]);
  return left;
}

/** Under the nav, styled like the model banner: warning icon, text 13/18, and one small button. */
export function FailureBanner({ failure, name, secondsToRetry, onRetry, onPair }: { failure: Failure; name: string; secondsToRetry: number; onRetry: () => void; onPair: () => void }) {
  const view = describeFailure(failure, name, secondsToRetry);
  if (view.place !== 'banner') return null;
  const pair = view.action === 'pair';
  return (
    <View style={styles.banner} accessibilityLiveRegion="polite" testID="failure-banner">
      <Icon name="warning" size={18} color={colors.bad} />
      <Text style={styles.bannerText} maxFontSizeMultiplier={CHROME_SCALE}>
        {view.text}
      </Text>
      <Pressable
        onPress={pair ? onPair : onRetry}
        accessibilityRole="button"
        accessibilityLabel={pair ? 'Pair again' : 'Retry now'}
        hitSlop={{ top: 7, bottom: 7 }}
        style={({ pressed }) => [styles.bannerButton, pressed && { opacity: 0.6 }]}
      >
        <Text style={styles.bannerButtonText} maxFontSizeMultiplier={CHROME_SCALE}>
          {pair ? 'Pair again' : 'Retry now'}
        </Text>
      </Pressable>
    </View>
  );
}

/**
 * The turn failed: a card under your message. "Try again" resends your last message to the same chat; "Details" shows
 * Hermes's raw error, selectable, with Copy. Never paraphrases Hermes: its message is quoted after "Hermes said:".
 */
export function FailureCard({ failure, bot, name, onAgain, onNewChat, onRetryUnsent }: { failure: Failure; bot: string; name: string; onAgain: () => void; onNewChat: () => void; onRetryUnsent: () => void }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const view = describeFailure(failure, name);
  if (view.place === 'unsent') {
    return (
      <Pressable onPress={onRetryUnsent} accessibilityRole="button" accessibilityLabel="Not sent. Tap to retry." style={styles.unsent} hitSlop={{ top: 8, bottom: 8, left: 8 }} testID="not-sent">
        <View style={styles.bang}>
          <Text style={styles.bangText}>!</Text>
        </View>
        <Text style={styles.unsentText}>{view.text}</Text>
      </Pressable>
    );
  }
  if (view.place !== 'card') return null;
  return (
    <View style={styles.card} accessibilityLiveRegion="polite" testID="failure-card">
      <View style={styles.cardTitle}>
        <Icon name="warning" size={18} color={colors.bad} />
        <Text style={styles.title} maxFontSizeMultiplier={CHROME_SCALE}>
          {view.title}
        </Text>
      </View>
      {view.detail ? <Text style={styles.detail}>{view.detail}</Text> : null}
      <View style={styles.cardButtons}>
        {view.actions.includes('again') ? <SmallButton label="Try again" bot={bot} tone="filled" onPress={onAgain} /> : null}
        {view.actions.includes('new-chat') ? <SmallButton label="New chat" bot={bot} tone="filled" onPress={onNewChat} /> : null}
        {view.actions.includes('details') ? <SmallButton label={open ? 'Hide details' : 'Details'} tone="neutral" onPress={() => setOpen(!open)} /> : null}
      </View>
      {open ? (
        <View style={styles.raw}>
          <Text style={styles.rawText} selectable testID="failure-raw">
            {failure.raw}
          </Text>
          <SmallButton
            label={copied ? 'Copied' : 'Copy'}
            tone="neutral"
            onPress={() => {
              void Clipboard.setStringAsync(failure.raw);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: colors.errorBg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.errorLine },
  bannerText: { flex: 1, color: colors.errorText, fontSize: 13, lineHeight: 18 },
  bannerButton: { height: 30, borderRadius: 15, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: mix(colors.bad, 0.25) },
  bannerButtonText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  card: { alignSelf: 'stretch', backgroundColor: colors.errorBg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.errorLine, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14, gap: 8 },
  cardTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, color: colors.text, fontSize: 15, lineHeight: 20, fontWeight: '600' },
  detail: { color: colors.errorDetail, fontSize: 13, lineHeight: 18 },
  cardButtons: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 2 },
  raw: { gap: 8, alignItems: 'flex-start', paddingTop: 4 },
  rawText: { color: colors.errorDetail, fontSize: 13, lineHeight: 18, alignSelf: 'stretch' },
  unsent: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-end' },
  bang: { width: 16, height: 16, borderRadius: 8, backgroundColor: colors.bad, alignItems: 'center', justifyContent: 'center' },
  bangText: { color: colors.bg, fontSize: 11, lineHeight: 13, fontWeight: '800' },
  unsentText: { color: colors.bad, fontSize: 12, lineHeight: 16 },
});

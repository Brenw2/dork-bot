import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useColumnStyle } from '@/components/Column';
import { loadManager } from '@/components/manager';
import { useBotName } from '@/components/useBotName';
import { getPushToken, notificationsSupported, turnOffNotifications, turnOnNotifications } from '@/components/notifications';
import { listBots } from '@/lib/bots';
import type { BotMeta } from '@/lib/manager';
import { mutePatch } from '@/lib/push';
import { sameHost } from '@/lib/sync';
import { button, colors } from '@/lib/theme';

/** The bot's display name (not its profile id). */
function BotLabel({ bot }: { bot: string }) {
  return <Text style={styles.bot}>{useBotName(bot)}</Text>;
}

// Notifications: one switch for this phone, then a switch per bot. A bot's switch is on Hermes
// (dork_bot.push.muted), so it applies to every phone; the Hermes plugin dork-bot-push does the
// sending (hermes-plugin/dork-bot-push). A bot's pushes: its replies, approvals and routine results.
export default function NotificationsScreen() {
  const column = useColumnStyle();
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [muted, setMuted] = useState<Record<string, boolean> | null>(null);

  const loadBots = useCallback(async () => {
    const manager = await loadManager();
    if (!manager) return setMuted({});
    const bots = (await listBots()).filter((b) => sameHost(b.url, manager.chatUrl)).map((b) => b.bot);
    const entries = await Promise.all(
      bots.map(async (bot) => [bot, (await manager.getMeta(bot).catch((): BotMeta => ({}))).push?.muted === true] as const),
    );
    setMuted(Object.fromEntries(entries));
  }, []);

  useEffect(() => {
    void getPushToken().then((t) => setOn(!!t));
    void loadBots();
  }, [loadBots]);

  const toggle = async () => {
    setBusy(true);
    setMessage(null);
    try {
      if (on) {
        const errors = await turnOffNotifications();
        setOn(false);
        setMessage(Object.keys(errors).length ? `Off here. Couldn't update: ${Object.keys(errors).join(', ')}.` : 'Off on this phone.');
      } else {
        const r = await turnOnNotifications();
        if (!r.ok) setMessage(r.reason);
        else {
          setOn(true);
          setMessage(Object.keys(r.errors).length ? `On. Couldn't update: ${Object.keys(r.errors).join(', ')}.` : 'On for every bot.');
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const setBotNotifications = async (bot: string, enabled: boolean) => {
    const before = muted?.[bot] ?? false;
    setMuted((m) => ({ ...m, [bot]: !enabled }));
    try {
      const manager = await loadManager();
      if (!manager) throw new Error('Connect to Hermes first.');
      await manager.setMeta(bot, { push: mutePatch(!enabled) });
    } catch (e) {
      setMuted((m) => ({ ...m, [bot]: before }));
      setMessage((e as Error).message);
    }
  };

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: 'Notifications' }} />
      <ScrollView contentContainerStyle={[styles.body, column]}>
        <Text style={styles.intro}>
          Get a notification when a bot finishes a reply, needs your OK, or finishes a routine you turned Notify me on (its result is also added to the chat). Each one opens the chat; every routine run is kept in Routine results.
        </Text>
        {notificationsSupported ? (
          <Pressable
            style={({ pressed }) => [button.primary, pressed && { opacity: 0.7 }, (busy || on === null) && button.disabled]}
            disabled={busy || on === null}
            onPress={() => void toggle()}
            accessibilityRole="button"
            accessibilityLabel={on ? 'Turn notifications off' : 'Turn notifications on'}
          >
            <Text style={button.text}>{on ? 'Turn off on this phone' : 'Turn on'}</Text>
          </Pressable>
        ) : (
          <Text style={styles.intro}>Notifications go to the iPhone app.</Text>
        )}
        {message ? <Text style={styles.message}>{message}</Text> : null}
        {muted && Object.keys(muted).length ? <Text style={styles.label}>Per bot</Text> : null}
        {Object.entries(muted ?? {}).map(([bot, isMuted]) => (
          <View key={bot} style={styles.row}>
            <BotLabel bot={bot} />
            <Switch
              value={!isMuted}
              onValueChange={(v) => void setBotNotifications(bot, v)}
              accessibilityLabel={`Notifications from ${bot}`}
              trackColor={{ true: colors.accent }}
            />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: { padding: 16, gap: 14 },
  intro: { color: colors.dim, fontSize: 14, lineHeight: 20 },
  message: { color: colors.text, fontSize: 14, lineHeight: 20 },
  label: { color: colors.dim, fontSize: 13, marginTop: 6 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, borderRadius: 14, backgroundColor: colors.card, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  bot: { color: colors.text, fontSize: 16, fontWeight: '600' },
});

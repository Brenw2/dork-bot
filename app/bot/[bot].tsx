import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View, Pressable } from 'react-native';
import { BotAvatar } from '@/components/BotSprite';
import { deleteBotFromHermes, hideBot } from '@/components/botActions';
import { modelLabel } from '@/components/ChatHeader';
import { useColumnStyle } from '@/components/Column';
import { isDesktop } from '@/components/desktop';
import { Group, GroupRow } from '@/components/Grouped';
import { Icon, type IconName } from '@/components/AppIcons';
import { loadManager } from '@/components/manager';
import { Sheet } from '@/components/Sheet';
import { useBotLook } from '@/components/useBotLook';
import { renameBot, useBotName } from '@/components/useBotName';
import { useChatModel } from '@/components/useChatModel';
import type { BotMeta } from '@/lib/manager';
import { mutePatch } from '@/lib/push';
import { colors, switchProps } from '@/lib/theme';

type Path = '/look/[bot]' | '/chats/[bot]' | '/routines/[bot]' | '/connectors/[bot]' | '/model/[bot]' | '/routine-results/[bot]';

// The bot sheet (docs/design/REVIEW.md, fix 10): everything about the bot itself, in one place. Opened by
// tapping the chat's title, long-pressing a bot in the list, or "Bot settings" in the chat's ⋯.
// iPhone and Duo: a sheet with Done. Desktop: a 360 wide popover under the title.
export default function BotSheet() {
  const { bot } = useLocalSearchParams<{ bot: string }>();
  const name = useBotName(bot);
  const { color } = useBotLook(bot);
  const column = useColumnStyle();
  const model = useChatModel(bot);
  const [job, setJob] = useState('');
  const [muted, setMuted] = useState<boolean | null>(null); // null: no Hermes sign-in, so no switch
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const manager = await loadManager().catch(() => null);
      if (!manager || !live) return;
      manager.listProfiles().then((ps) => live && setJob(ps.find((p) => p.name === bot)?.description ?? ''), () => undefined);
      manager.getMeta(bot).then((m: BotMeta) => live && setMuted(m.push?.muted === true), () => live && setMuted(false));
    })();
    return () => {
      live = false;
    };
  }, [bot]);

  // On the phone the next screen opens over this sheet (Done comes back here); on desktop it replaces the popover.
  const go = (pathname: Path) => (isDesktop ? router.replace({ pathname, params: { bot } }) : router.push({ pathname, params: { bot } }));
  const home = () => router.dismissTo('/');

  const setNotifications = async (on: boolean) => {
    const before = muted;
    setMuted(!on);
    setMessage(null);
    try {
      const manager = await loadManager();
      if (!manager) throw new Error('Connect to Hermes first.');
      await manager.setMeta(bot, { push: mutePatch(!on) });
    } catch (e) {
      setMuted(before);
      setMessage((e as Error).message);
    }
  };

  const tiles: { icon: IconName; label: string; path: Path }[] = [
    { icon: 'chats', label: 'Chats', path: '/chats/[bot]' },
    { icon: 'clock', label: 'Routines', path: '/routines/[bot]' },
    { icon: 'plug', label: 'Connectors', path: '/connectors/[bot]' },
    { icon: 'palette', label: 'Look', path: '/look/[bot]' },
  ];

  return (
    <View style={styles.screen}>
      <Sheet title="" bot={bot} />
      <ScrollView contentContainerStyle={[styles.body, column]}>
        <View style={styles.hero}>
          <BotAvatar bot={bot} size={72} />
          <Text style={styles.name} maxFontSizeMultiplier={1.4}>
            {name}
          </Text>
          {job ? <Text style={styles.job}>{job}</Text> : null}
        </View>
        <View style={styles.tiles}>
          {tiles.map((t) => (
            <Pressable key={t.label} onPress={() => go(t.path)} accessibilityRole="button" accessibilityLabel={`${t.label} for ${name}`} style={({ pressed }) => [styles.tile, pressed && { backgroundColor: colors.raised }]}>
              <Icon name={t.icon} size={22} color={color} />
              <Text style={styles.tileLabel} numberOfLines={1} maxFontSizeMultiplier={1.4}>
                {t.label}
              </Text>
            </Pressable>
          ))}
        </View>
        <Group>
          <GroupRow label="Model" value={modelLabel(model)} chevron onPress={() => go('/model/[bot]')} accessibilityLabel={`Model: ${modelLabel(model)}. Change model`} />
          <GroupRow label="Routine results" chevron onPress={() => go('/routine-results/[bot]')} />
          {muted !== null ? (
            <GroupRow
              label="Notifications"
              right={<Switch value={!muted} onValueChange={(v) => void setNotifications(v)} accessibilityLabel={`Notifications from ${name}`} {...switchProps} />}
            />
          ) : null}
          <GroupRow label="Rename" chevron onPress={() => renameBot(bot, name)} />
        </Group>
        {message ? <Text style={styles.message}>{message}</Text> : null}
        <Group>
          <GroupRow label="Hide bot" onPress={() => hideBot(bot, name, home)} />
          {bot === 'default' ? null : <GroupRow label="Delete bot…" destructive onPress={() => deleteBotFromHermes(bot, home)} />}
        </Group>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: isDesktop ? 'transparent' : colors.bg },
  body: { padding: 16, gap: 16, paddingBottom: 32 },
  hero: { alignItems: 'center', gap: 4, paddingTop: 4 },
  name: { color: colors.text, fontSize: 22, lineHeight: 28, fontWeight: '600', marginTop: 8 },
  job: { color: colors.dim, fontSize: 15, lineHeight: 20, textAlign: 'center' },
  tiles: { flexDirection: 'row', gap: 8 },
  tile: { flex: 1, height: 68, borderRadius: 12, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center', gap: 6 },
  tileLabel: { color: colors.text, fontSize: 13, fontWeight: '500' },
  message: { color: colors.bad, fontSize: 13, lineHeight: 18, paddingHorizontal: 16 },
});

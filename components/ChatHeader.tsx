// The chat's one-row header (docs/design/REVIEW.md, fix 2) and its model-problem banner.
// Phone: back "‹ Bots", the title block (avatar, name, model; tap for the bot sheet), Chats and ⋯.
// Two panes (desktop, open Duo in landscape): a sidebar toggle replaces back, and the row is 56 tall
// with a hairline under it.
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Menu } from '@/components/alert';
import { BotAvatar } from '@/components/BotSprite';
import { isDesktop } from '@/components/desktop';
import { startNewChat } from '@/components/currentChat';
import { renameOpenChat, deleteOpenChat } from '@/components/chatActions';
import { Icon } from '@/components/AppIcons';
import { useBotLook } from '@/components/useBotLook';
import { useBotName } from '@/components/useBotName';
import type { ChatModelState } from '@/components/useChatModel';
import { useWorkingOn } from '@/components/workWatch';
import { WorkingOn } from '@/components/WorkingOn';
import { providerName } from '@/lib/models';
import { colors, mix } from '@/lib/theme';

/** "gemma4:31b · Dork": the chat's model under the bot's name. */
export function modelLabel(m: Pick<ChatModelState, 'choice' | 'catalog' | 'error'>): string {
  if (m.choice) return `${m.choice.model}${m.choice.provider ? ` · ${providerName(m.catalog, m.choice.provider)}` : ''}`;
  return m.error ? "Couldn't load the model list" : 'Loading model…';
}

export const openBotSheet = (bot: string) => router.push({ pathname: '/bot/[bot]', params: { bot } });

export function ChatHeader({ bot, pane, list, model }: { bot: string; pane: boolean; list?: { hidden: boolean; toggle: () => void }; model: ChatModelState }) {
  const { color } = useBotLook(bot);
  const name = useBotName(bot);
  const work = useWorkingOn(bot);
  const insets = useSafeAreaInsets();
  const big = !isDesktop; // 44 pt hit areas on iOS, 32 on desktop
  const hit = big ? 44 : 32;
  const iconSize = big ? 24 : 19;

  // Desktop shortcuts shown in the menu: Ctrl+N new chat, Ctrl+\ shows or hides the bot list.
  useEffect(() => {
    if (!isDesktop) return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        void startNewChat(bot);
      } else if (e.key === '\\' && list) {
        e.preventDefault();
        list.toggle();
      }
    };
    globalThis.addEventListener?.('keydown', onKey);
    return () => globalThis.removeEventListener?.('keydown', onKey);
  }, [bot, list]);

  const more = (anchor?: { x: number; y: number }) =>
    Menu.show(
      name,
      [
        { text: 'New chat', icon: 'compose', shortcut: isDesktop ? 'Ctrl+N' : undefined, onPress: () => void startNewChat(bot) },
        { text: 'Rename this chat…', icon: 'pencil', onPress: () => void renameOpenChat(bot) },
        { text: 'Bot settings', icon: 'info', sepBefore: true, onPress: () => openBotSheet(bot) },
        { text: 'Delete this chat…', icon: 'trash', sepBefore: true, style: 'destructive', onPress: () => void deleteOpenChat(bot) },
        { text: 'Cancel', style: 'cancel' },
      ],
      anchor,
    );

  const iconStyle = ({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => [
    styles.icon,
    { width: hit, height: hit },
    (hovered || pressed) && !big && { backgroundColor: colors.raised },
    pressed && big && { opacity: 0.6 },
  ];

  return (
    <View style={[styles.bar, pane ? styles.barPane : { height: 52 + insets.top, paddingTop: insets.top, paddingLeft: 4 }]}>
      {pane ? (
        list ? (
          <Pressable
            onPress={list.toggle}
            accessibilityRole="button"
            accessibilityLabel={list.hidden ? 'Show the bot list' : 'Hide the bot list'}
            style={iconStyle}
          >
            <Icon name="sidebar" size={iconSize} color={colors.dim} />
          </Pressable>
        ) : null
      ) : (
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          accessibilityRole="button"
          accessibilityLabel="Back to the bots"
          style={({ pressed }) => [styles.back, pressed && { opacity: 0.6 }]}
        >
          <Icon name="back" size={31} color={color} stroke={2.6} />
          <Text style={{ color, fontSize: 17 }} maxFontSizeMultiplier={1.4}>Bots</Text>
        </Pressable>
      )}
      <View style={[styles.center, pane && { alignItems: 'flex-start' }]}>
        <Pressable
          onPress={() => openBotSheet(bot)}
          accessibilityRole="button"
          accessibilityLabel={`Bot settings for ${name}`}
          style={({ pressed }) => [styles.titleBlock, pressed && { backgroundColor: colors.raised }]}
        >
          <BotAvatar bot={bot} size={32} />
          <View style={styles.titles}>
            <Text style={styles.name} numberOfLines={1} maxFontSizeMultiplier={1.4}>{name}</Text>
            {work ? <WorkingOn bot={bot} /> : <Text style={styles.model} numberOfLines={1} maxFontSizeMultiplier={1.4}>{modelLabel(model)}</Text>}
          </View>
        </Pressable>
      </View>
      <Pressable
        onPress={() => router.push({ pathname: '/chats/[bot]', params: { bot } })}
        accessibilityRole="button"
        accessibilityLabel={`${name}'s chats`}
        style={iconStyle}
      >
        <Icon name="chats" size={iconSize} color={color} />
      </Pressable>
      <Pressable
        onPress={(e) => more({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })}
        accessibilityRole="button"
        accessibilityLabel={`More for this chat with ${name}`}
        style={iconStyle}
      >
        <Icon name="ellipsis" size={iconSize} color={color} />
      </Pressable>
    </View>
  );
}

/** Shown under the header only when the model can't work (useChatModel().problem). */
export function ModelBanner({ bot, problem }: { bot: string; problem: string }) {
  return (
    <View style={styles.banner} accessibilityLiveRegion="polite">
      <Icon name="warning" size={18} color={colors.bad} />
      <Text style={styles.bannerText} maxFontSizeMultiplier={1.4}>{problem}</Text>
      <Pressable
        onPress={() => router.push({ pathname: '/model/[bot]', params: { bot } })}
        accessibilityRole="button"
        accessibilityLabel="Pick model"
        hitSlop={{ top: 7, bottom: 7 }}
        style={({ pressed }) => [styles.bannerButton, pressed && { opacity: 0.6 }]}
      >
        <Text style={styles.bannerButtonText} maxFontSizeMultiplier={1.4}>Pick model</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bg },
  barPane: { height: 56, paddingHorizontal: isDesktop ? 12 : 8, gap: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  back: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 44, paddingRight: 6 },
  center: { flex: 1, alignItems: 'center', minWidth: 0 },
  titleBlock: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 10, paddingVertical: 4, paddingHorizontal: 6, maxWidth: '100%' },
  titles: { flexShrink: 1 },
  name: { color: colors.text, fontSize: 16, lineHeight: 20, fontWeight: '600' },
  model: { color: colors.dim, fontSize: 12, lineHeight: 16 },
  icon: { alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.errorBg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.errorLine,
  },
  bannerText: { flex: 1, color: colors.errorText, fontSize: 13, lineHeight: 18 },
  bannerButton: { height: 30, borderRadius: 15, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: mix(colors.bad, 0.25) },
  bannerButtonText: { color: colors.text, fontSize: 13, fontWeight: '600' },
});

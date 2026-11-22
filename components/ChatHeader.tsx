// The chat's one-row header (docs/design/REVIEW.md, fix 2) and its model-problem banner.
// Phone: back "‹ Bots", the title block (avatar, name, model; tap for the bot sheet), Chats and ⋯.
// Two panes (desktop, open Duo in landscape): a sidebar toggle replaces back, and the row is 56 tall
// with a hairline under it.
import { router } from 'expo-router';
import { useEffect, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Menu } from '@/components/alert';
import { BotAvatar } from '@/components/BotSprite';
import { isDesktop } from '@/components/desktop';
import { startNewChat } from '@/components/currentChat';
import { renameOpenChat, deleteOpenChat } from '@/components/chatActions';
import { Icon, type IconName } from '@/components/AppIcons';
import { ErrorBanner } from '@/components/States';
import { useBotLook } from '@/components/useBotLook';
import { useBotName } from '@/components/useBotName';
import type { ChatModelState } from '@/components/useChatModel';
import { useWorkingOn } from '@/components/workWatch';
import { WorkingOn } from '@/components/WorkingOn';
import { providerName } from '@/lib/models';
import { makeStyles, useTheme } from '@/components/theme';
import { maxScale } from '@/lib/type';

/** "gemma4:31b · Dork": the chat's model under the bot's name. */
export function modelLabel(m: Pick<ChatModelState, 'choice' | 'catalog' | 'error'>): string {
  if (m.choice) return `${m.choice.model}${m.choice.provider ? ` · ${providerName(m.catalog, m.choice.provider)}` : ''}`;
  return m.error ? "Couldn't load the model list" : 'Loading model…';
}

export const openBotSheet = (bot: string) => router.push({ pathname: '/bot/[bot]', params: { bot } });

/** One header icon button: 44 x 44 on the phone, 32 x 32 on desktop with a hover fill (K1). */
export function HeaderButton({ icon, label, color, onPress }: { icon: IconName; label: string; color: string; onPress: (e: GestureResponderEvent) => void }) {
  const { colors, theme } = useTheme();
  const styles = useStyles();
  const big = !isDesktop;
  const hit = big ? 44 : 32;
  // Terminal draws the icon in a square outlined box inside the full-size target, so the button keeps its 44 / 32 footprint.
  const term = theme.shape.brackets;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => [
        styles.icon,
        { width: hit, height: hit },
        (hovered || pressed) && !big && { backgroundColor: colors.raised },
        pressed && big && { opacity: 0.6 },
      ]}
    >
      {term ? (
        <View style={{ width: hit - 8, height: hit - 8, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} size={big ? 24 : 19} color={color} />
        </View>
      ) : theme.shape.circleButtons ? (
        // Paper: the icon sits in a white circle with a hairline, inside the same 44 / 32 target.
        <View style={{ width: hit - 4, height: hit - 4, borderRadius: (hit - 4) / 2, backgroundColor: colors.card, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} size={big ? 20 : 16} color={colors.text} />
        </View>
      ) : (
        <Icon name={icon} size={big ? 24 : 19} color={color} />
      )}
    </Pressable>
  );
}

/**
 * The one page header (K1), for a bot's chat and a group's: [back or sidebar toggle] [title block] [icons]. `tint` is
 * the bot's color, or the accent for a room. `title` is the tappable avatar + name + one dim line; `children` are the
 * icon buttons on the right, ending with the "..." circle.
 */
export function PageHeader({ pane, list, tint, title, children }: { pane: boolean; list?: { hidden: boolean; toggle: () => void }; tint: string; title: ReactNode; children: ReactNode }) {
  const { colors, label, skin, theme } = useTheme();
  // Terminal: the back link is mint (the kit's "‹ bots"); Classic keeps the bot's color.
  const backTint = theme.shape.brackets || theme.shape.circleButtons ? colors.accent : tint;
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  // Desktop shortcut: Ctrl+\ shows or hides the bot list.
  useEffect(() => {
    if (!isDesktop || !list) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.altKey && !e.metaKey && e.key === '\\') {
        e.preventDefault();
        list.toggle();
      }
    };
    globalThis.addEventListener?.('keydown', onKey);
    return () => globalThis.removeEventListener?.('keydown', onKey);
  }, [list]);
  return (
    <View style={[styles.bar, pane ? styles.barPane : { minHeight: 52 + insets.top, paddingTop: insets.top, paddingLeft: 4, paddingRight: theme.shape.circleButtons ? 10 : 0 }]}>
      {pane ? (
        list ? <HeaderButton icon="sidebar" color={colors.dim} label={list.hidden ? 'Show the bot list' : 'Hide the bot list'} onPress={list.toggle} /> : null
      ) : (
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          accessibilityRole="button"
          accessibilityLabel="Back to the bots"
          style={({ pressed }) => [styles.back, pressed && { opacity: 0.6 }]}
        >
          <Icon name="back" size={31} color={backTint} stroke={2.6} />
          <Text style={skin({ color: backTint, fontSize: 17 })} maxFontSizeMultiplier={maxScale.chrome}>{label('Bots')}</Text>
        </Pressable>
      )}
      <View style={[styles.center, pane && { alignItems: 'flex-start' }]}>{title}</View>
      {children}
    </View>
  );
}

export function ChatHeader({ bot, pane, list, model }: { bot: string; pane: boolean; list?: { hidden: boolean; toggle: () => void }; model: ChatModelState }) {
  const { colors, theme } = useTheme();
  // Paper: avatar and name sit in a white pill with a hairline (kit-paper, b2).
  const pill = theme.shape.circleButtons ? { backgroundColor: colors.card, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: 22, paddingHorizontal: 8, paddingVertical: 4 } : null;
  const styles = useStyles();
  const { color } = useBotLook(bot);
  const name = useBotName(bot);
  const work = useWorkingOn(bot);

  // Desktop shortcut shown in the menu: Ctrl+N new chat.
  useEffect(() => {
    if (!isDesktop) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.altKey && !e.metaKey && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault();
        void startNewChat(bot);
      }
    };
    globalThis.addEventListener?.('keydown', onKey);
    return () => globalThis.removeEventListener?.('keydown', onKey);
  }, [bot]);

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

  return (
    <PageHeader
      pane={pane}
      list={list}
      tint={color}
      title={
        <Pressable
          onPress={() => openBotSheet(bot)}
          accessibilityRole="button"
          accessibilityLabel={`Bot settings for ${name}`}
          style={({ pressed }) => [styles.titleBlock, pill, pressed && { backgroundColor: colors.raised }]}
        >
          <BotAvatar bot={bot} size={32} />
          <View style={styles.titles}>
            <Text style={styles.name} numberOfLines={1} maxFontSizeMultiplier={maxScale.chrome}>{name}</Text>
            {work ? <WorkingOn bot={bot} /> : <Text style={styles.model} numberOfLines={1} maxFontSizeMultiplier={maxScale.chrome}>{modelLabel(model)}</Text>}
          </View>
        </Pressable>
      }
    >
      <HeaderButton icon="chats" color={color} label={`${name}'s chats`} onPress={() => router.push({ pathname: '/chats/[bot]', params: { bot } })} />
      <HeaderButton icon="ellipsis" color={color} label={`More for this chat with ${name}`} onPress={(e) => more({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })} />
    </PageHeader>
  );
}

/** Shown under the header only when the model can't work (useChatModel().problem). */
export function ModelBanner({ bot, problem }: { bot: string; problem: string }) {
  return <ErrorBanner text={problem} action={{ label: 'Pick model', onPress: () => router.push({ pathname: '/model/[bot]', params: { bot } }) }} />;
}

const useStyles = makeStyles(({ colors }) => StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bg },
  barPane: { height: 56, paddingHorizontal: isDesktop ? 12 : 8, gap: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  back: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 44, paddingRight: 6 },
  center: { flex: 1, alignItems: 'center', minWidth: 0 },
  titleBlock: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 10, paddingVertical: 4, paddingHorizontal: 6, maxWidth: '100%' },
  titles: { flexShrink: 1 },
  name: { color: colors.text, fontSize: 16, lineHeight: 20, fontWeight: '600' },
  model: { color: colors.dim, fontSize: 12, lineHeight: 16 },
  icon: { alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
}));

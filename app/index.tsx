import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BotList } from '@/components/BotList';
import { ChatView } from '@/components/ChatView';
import { isDesktop } from '@/components/desktop';
import { useLayoutClass } from '@/components/useLayoutClass';
import { FOLD, foldNavFor } from '@/lib/layoutClass';
import { colors } from '@/lib/theme';

// Phones, the folded Duo and the open Duo in portrait: the bot list, and a tap pushes the chat.
// Open Duo in landscape: bot list left of the fold, gutter on the fold, chat on the right.
// Desktop app: list and chat side by side once the window is wide enough; no fold to avoid.
const DESKTOP_TWO_PANE = 720;
const DESKTOP_LIST = 320;

export default function Home() {
  const { width } = useWindowDimensions();
  const cls = useLayoutClass();
  // Content starts after the left inset (the rail, when it's on the left), but the fold is fixed in the window.
  const { left } = useSafeAreaInsets();
  const params = useLocalSearchParams<{ bot?: string }>();
  const [selected, setSelected] = useState<string | null>(params.bot ?? null);
  const prevCls = useRef(cls);

  const desktopWide = isDesktop && width >= DESKTOP_TWO_PANE;
  const prevDesktopWide = useRef(desktopWide);

  useEffect(() => {
    if (params.bot) setSelected(params.bot);
  }, [params.bot]);

  // Folding while two panes are open: carry the open chat into a full-screen chat.
  // (Desktop: the same when the window gets too narrow for two panes.)
  useEffect(() => {
    if (isDesktop) {
      const was = prevDesktopWide.current;
      prevDesktopWide.current = desktopWide;
      if (was && !desktopWide && selected) router.push({ pathname: '/chat/[bot]', params: { bot: selected } });
      return;
    }
    const action = foldNavFor(prevCls.current, cls, { pushedChat: null, selected });
    prevCls.current = cls;
    if (action?.type === 'push-chat') router.push({ pathname: '/chat/[bot]', params: { bot: action.bot } });
  }, [cls, selected, desktopWide]);

  if (desktopWide) {
    return (
      <View style={styles.row}>
        <View style={{ width: DESKTOP_LIST }}>
          <BotList onSelect={setSelected} selected={selected} />
        </View>
        <View style={styles.detail}>{selected ? <ChatView key={selected} bot={selected} inPane maxWidth={820} /> : <View style={styles.empty} />}</View>
      </View>
    );
  }

  if (cls !== 'expanded-wide') {
    return <BotList onSelect={(bot) => router.push({ pathname: '/chat/[bot]', params: { bot } })} />;
  }

  return (
    <View style={styles.row}>
      <View style={{ width: FOLD.listSize - left }}>
        <BotList onSelect={setSelected} selected={selected} />
      </View>
      {/* Nothing is drawn on the fold. */}
      <View style={{ width: FOLD.gutterSize }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
      <View style={styles.detail}>{selected ? <ChatView key={selected} bot={selected} inPane /> : <View style={styles.empty} />}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: 'row', backgroundColor: colors.bg },
  detail: { flex: 1, borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border },
  empty: { flex: 1 },
});

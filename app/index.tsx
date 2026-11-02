import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { BotList } from '@/components/BotList';
import { ChatView } from '@/components/ChatView';
import { useLayoutClass } from '@/components/useLayoutClass';
import { FOLD, foldNavFor } from '@/lib/layoutClass';
import { colors } from '@/lib/theme';

// Phones, the folded Duo and the open Duo in portrait: the bot list, and a tap pushes the chat.
// Open Duo in landscape: bot list left of the fold, gutter on the fold, chat on the right.
export default function Home() {
  const cls = useLayoutClass();
  const params = useLocalSearchParams<{ bot?: string }>();
  const [selected, setSelected] = useState<string | null>(params.bot ?? null);
  const prevCls = useRef(cls);

  useEffect(() => {
    if (params.bot) setSelected(params.bot);
  }, [params.bot]);

  // Folding while two panes are open: carry the open chat into a full-screen chat.
  useEffect(() => {
    const action = foldNavFor(prevCls.current, cls, { pushedChat: null, selected });
    prevCls.current = cls;
    if (action?.type === 'push-chat') router.push({ pathname: '/chat/[bot]', params: { bot: action.bot } });
  }, [cls, selected]);

  if (cls !== 'expanded-wide') {
    return <BotList onSelect={(bot) => router.push({ pathname: '/chat/[bot]', params: { bot } })} />;
  }

  return (
    <View style={styles.row}>
      <View style={{ width: FOLD.listSize }}>
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

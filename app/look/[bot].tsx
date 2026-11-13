import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Sprite } from '@/components/BotSprite';
import { Sheet } from '@/components/Sheet';
import { useColumnStyle } from '@/components/Column';
import { LookPicker } from '@/components/LookPicker';
import { useBotLook } from '@/components/useBotLook';
import { pushMeta } from '@/components/sync';
import { setLook } from '@/lib/bots';
import { MOODS, type Look } from '@/lib/sprites';
import { colors } from '@/lib/theme';

// Change a bot's look (the bot sheet's Look tile): color, character, and its style. Save is in the sheet header.
export default function ChangeLook() {
  const { bot } = useLocalSearchParams<{ bot: string }>();
  const current = useBotLook(bot);
  const [picked, setPicked] = useState<Look>(current);
  const column = useColumnStyle();
  useEffect(() => setPicked(current), [current]);

  const save = async () => {
    await setLook(bot, picked);
    void pushMeta(bot, { look: picked });
    router.back();
  };
  // A stable object, so the header isn't rebuilt on every render.
  const commit = { label: 'Save', onPress: save };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.body, column]}>
      <Sheet title="Look" bot={bot} close="cancel" commit={commit} />
      <View style={styles.preview}>
        {MOODS.filter((m) => m !== 'sleeping').map((m) => (
          <Sprite key={m} character={picked.character} variant={picked.variant} color={picked.color} mood={m} size={40} seed={m.length} />
        ))}
      </View>
      <LookPicker value={picked} onChange={setPicked} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: { padding: 16, gap: 18 },
  preview: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' },
});

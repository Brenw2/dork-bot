import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Sprite } from '@/components/BotSprite';
import { useColumnStyle } from '@/components/Column';
import { LookPicker } from '@/components/LookPicker';
import { useBotLook } from '@/components/useBotLook';
import { pushMeta } from '@/components/sync';
import { setLook } from '@/lib/bots';
import { MOODS, type Look } from '@/lib/sprites';
import { button, colors } from '@/lib/theme';

// Change a bot's look (long-press a bot → Change look…): color, character, and its style.
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

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.body, column]}>
      <Stack.Screen options={{ title: bot }} />
      <View style={styles.preview}>
        {MOODS.filter((m) => m !== 'sleeping').map((m) => (
          <Sprite key={m} character={picked.character} variant={picked.variant} color={picked.color} mood={m} size={40} seed={m.length} />
        ))}
      </View>
      <LookPicker value={picked} onChange={setPicked} />
      <Pressable style={styles.button} onPress={save} accessibilityRole="button">
        <Text style={styles.buttonText}>Save</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: { padding: 20, gap: 18 },
  preview: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' },
  button: { ...button.primary, height: 50, borderRadius: 25 },
  buttonText: button.text,
});

import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CharacterPicker } from '@/components/CharacterPicker';
import { useColumnStyle } from '@/components/Column';
import { Sprite } from '@/components/BotSprite';
import { useBotCharacter } from '@/components/useBotCharacter';
import { setCharacter } from '@/lib/bots';
import { MOODS, type CharacterId } from '@/lib/sprites';
import { botColor, colors } from '@/lib/theme';

// Change a bot's pixel character (long-press a bot → Change character…).
export default function ChangeCharacter() {
  const { bot } = useLocalSearchParams<{ bot: string }>();
  const current = useBotCharacter(bot);
  const [picked, setPicked] = useState<CharacterId>(current);
  const column = useColumnStyle();
  const color = botColor(bot);
  useEffect(() => setPicked(current), [current]);

  const save = async () => {
    await setCharacter(bot, picked);
    router.back();
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.body, column]}>
      <Stack.Screen options={{ title: bot }} />
      <View style={styles.preview}>
        {MOODS.filter((m) => m !== 'sleeping').map((m) => (
          <Sprite key={m} character={picked} color={color} mood={m} size={40} seed={m.length} />
        ))}
      </View>
      <CharacterPicker value={picked} onChange={setPicked} color={color} />
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
  button: { padding: 15, borderRadius: 14, backgroundColor: colors.accent, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});

import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, SectionList, StyleSheet, Text, TextInput, View } from 'react-native';
import { loadManager } from '@/components/manager';
import { useColumnStyle } from '@/components/Column';
import { useChatModel } from '@/components/useChatModel';
import { setModelChoice } from '@/lib/bots';
import { chatSessionId } from '@/lib/hermes';
import { filterCatalog, switchModel, type ModelChoice } from '@/lib/models';
import { colors } from '@/lib/theme';

// Switch a bot's model (tap the model line at the top of the chat). Applies from the next message.
export default function PickModel() {
  const { bot } = useLocalSearchParams<{ bot: string }>();
  const column = useColumnStyle();
  const { catalog, choice, problem, client, error } = useChatModel(bot);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const sections = useMemo(
    () => (catalog ? filterCatalog(catalog, search).map((g) => ({ group: g, data: g.models })) : []),
    [catalog, search],
  );

  const pick = async (next: ModelChoice) => {
    if (!client || busy) return;
    setBusy(`${next.provider}/${next.model}`);
    setFailed(null);
    try {
      const manager = await loadManager();
      await switchModel(next, catalog?.botDefault ?? null, {
        setBotModel: manager ? (c) => manager.setBotModel(bot, c) : null,
        setChatModel: (c) => client.setModel(chatSessionId(bot), c),
      });
      await setModelChoice(bot, next);
      router.back();
    } catch (e) {
      setFailed((e as Error).message);
      setBusy(null);
    }
  };

  const isChosen = (provider: string, model: string) => choice?.provider === provider && choice.model === model;
  const isDefault = (provider: string, model: string) => catalog?.botDefault?.provider === provider && catalog.botDefault.model === model;

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: `${bot}'s model` }} />
      <View style={[styles.fill, column]}>
        <TextInput
          style={styles.search}
          value={search}
          onChangeText={setSearch}
          placeholder="Search models"
          placeholderTextColor={colors.dim}
          accessibilityLabel="Search models"
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
        {problem ? <Text style={styles.problem}>{problem}</Text> : null}
        {failed || error ? <Text style={styles.problem}>{failed ?? error}</Text> : null}
        {!catalog && !error ? <ActivityIndicator style={{ marginTop: 32 }} /> : null}
        <SectionList
          sections={sections}
          keyExtractor={(m, i) => `${m}-${i}`}
          stickySectionHeadersEnabled={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.list}
          ListFooterComponent={catalog ? <Text style={styles.note}>Picking one sets {bot}'s model, for this chat and new ones. It applies from your next message.</Text> : undefined}
          renderSectionHeader={({ section }) => (
            <Text style={styles.header}>
              {section.group.name}
              {section.group.current ? '  ·  set in Hermes' : ''}
            </Text>
          )}
          renderItem={({ item, section }) => {
            const provider = section.group.slug;
            const chosen = isChosen(provider, item);
            const working = busy === `${provider}/${item}`;
            return (
              <Pressable
                style={({ pressed }) => [styles.row, chosen && styles.rowChosen, pressed && { opacity: 0.6 }]}
                onPress={() => pick({ provider, model: item })}
                disabled={!!busy}
                accessibilityRole="button"
                accessibilityLabel={`${item}, ${section.group.name}`}
                accessibilityState={{ selected: chosen, busy: working }}
              >
                <Text style={styles.model} numberOfLines={1}>
                  {item}
                </Text>
                {isDefault(provider, item) ? <Text style={styles.tag}>default</Text> : null}
                {working ? <ActivityIndicator size="small" /> : chosen ? <Text style={styles.check}>✓</Text> : null}
              </Pressable>
            );
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  fill: { flex: 1 },
  search: {
    margin: 16,
    marginBottom: 8,
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: colors.card,
  },
  problem: { color: colors.bad, fontSize: 14, lineHeight: 20, paddingHorizontal: 16, paddingBottom: 8 },
  list: { paddingHorizontal: 16, paddingBottom: 40, gap: 6 },
  header: { color: colors.dim, fontSize: 13, fontWeight: '600', marginTop: 14, marginBottom: 4, textTransform: 'uppercase' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  rowChosen: { borderColor: colors.accent, borderWidth: 1.5 },
  model: { flex: 1, color: colors.text, fontSize: 15 },
  tag: { color: colors.dim, fontSize: 12 },
  check: { color: colors.accent, fontSize: 16, fontWeight: '700' },
  note: { color: colors.dim, fontSize: 13, textAlign: 'center', marginTop: 16 },
});

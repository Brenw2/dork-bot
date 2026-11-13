import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, SectionList, StyleSheet, Text, TextInput, View } from 'react-native';
import { loadManager } from '@/components/manager';
import { Sheet } from '@/components/Sheet';
import { useTint } from '@/components/Buttons';
import { GroupHeader } from '@/components/Grouped';
import { useBotName } from '@/components/useBotName';
import { useColumnStyle } from '@/components/Column';
import { useChatModel } from '@/components/useChatModel';
import { pushMeta } from '@/components/sync';
import { setModelChoice } from '@/lib/bots';
import { useCurrentChat } from '@/components/currentChat';
import { firstChatId } from '@/lib/chats';
import { filterCatalog, switchModel, type ModelChoice } from '@/lib/models';
import { colors } from '@/lib/theme';

// Switch a bot's model (tap the model line at the top of the chat). Applies from the next message.
export default function PickModel() {
  const { bot } = useLocalSearchParams<{ bot: string }>();
  const botName = useBotName(bot);
  const column = useColumnStyle();
  const tint = useTint(bot);
  const { catalog, choice, problem, client, error } = useChatModel(bot);
  const chat = useCurrentChat(bot) ?? firstChatId(bot);
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
        // A new chat has no Hermes session until its first message: make it so it can hold the pick.
        setChatModel: (c) => client.ensureSession(chat).then(() => client.setModel(chat, c)),
      });
      await setModelChoice(bot, next);
      void pushMeta(bot, { model: next });
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
      <Sheet title="Model" bot={bot} />
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
          ListFooterComponent={catalog ? <Text style={styles.note}>Picking one sets {botName}'s model, for this chat and new ones. It applies from your next message.</Text> : undefined}
          renderSectionHeader={({ section }) => <GroupHeader>{`${section.group.name}${section.group.current ? '  ·  set in Hermes' : ''}`}</GroupHeader>}
          renderItem={({ item, index, section }) => {
            const provider = section.group.slug;
            const chosen = isChosen(provider, item);
            const working = busy === `${provider}/${item}`;
            const first = index === 0;
            const last = index === section.data.length - 1;
            return (
              <View style={[styles.rowWrap, first && styles.rowFirst, last && styles.rowLast]}>
                {first ? null : <View style={styles.sep} />}
                <Pressable
                  style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.raised }]}
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
                  {working ? <ActivityIndicator size="small" /> : chosen ? <Text style={[styles.check, { color: tint }]}>✓</Text> : null}
                </Pressable>
              </View>
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
  search: { margin: 16, marginBottom: 0, color: colors.text, fontSize: 17, height: 36, paddingHorizontal: 12, borderRadius: 10, backgroundColor: colors.card },
  problem: { color: colors.bad, fontSize: 14, lineHeight: 20, paddingHorizontal: 16, paddingTop: 8 },
  list: { paddingHorizontal: 16, paddingBottom: 40 },
  rowWrap: { backgroundColor: colors.card, overflow: 'hidden' },
  rowFirst: { borderTopLeftRadius: 12, borderTopRightRadius: 12 },
  rowLast: { borderBottomLeftRadius: 12, borderBottomRightRadius: 12 },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 52, paddingHorizontal: 16 },
  model: { flex: 1, color: colors.text, fontSize: 17, lineHeight: 22 },
  tag: { color: colors.dim, fontSize: 13 },
  check: { fontSize: 22, fontWeight: '700' },
  note: { color: colors.dim, fontSize: 13, lineHeight: 18, marginHorizontal: 16, marginTop: 14 },
});

import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button, SmallButton } from '@/components/Buttons';
import { Sheet } from '@/components/Sheet';
import { Group, GroupFootnote, GroupHeader, GroupRow } from '@/components/Grouped';
import { useBotName } from '@/components/useBotName';
import { Column, useColumnStyle } from '@/components/Column';
import { browser } from '@/components/connectorBrowser';
import { loadManager } from '@/components/manager';
import { connectorNotes } from '@/lib/connectorNotes';
import { Connectors, type CatalogEntry, type Connector } from '@/lib/connectors';
import { colors, mono } from '@/lib/theme';

type Health = { state: 'checking' } | { state: 'ok'; tools: number } | { state: 'signin' } | { state: 'error'; message: string };

const healthText = (h: Health, working: string | null) =>
  working ??
  (h.state === 'checking' ? 'Checking…' : h.state === 'ok' ? `${h.tools} tools` : h.state === 'signin' ? 'Needs you to sign in' : h.message);

export default function ConnectorsScreen() {
  const { bot } = useLocalSearchParams<{ bot: string }>();
  const botName = useBotName(bot);
  const column = useColumnStyle();
  const [api, setApi] = useState<Connectors | null | undefined>(undefined);
  const [mine, setMine] = useState<Connector[] | null>(null);
  const [health, setHealth] = useState<Record<string, Health>>({});
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<{ name: string; status: string } | null>(null);
  const [setupFor, setSetupFor] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState({ name: '', url: '' });
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    loadManager().then((m) => setApi(m ? new Connectors(m, bot) : null));
  }, [bot]);

  const refresh = useCallback(async (c: Connectors) => {
    try {
      const [list, cat] = await Promise.all([c.list(), c.catalog()]);
      setMine(list);
      setCatalog(cat);
      setHealth(Object.fromEntries(list.map((s) => [s.name, { state: 'checking' } as Health])));
      for (const s of list) {
        c.test(s.name)
          .then((tools) => setHealth((h) => ({ ...h, [s.name]: { state: 'ok', tools: tools.length } })))
          .catch((e: Error) =>
            setHealth((h) => ({
              ...h,
              [s.name]:
                s.auth === 'oauth' && /oauth|token|auth/i.test(e.message) ? { state: 'signin' } : { state: 'error', message: e.message },
            })),
          );
      }
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    }
  }, []);

  useEffect(() => {
    if (api) refresh(api);
  }, [api, refresh]);

  const available = useMemo(() => {
    const have = new Set((mine ?? []).map((c) => c.name));
    const s = search.trim().toLowerCase();
    return catalog.filter((e) => !have.has(e.name) && (!s || e.name.includes(s) || e.description.toLowerCase().includes(s)));
  }, [catalog, mine, search]);

  if (api === undefined) return <View style={styles.screen} />;
  if (api === null) {
    return (
      <View style={styles.screen}>
        <Column style={styles.center}>
          <Text style={styles.title}>Connect to Hermes first</Text>
          <Text style={styles.text}>
            On b-lab run <Text style={styles.code}>scripts/pair-hermes.sh</Text> and scan the code. You only do this once.
          </Text>
        </Column>
      </View>
    );
  }

  const run = async (name: string, work: (onStatus: (s: string) => void) => Promise<number>) => {
    setNotice(null);
    setBusy({ name, status: 'Starting…' });
    try {
      const tools = await work((status) => setBusy({ name, status }));
      connectorNotes.added(bot, name);
      setNotice({ ok: true, text: `${name} is connected (${tools} tools). ${botName} can use it in about a minute.` });
      setSetupFor(null);
      setValues({});
      await refresh(api);
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const connectEntry = (entry: CatalogEntry) => {
    if (entry.needs.length && setupFor !== entry.name) {
      setSetupFor(entry.name);
      return;
    }
    const missing = entry.needs.find((n) => n.required && !values[n.name]?.trim());
    if (missing) return setNotice({ ok: false, text: `${missing.prompt} is needed first.` });
    run(entry.name, (onStatus) => api.connect({ entry, values }, browser, { onStatus }).then((t) => t.length));
  };

  const connectCustom = () =>
    run(custom.name.trim().toLowerCase() || 'custom', (onStatus) =>
      api.connect({ name: custom.name, url: custom.url }, browser, { onStatus }).then((t) => {
        setCustom({ name: '', url: '' });
        return t.length;
      }),
    );

  const open = (name: string) => router.push({ pathname: '/connector/[bot]', params: { bot, name } });

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.body, column]} keyboardShouldPersistTaps="handled">
      <Sheet title="Connectors" bot={bot} />
      {notice ? <Text style={[notice.ok ? styles.ok : styles.error, styles.notice]}>{notice.text}</Text> : null}

      <GroupHeader>Connected</GroupHeader>
      {mine === null ? (
        <ActivityIndicator color={colors.dim} />
      ) : mine.length === 0 ? (
        <GroupFootnote>Nothing yet. Pick one below and sign in; {botName} gets its tools.</GroupFootnote>
      ) : (
        <Group>
          {mine.map((c) => {
            const h = health[c.name] ?? { state: 'checking' };
            const working = busy?.name === c.name;
            return (
              <GroupRow
                key={c.name}
                label={c.name}
                detail={healthText(h, working ? busy.status : null)}
                detailColor={h.state === 'error' ? colors.bad : undefined}
                chevron={!(h.state === 'signin' && !working)}
                onPress={() => open(c.name)}
                accessibilityLabel={`${c.name}, ${healthText(h, working ? busy.status : null)}. Details`}
                right={
                  working ? (
                    <ActivityIndicator color={colors.dim} />
                  ) : h.state === 'signin' ? (
                    <SmallButton
                      label="Sign in"
                      bot={bot}
                      tone="filled"
                      disabled={!!busy}
                      onPress={() => run(c.name, (onStatus) => api.signIn(c.name, browser, { onStatus }).then((t) => t.length))}
                    />
                  ) : null
                }
              />
            );
          })}
        </Group>
      )}

      <GroupHeader>Add a connector</GroupHeader>
      <TextInput
        style={styles.input}
        value={search}
        onChangeText={setSearch}
        placeholder="Search Notion, Linear, Strava…"
        placeholderTextColor={colors.faint}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="Search connectors"
      />
      {available.length ? (
        <Group style={{ marginTop: 12 }}>
          {available.map((e) => {
            const working = busy?.name === e.name;
            return (
              <View key={e.name}>
                <GroupRow
                  label={e.name}
                  detail={working ? busy.status : e.description}
                  right={working ? <ActivityIndicator color={colors.dim} /> : <SmallButton label={e.auth === 'oauth' ? 'Connect' : 'Add'} bot={bot} tone="tint" disabled={!!busy} onPress={() => connectEntry(e)} accessibilityLabel={`${e.auth === 'oauth' ? 'Connect' : 'Add'} ${e.name}`} />}
                />
                {setupFor === e.name ? (
                  <View style={styles.setup}>
                    {e.needs.map((n) => (
                      <TextInput
                        key={n.name}
                        style={styles.input}
                        value={values[n.name] ?? ''}
                        onChangeText={(t) => setValues((v) => ({ ...v, [n.name]: t }))}
                        placeholder={n.prompt}
                        placeholderTextColor={colors.faint}
                        autoCapitalize="none"
                        autoCorrect={false}
                        secureTextEntry={/secret|token|key/i.test(n.name)}
                        accessibilityLabel={n.prompt}
                      />
                    ))}
                  </View>
                ) : null}
              </View>
            );
          })}
        </Group>
      ) : null}

      <GroupHeader>Custom connector</GroupHeader>
      <TextInput
        style={styles.input}
        value={custom.name}
        onChangeText={(name) => setCustom((c) => ({ ...c, name: name.toLowerCase() }))}
        placeholder="name, e.g. my-tools"
        placeholderTextColor={colors.faint}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="Connector name"
      />
      <TextInput
        style={[styles.input, { marginTop: 8 }]}
        value={custom.url}
        onChangeText={(url) => setCustom((c) => ({ ...c, url }))}
        placeholder="https://example.com/mcp"
        placeholderTextColor={colors.faint}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        accessibilityLabel="Connector URL"
      />
      <GroupFootnote>Any remote MCP server. If it needs a sign-in, the page opens here.</GroupFootnote>
      <Button
        bot={bot}
        style={{ marginTop: 16 }}
        label={busy && busy.name === custom.name ? busy.status : 'Connect'}
        accessibilityLabel="Connect custom connector"
        disabled={!custom.name || !custom.url || !!busy}
        onPress={connectCustom}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  body: { padding: 16, paddingBottom: 48 },
  title: { color: colors.text, fontSize: 20, fontWeight: '600' },
  text: { color: colors.dim, fontSize: 15, textAlign: 'center', lineHeight: 22 },
  code: { color: colors.text, fontFamily: mono },
  notice: { marginHorizontal: 16, marginTop: 8 },
  ok: { color: colors.ok, fontSize: 14, lineHeight: 20 },
  error: { color: colors.bad, fontSize: 14, lineHeight: 20 },
  setup: { paddingHorizontal: 16, paddingBottom: 12, gap: 8 },
  input: { color: colors.text, fontSize: 17, minHeight: 44, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: colors.card },
});

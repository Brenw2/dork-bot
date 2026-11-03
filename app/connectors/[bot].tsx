import { Stack, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Column, useColumnStyle } from '@/components/Column';
import { loadManager } from '@/components/manager';
import { Connectors, type CatalogEntry, type Connector, type SignInBrowser } from '@/lib/connectors';
import { colors, mono } from '@/lib/theme';

// The sign-in page opens in an in-app browser (it shares Safari's logins, so it's often one tap).
// The provider sends it back to Hermes on b-lab; Connectors.signIn sees the approval and closes it.
const browser: SignInBrowser = {
  open: (url) => WebBrowser.openAuthSessionAsync(url, 'dorkbot://connected').then(() => undefined),
  close: () => WebBrowser.dismissAuthSession(),
};

type Health = { state: 'checking' } | { state: 'ok'; tools: number } | { state: 'signin' } | { state: 'error'; message: string };

export default function ConnectorsScreen() {
  const { bot } = useLocalSearchParams<{ bot: string }>();
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
      setNotice({ ok: true, text: `${name} is connected (${tools} tools). If ${bot} says it doesn't have it yet, Hermes needs a restart.` });
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

  const remove = (c: Connector) =>
    Alert.alert(`Remove ${c.name}?`, `${bot} loses its ${c.name} tools. You can connect it again any time.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () =>
          api
            .remove(c.name)
            .then(() => refresh(api))
            .catch((e: Error) => setNotice({ ok: false, text: e.message })),
      },
    ]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.body, column]} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: `${bot}'s connectors` }} />
      {notice ? <Text style={notice.ok ? styles.ok : styles.error}>{notice.text}</Text> : null}

      <Text style={styles.label}>Connected</Text>
      {mine === null ? (
        <ActivityIndicator color={colors.dim} />
      ) : mine.length === 0 ? (
        <Text style={styles.hint}>Nothing yet. Pick one below and sign in; {bot} gets its tools.</Text>
      ) : (
        mine.map((c) => {
          const h = health[c.name] ?? { state: 'checking' };
          const working = busy?.name === c.name;
          return (
            <View key={c.name} style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.name}>{c.name}</Text>
                <Text style={[styles.sub, h.state === 'error' && { color: colors.bad }]} numberOfLines={2}>
                  {working
                    ? busy.status
                    : h.state === 'checking'
                      ? 'Checking…'
                      : h.state === 'ok'
                        ? `${h.tools} tools`
                        : h.state === 'signin'
                          ? 'Needs you to sign in'
                          : h.message}
                </Text>
              </View>
              {h.state === 'signin' && !working ? (
                <SmallButton
                  label="Sign in"
                  disabled={!!busy}
                  onPress={() => run(c.name, (onStatus) => api.signIn(c.name, browser, { onStatus }).then((t) => t.length))}
                />
              ) : null}
              {!c.fromPlugin && !working ? <SmallButton label="Remove" quiet disabled={!!busy} onPress={() => remove(c)} /> : null}
              {working ? <ActivityIndicator color={colors.dim} /> : null}
            </View>
          );
        })
      )}

      <Text style={[styles.label, { marginTop: 10 }]}>Add a connector</Text>
      <TextInput
        style={styles.input}
        value={search}
        onChangeText={setSearch}
        placeholder="Search Notion, Linear, Strava…"
        placeholderTextColor={colors.dim}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="Search connectors"
      />
      {available.map((e) => {
        const working = busy?.name === e.name;
        return (
          <View key={e.name} style={[styles.row, styles.rowColumn]}>
            <View style={styles.rowLine}>
              <View style={styles.rowText}>
                <Text style={styles.name}>{e.name}</Text>
                <Text style={styles.sub} numberOfLines={2}>
                  {working ? busy.status : e.description}
                </Text>
              </View>
              {working ? (
                <ActivityIndicator color={colors.dim} />
              ) : (
                <SmallButton label={e.auth === 'oauth' ? 'Connect' : 'Add'} disabled={!!busy} onPress={() => connectEntry(e)} />
              )}
            </View>
            {setupFor === e.name
              ? e.needs.map((n) => (
                  <TextInput
                    key={n.name}
                    style={styles.input}
                    value={values[n.name] ?? ''}
                    onChangeText={(t) => setValues((v) => ({ ...v, [n.name]: t }))}
                    placeholder={n.prompt}
                    placeholderTextColor={colors.dim}
                    autoCapitalize="none"
                    autoCorrect={false}
                    secureTextEntry={/secret|token|key/i.test(n.name)}
                    accessibilityLabel={n.prompt}
                  />
                ))
              : null}
          </View>
        );
      })}

      <Text style={[styles.label, { marginTop: 10 }]}>Custom connector</Text>
      <Text style={styles.hint}>Any remote MCP server. If it needs a sign-in, the page opens here.</Text>
      <TextInput
        style={styles.input}
        value={custom.name}
        onChangeText={(name) => setCustom((c) => ({ ...c, name: name.toLowerCase() }))}
        placeholder="name, e.g. my-tools"
        placeholderTextColor={colors.dim}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="Connector name"
      />
      <TextInput
        style={styles.input}
        value={custom.url}
        onChangeText={(url) => setCustom((c) => ({ ...c, url }))}
        placeholder="https://example.com/mcp"
        placeholderTextColor={colors.dim}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        accessibilityLabel="Connector URL"
      />
      <Pressable
        style={[styles.button, (!custom.name || !custom.url || !!busy) && { opacity: 0.5 }]}
        disabled={!custom.name || !custom.url || !!busy}
        onPress={connectCustom}
        accessibilityRole="button"
        accessibilityLabel="Connect custom connector"
      >
        <Text style={styles.buttonText}>{busy && busy.name === custom.name ? busy.status : 'Connect'}</Text>
      </Pressable>
    </ScrollView>
  );
}

function SmallButton({ label, onPress, disabled, quiet }: { label: string; onPress: () => void; disabled?: boolean; quiet?: boolean }) {
  return (
    <Pressable
      style={[styles.small, quiet && styles.smallQuiet, disabled && { opacity: 0.5 }]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
    >
      <Text style={[styles.smallText, quiet && { color: colors.dim }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  body: { padding: 20, gap: 10, paddingBottom: 48 },
  title: { color: colors.text, fontSize: 20, fontWeight: '600' },
  text: { color: colors.dim, fontSize: 15, textAlign: 'center', lineHeight: 22 },
  code: { color: colors.text, fontFamily: mono },
  label: { color: colors.dim, fontSize: 13 },
  hint: { color: colors.dim, fontSize: 13, lineHeight: 18 },
  ok: { color: colors.ok, fontSize: 14, lineHeight: 20 },
  error: { color: colors.bad, fontSize: 14, lineHeight: 20 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  rowColumn: { flexDirection: 'column', alignItems: 'stretch' },
  rowLine: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowText: { flex: 1 },
  name: { color: colors.text, fontSize: 16, fontWeight: '600' },
  sub: { color: colors.dim, fontSize: 13, marginTop: 2 },
  input: {
    color: colors.text,
    fontSize: 16,
    padding: 13,
    borderRadius: 12,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  small: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 10, backgroundColor: colors.accent },
  smallQuiet: { backgroundColor: 'transparent', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  smallText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  button: { padding: 15, borderRadius: 14, backgroundColor: colors.accent, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});

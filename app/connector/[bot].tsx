import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Alert } from '@/components/alert';
import { Button } from '@/components/Buttons';
import { Column, useColumnStyle } from '@/components/Column';
import { browser } from '@/components/connectorBrowser';
import { Group, GroupFootnote, GroupHeader, GroupRow } from '@/components/Grouped';
import { loadManager } from '@/components/manager';
import { Sheet } from '@/components/Sheet';
import { useBotName } from '@/components/useBotName';
import { connectorNotes } from '@/lib/connectorNotes';
import { Connectors, type Connector, type Tool } from '@/lib/connectors';
import { colors } from '@/lib/theme';

type State = { state: 'checking' } | { state: 'ok'; tools: Tool[] } | { state: 'signin' } | { state: 'error'; message: string };

// One connector of a bot (opened from its row in Connectors): its status, its tools, Sign in when it needs it,
// and Remove. Remove isn't a button on the row any more (design fix 9).
export default function ConnectorDetail() {
  const { bot, name } = useLocalSearchParams<{ bot: string; name: string }>();
  const botName = useBotName(bot);
  const column = useColumnStyle();
  const [api, setApi] = useState<Connectors | null | undefined>(undefined);
  const [item, setItem] = useState<Connector | null>(null);
  const [status, setStatus] = useState<State>({ state: 'checking' });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadManager().then((m) => setApi(m ? new Connectors(m, bot) : null));
  }, [bot]);

  const check = (c: Connectors, auth: Connector['auth']) => {
    setStatus({ state: 'checking' });
    c.test(name)
      .then((tools) => setStatus({ state: 'ok', tools }))
      .catch((e: Error) => setStatus(auth === 'oauth' && /oauth|token|auth/i.test(e.message) ? { state: 'signin' } : { state: 'error', message: e.message }));
  };

  useEffect(() => {
    if (!api) return;
    api
      .list()
      .then((list) => {
        const found = list.find((c) => c.name === name) ?? null;
        setItem(found);
        if (found) check(api, found.auth);
      })
      .catch((e: Error) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, name]);

  const signIn = async () => {
    if (!api) return;
    setError(null);
    setBusy('Starting…');
    try {
      await api.signIn(name, browser, { onStatus: setBusy });
      connectorNotes.added(bot, name);
      check(api, item?.auth ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const remove = () =>
    Alert.alert(`Remove ${name}?`, `${botName} loses its ${name} tools. You can connect it again any time.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () =>
          api
            ?.remove(name)
            .then(() => connectorNotes.removed(bot, name))
            .then(() => (router.canGoBack() ? router.back() : router.replace('/')))
            .catch((e: Error) => setError(e.message)),
      },
    ]);

  const detail =
    status.state === 'checking' ? 'Checking…' : status.state === 'ok' ? `${status.tools.length} tools` : status.state === 'signin' ? 'Needs you to sign in' : status.message;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.body, column]}>
      <Sheet title={name} bot={bot} />
      {api === null ? (
        <Column style={styles.center}>
          <Text style={styles.text}>Connect to Hermes first.</Text>
        </Column>
      ) : (
        <>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <GroupHeader>Status</GroupHeader>
          <Group>
            <GroupRow label={name} detail={busy ?? detail} detailColor={status.state === 'error' ? colors.bad : undefined} right={status.state === 'checking' || busy ? <ActivityIndicator color={colors.dim} /> : undefined} />
            {item?.url ? <GroupRow label="Address" value={item.url} /> : null}
          </Group>
          {status.state === 'signin' && !busy ? <Button bot={bot} label="Sign in" style={styles.signIn} onPress={() => void signIn()} /> : null}

          {status.state === 'ok' && status.tools.length ? (
            <>
              <GroupHeader>{`Tools · ${status.tools.length}`}</GroupHeader>
              <Group>
                {status.tools.map((t) => (
                  <GroupRow key={t.name} label={t.name} detail={t.description || undefined} />
                ))}
              </Group>
            </>
          ) : null}

          {item && !item.fromPlugin ? (
            <>
              <View style={{ height: 18 }} />
              <Group>
                <GroupRow label="Remove connector…" destructive onPress={remove} />
              </Group>
              <GroupFootnote>{botName} loses its {name} tools. You can connect it again any time.</GroupFootnote>
            </>
          ) : item?.fromPlugin ? (
            <GroupFootnote>Added by a plugin on Hermes, so it can't be removed from the app.</GroupFootnote>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: { padding: 16, paddingBottom: 48 },
  center: { alignItems: 'center', padding: 32 },
  text: { color: colors.dim, fontSize: 15, textAlign: 'center' },
  error: { color: colors.bad, fontSize: 14, lineHeight: 20, marginHorizontal: 16, marginTop: 8 },
  signIn: { marginTop: 16 },
});

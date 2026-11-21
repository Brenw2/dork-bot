import { router, useLocalSearchParams } from 'expo-router';
import { Sheet } from '@/components/Sheet';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { fetch } from '@/components/net';
import { useColumnStyle } from '@/components/Column';
import { Field } from '@/components/Fields';
import { FormError } from '@/components/States';
import { saveBot } from '@/lib/bots';
import { HermesClient, normalizeUrl, type FetchLike } from '@/lib/hermes';
import { connectionFromParams, validateConnection } from '@/lib/pairing';
import { Button } from '@/components/Buttons';
import { makeStyles, useTheme } from '@/components/theme';

// Opened by hand, or by a dorkbot://add?url=…&bot=…&key=… pairing link.
export default function AddBot() {
  const styles = useStyles();
  const params = useLocalSearchParams();
  const fromLink = connectionFromParams(params);
  const [url, setUrl] = useState(fromLink.url ?? 'https://b-lab.tail7e27a7.ts.net');
  const [bot, setBot] = useState(fromLink.bot ?? '');
  const [key, setKey] = useState(fromLink.key ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const column = useColumnStyle();

  const submit = async () => {
    const conn = { url: normalizeUrl(url), bot: bot.trim().toLowerCase(), key: key.trim() };
    const invalid = validateConnection(conn);
    if (invalid) return setError(invalid);
    setBusy(true);
    setError(null);
    try {
      await new HermesClient(conn, fetch as unknown as FetchLike).check();
      await saveBot(conn);
      router.dismissTo('/');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.body, column]} keyboardShouldPersistTaps="handled">
      <Sheet title="Add with a code" close="cancel" />
      {fromLink.key ? <Text style={styles.note}>Filled in from the pairing code. Tap Add to connect.</Text> : null}
      <Labeled label="Hermes address" value={url} onChangeText={setUrl} keyboardType="url" />
      <Labeled label="Bot (Hermes profile)" value={bot} onChangeText={setBot} placeholder="assistant" />
      <Labeled label="Key (that profile's API_SERVER_KEY)" value={key} onChangeText={setKey} secureTextEntry />
      {error ? <FormError text={error} /> : null}
      <Button label="Add" busy={busy} onPress={submit} />
    </ScrollView>
  );
}

function Labeled(props: React.ComponentProps<typeof Field> & { label: string }) {
  const styles = useStyles();
  const { label, ...input } = props;
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{label}</Text>
      <Field autoCapitalize="none" autoCorrect={false} {...input} />
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: { padding: 16, gap: 16 },
  note: { color: colors.ok, fontSize: 14 },
  label: { color: colors.dim, fontSize: 13 },
}));

import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { fetch } from 'expo/fetch';
import { useColumnStyle } from '@/components/Column';
import { saveBot } from '@/lib/bots';
import { HermesClient, normalizeUrl, type FetchLike } from '@/lib/hermes';
import { connectionFromParams, validateConnection } from '@/lib/pairing';
import { button, colors } from '@/lib/theme';

// Opened by hand, or by a dorkbot://add?url=…&bot=…&key=… pairing link.
export default function AddBot() {
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
      {fromLink.key ? <Text style={styles.note}>Filled in from the pairing code. Tap Add to connect.</Text> : null}
      <Field label="Hermes address" value={url} onChangeText={setUrl} keyboardType="url" />
      <Field label="Bot (Hermes profile)" value={bot} onChangeText={setBot} placeholder="assistant" />
      <Field label="Key (that profile's API_SERVER_KEY)" value={key} onChangeText={setKey} secureTextEntry />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable
        style={[styles.button, busy && { opacity: 0.6 }]}
        onPress={submit}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="Add"
      >
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Add</Text>}
      </Pressable>
    </ScrollView>
  );
}

function Field(props: React.ComponentProps<typeof TextInput> & { label: string }) {
  const { label, ...input } = props;
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput style={styles.input} autoCapitalize="none" autoCorrect={false} placeholderTextColor={colors.dim} {...input} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: { padding: 20, gap: 18 },
  note: { color: colors.ok, fontSize: 14 },
  label: { color: colors.dim, fontSize: 13 },
  input: {
    color: colors.text,
    fontSize: 16,
    padding: 13,
    borderRadius: 12,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  error: { color: colors.bad, fontSize: 14 },
  button: { ...button.primary, height: 50, borderRadius: 25 },
  buttonText: button.text,
});

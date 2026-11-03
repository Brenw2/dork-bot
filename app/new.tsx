import { Link, router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { CharacterPicker } from '@/components/CharacterPicker';
import { Column, useColumnStyle } from '@/components/Column';
import { loadManager, randomKey } from '@/components/manager';
import { listBots, saveBot } from '@/lib/bots';
import type { HermesManager, Profile } from '@/lib/manager';
import { characterFor, type CharacterId } from '@/lib/sprites';
import { botColor, colors, mono } from '@/lib/theme';

// Create a bot (a new Hermes profile on Dork), or connect one that's already on Hermes.
export default function NewBot() {
  const [manager, setManager] = useState<HermesManager | null | undefined>(undefined);
  const [name, setName] = useState('');
  const [job, setJob] = useState('');
  // Follows the name (a default character per name) until he picks one himself.
  const [picked, setPicked] = useState<CharacterId | null>(null);
  const character = picked ?? characterFor(name || 'new');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [others, setOthers] = useState<Profile[]>([]);
  const column = useColumnStyle();

  useEffect(() => {
    loadManager().then(setManager);
  }, []);

  const loadOthers = useCallback(async (m: HermesManager) => {
    try {
      const [profiles, saved] = await Promise.all([m.listProfiles(), listBots()]);
      const have = new Set(saved.map((b) => b.bot));
      setOthers(profiles.filter((p) => !p.isDefault && !have.has(p.name)));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (manager) loadOthers(manager);
  }, [manager, loadOthers]);

  if (manager === undefined) return <View style={styles.screen} />;
  if (manager === null) {
    return (
      <View style={styles.screen}>
        <Column style={styles.center}>
          <Text style={styles.title}>Connect to Hermes first</Text>
          <Text style={styles.text}>
            On b-lab run{'\n'}
            <Text style={styles.code}>scripts/pair-hermes.sh</Text>
            {'\n'}and scan the QR code with the iPhone camera. You only do this once.
          </Text>
        </Column>
      </View>
    );
  }

  const create = async () => {
    setError(null);
    setBusy('Creating the bot on Hermes…');
    try {
      const conn = await manager.createBot({ name, job }, randomKey);
      await saveBot(conn, character);
      router.dismissTo({ pathname: '/', params: { bot: conn.bot } });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const connect = async (profile: string) => {
    setError(null);
    setBusy(`Connecting ${profile}…`);
    try {
      const conn = await manager.connectExisting(profile, randomKey);
      await saveBot(conn);
      router.dismissTo({ pathname: '/', params: { bot: conn.bot } });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.body, column]} keyboardShouldPersistTaps="handled">
      <Field label="Name" value={name} onChangeText={(t) => setName(t.toLowerCase())} placeholder="scout" maxLength={64} />
      <Field
        label="What does it do?"
        value={job}
        onChangeText={setJob}
        placeholder="Finds and summarizes news about the Mets"
        multiline
        style={[styles.input, { minHeight: 90, textAlignVertical: 'top' }]}
      />
      <View style={{ gap: 6 }}>
        <Text style={styles.label}>Character</Text>
        <CharacterPicker value={character} onChange={setPicked} color={botColor(name || 'new')} />
      </View>
      <Text style={styles.hint}>
        It runs on Dork, with the same tools as {'"'}assistant{'"'} but its own memory and chat.
      </Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable
        style={[styles.button, (!!busy || !name || !job.trim()) && { opacity: 0.5 }]}
        onPress={create}
        disabled={!!busy || !name || !job.trim()}
        accessibilityRole="button"
        accessibilityLabel="Create bot"
      >
        {busy ? (
          <View style={styles.busyRow}>
            <ActivityIndicator color="#fff" />
            <Text style={styles.buttonText}>{busy}</Text>
          </View>
        ) : (
          <Text style={styles.buttonText}>Create bot</Text>
        )}
      </Pressable>

      {others.length ? (
        <View style={{ gap: 10, marginTop: 12 }}>
          <Text style={styles.label}>Already on Hermes</Text>
          {others.map((p) => (
            <Pressable
              key={p.name}
              style={styles.row}
              onPress={() => connect(p.name)}
              disabled={!!busy}
              accessibilityRole="button"
              accessibilityLabel={`Add ${p.name}`}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{p.name}</Text>
                {p.description ? (
                  <Text style={styles.sub} numberOfLines={2}>
                    {p.description}
                  </Text>
                ) : null}
              </View>
              <Text style={styles.addText}>Add</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <Link href="/add" style={styles.link}>
        Add with a pairing code instead
      </Link>
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
  center: { alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  body: { padding: 20, gap: 18 },
  title: { color: colors.text, fontSize: 20, fontWeight: '600' },
  text: { color: colors.dim, fontSize: 15, textAlign: 'center', lineHeight: 22 },
  code: { color: colors.text, fontFamily: mono },
  label: { color: colors.dim, fontSize: 13 },
  hint: { color: colors.dim, fontSize: 13, lineHeight: 18 },
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
  button: { padding: 15, borderRadius: 14, backgroundColor: colors.accent, alignItems: 'center' },
  busyRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  name: { color: colors.text, fontSize: 16, fontWeight: '600' },
  sub: { color: colors.dim, fontSize: 13, marginTop: 2 },
  addText: { color: colors.accent, fontSize: 15, fontWeight: '600' },
  link: { color: colors.dim, fontSize: 14, textAlign: 'center', marginTop: 8, textDecorationLine: 'underline' },
});

import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Alert } from '@/components/alert';
import { useBotName } from '@/components/useBotName';
import { useColumnStyle } from '@/components/Column';
import { isDesktop } from '@/components/desktop';
import { Markdown } from '@/components/Markdown';
import { fetch } from '@/components/net';
import { useBotLook } from '@/components/useBotLook';
import { getConnection } from '@/lib/bots';
import { HermesClient, type FetchLike } from '@/lib/hermes';
import { Routines, SCHEDULES, scheduleLabel, whenLabel, type Routine } from '@/lib/routines';
import { button, colors, mix, onColor } from '@/lib/theme';

// A bot's routines (Hermes cron jobs): what it does on a schedule by itself, like a morning
// digest. Add, pause, run now, delete; each shows its next run and what its last run said.
export default function RoutinesScreen() {
  const { bot } = useLocalSearchParams<{ bot: string }>();
  const botName = useBotName(bot);
  const column = useColumnStyle();
  const { color } = useBotLook(bot);
  const [api, setApi] = useState<Routines | null>(null);
  const [list, setList] = useState<Routine[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (r: Routines) => {
    try {
      setList(await r.list());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void getConnection(bot).then((conn) => {
      if (!conn) return setError(`No saved key for ${bot}.`);
      const r = new Routines(new HermesClient(conn, fetch as unknown as FetchLike));
      setApi(r);
      void load(r);
    });
  }, [bot, load]);

  const refresh = () => {
    if (!api) return;
    setRefreshing(true);
    void load(api).finally(() => setRefreshing(false));
  };

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: `${botName}'s routines` }} />
      <ScrollView
        contentContainerStyle={[styles.body, column]}
        keyboardShouldPersistTaps="handled"
        refreshControl={isDesktop ? undefined : <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.dim} />}
      >
        <Text style={styles.intro}>Things {botName} does on a schedule by itself. Each run is saved on Hermes; its result shows here.</Text>
        {adding && api ? (
          <NewRoutine
            bot={bot}
            api={api}
            color={color}
            onDone={(added) => {
              setAdding(false);
              if (added) void load(api);
            }}
          />
        ) : (
          <Pressable
            style={({ pressed }) => [styles.add, { backgroundColor: color }, pressed && { opacity: 0.7 }, !api && button.disabled]}
            disabled={!api}
            onPress={() => setAdding(true)}
            accessibilityRole="button"
            accessibilityLabel="New routine"
          >
            <Text style={[styles.addText, { color: onColor(color) }]}>+ New routine</Text>
          </Pressable>
        )}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {list === null && !error ? <ActivityIndicator style={{ marginTop: 20 }} /> : null}
        {list?.length === 0 ? <Text style={styles.empty}>No routines yet.</Text> : null}
        {api ? list?.map((r) => <RoutineCard key={r.id} routine={r} bot={bot} api={api} color={color} onChanged={() => void load(api)} />) : null}
      </ScrollView>
    </View>
  );
}

function NewRoutine({ bot, api, color, onDone }: { bot: string; api: Routines; color: string; onDone: (added: boolean) => void }) {
  const botName = useBotName(bot);
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [schedule, setSchedule] = useState(SCHEDULES[0].value);
  const [custom, setCustom] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.create({ name, prompt, schedule });
      onDone(true);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  const ready = !!name.trim() && !!prompt.trim() && !!schedule.trim() && !busy;
  return (
    <View style={styles.card}>
      <Text style={styles.label}>Name</Text>
      <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Morning digest" placeholderTextColor={colors.dim} accessibilityLabel="Routine name" maxLength={200} />
      <Text style={styles.label}>What should {botName} do?</Text>
      <TextInput
        style={[styles.input, { minHeight: 90, textAlignVertical: 'top' }]}
        value={prompt}
        onChangeText={setPrompt}
        placeholder="Check my calendar and email and write me a short digest of what needs me today."
        placeholderTextColor={colors.dim}
        multiline
        accessibilityLabel="What the routine does"
        maxLength={5000}
      />
      <Text style={styles.label}>When</Text>
      <View style={styles.chips}>
        {SCHEDULES.map((s) => {
          const on = !custom && schedule === s.value;
          return (
            <Pressable
              key={s.value}
              onPress={() => {
                setCustom(false);
                setSchedule(s.value);
              }}
              style={[styles.chip, on && { backgroundColor: color, borderColor: color }]}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.chipText, on && { color: onColor(color) }]}>{s.label}</Text>
            </Pressable>
          );
        })}
        <Pressable
          onPress={() => {
            setCustom(true);
            setSchedule('');
          }}
          style={[styles.chip, custom && { backgroundColor: color, borderColor: color }]}
          accessibilityRole="button"
          accessibilityState={{ selected: custom }}
        >
          <Text style={[styles.chipText, custom && { color: onColor(color) }]}>Other…</Text>
        </Pressable>
      </View>
      {custom ? (
        <>
          <TextInput
            style={styles.input}
            value={schedule}
            onChangeText={setSchedule}
            placeholder="every 2h · 30m · 0 7 * * 6 · 2026-11-10T09:00"
            placeholderTextColor={colors.dim}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Custom schedule"
          />
          <Text style={styles.hint}>A cron line (minute hour day month weekday), "every 2h", "30m" (once, in 30 minutes) or a date and time. Times are b-lab's (New York).</Text>
        </>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.row}>
        <Pressable onPress={() => onDone(false)} style={styles.secondary} accessibilityRole="button" accessibilityLabel="Cancel">
          <Text style={styles.secondaryText}>Cancel</Text>
        </Pressable>
        <Pressable
          onPress={save}
          disabled={!ready}
          style={[styles.primary, { backgroundColor: color }, !ready && button.disabled]}
          accessibilityRole="button"
          accessibilityLabel="Add routine"
        >
          {busy ? <ActivityIndicator color={onColor(color)} /> : <Text style={[styles.primaryText, { color: onColor(color) }, !ready && button.disabledText]}>Add routine</Text>}
        </Pressable>
      </View>
    </View>
  );
}

function RoutineCard({ routine: r, bot, api, color, onChanged }: { routine: Routine; bot: string; api: Routines; color: string; onChanged: () => void }) {
  const botName = useBotName(bot);
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<{ at: number; text: string } | null | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const paused = !r.enabled || r.state === 'paused';

  useEffect(() => {
    if (!open || result !== undefined) return;
    void api
      .runs(r.name, 1)
      .then(async ([last]) => setResult(last ? { at: last.at, text: await api.result(last.sessionId) } : null))
      .catch(() => setResult(null));
  }, [open, result, api, r.name]);

  const act = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
      onChanged();
    } catch (e) {
      Alert.alert(`Couldn't ${label.toLowerCase()}`, (e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const remove = () =>
    Alert.alert(`Delete "${r.name}"?`, `${botName} stops doing it. Past runs stay on Hermes.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void act('Delete', () => api.remove(r.id)) },
    ]);

  const status = paused ? 'Paused' : r.nextRunAt ? `Next: ${whenLabel(r.nextRunAt)}` : r.state;
  const last = r.lastRunAt ? `Last: ${whenLabel(r.lastRunAt)}${r.lastStatus && r.lastStatus !== 'ok' ? ` · ${r.lastStatus}` : ''}` : 'Not run yet';
  return (
    <View style={[styles.card, paused && { opacity: 0.75 }]}>
      <Pressable onPress={() => setOpen(!open)} accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`${r.name}, ${scheduleLabel(r.schedule)}, ${status}`}>
        <View style={styles.row}>
          <Text style={[styles.name, { flex: 1 }]} numberOfLines={1}>
            {r.name}
          </Text>
          <Text style={styles.toggle}>{open ? '▾' : '▸'}</Text>
        </View>
        <Text style={styles.sub}>
          {scheduleLabel(r.schedule)} · {status}
        </Text>
        <Text style={[styles.sub, r.lastStatus === 'error' && { color: colors.bad }]}>{last}</Text>
      </Pressable>
      {open ? (
        <View style={{ gap: 10, marginTop: 4 }}>
          <Text style={styles.prompt}>{r.prompt}</Text>
          {r.lastError ? <Text style={styles.error}>{r.lastError}</Text> : null}
          <View style={[styles.result, { borderColor: mix(color, 0.4) }]}>
            <Text style={styles.label}>{result ? `Last result · ${whenLabel(new Date(result.at * 1000).toISOString())}` : 'Last result'}</Text>
            {result === undefined ? <ActivityIndicator /> : result?.text ? <Markdown text={result.text} accent={color} /> : <Text style={styles.sub}>Nothing yet.</Text>}
          </View>
          <View style={styles.row}>
            <SmallButton label="Run now" busy={busy === 'Run now'} color={color} onPress={() => void act('Run now', () => api.runNow(r.id)).then(() => setResult(undefined))} />
            <SmallButton label={paused ? 'Turn on' : 'Pause'} busy={busy === 'Pause' || busy === 'Turn on'} color={color} onPress={() => void act(paused ? 'Turn on' : 'Pause', () => (paused ? api.resume(r.id) : api.pause(r.id)))} />
            <SmallButton label="Delete" busy={busy === 'Delete'} color={colors.bad} onPress={remove} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

function SmallButton({ label, busy, color, onPress }: { label: string; busy: boolean; color: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={busy} style={({ pressed }) => [styles.small, { borderColor: color }, (pressed || busy) && { opacity: 0.6 }]} accessibilityRole="button" accessibilityLabel={label}>
      {busy ? <ActivityIndicator color={color} /> : <Text style={[styles.smallText, { color }]}>{label}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: { padding: 16, gap: 12 },
  intro: { color: colors.dim, fontSize: 14, lineHeight: 20 },
  add: { ...button.primary, height: 46, borderRadius: 23 },
  addText: button.text,
  empty: { color: colors.dim, fontSize: 15, textAlign: 'center', marginTop: 12 },
  error: { color: colors.bad, fontSize: 14 },
  card: { padding: 14, gap: 6, borderRadius: 14, backgroundColor: colors.card, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  name: { color: colors.text, fontSize: 16, fontWeight: '600' },
  toggle: { color: colors.dim, fontSize: 14 },
  sub: { color: colors.dim, fontSize: 13 },
  prompt: { color: colors.text, fontSize: 14, lineHeight: 20 },
  result: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 6 },
  label: { color: colors.dim, fontSize: 13 },
  hint: { color: colors.dim, fontSize: 12, lineHeight: 17 },
  input: { color: colors.text, fontSize: 16, padding: 12, borderRadius: 12, backgroundColor: colors.bg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 16, paddingHorizontal: 12, height: 32, justifyContent: 'center' },
  chipText: { color: colors.text, fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  primary: { ...button.primary, flex: 1, height: 44, borderRadius: 22 },
  primaryText: button.text,
  secondary: { height: 44, paddingHorizontal: 18, justifyContent: 'center' },
  secondaryText: { color: colors.dim, fontSize: 15 },
  small: { borderWidth: 1.5, borderRadius: 16, paddingHorizontal: 14, height: 34, alignItems: 'center', justifyContent: 'center', minWidth: 80 },
  smallText: { fontSize: 14, fontWeight: '600' },
});

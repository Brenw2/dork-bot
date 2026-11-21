import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Alert } from '@/components/alert';
import { Icon } from '@/components/AppIcons';
import { Chip } from '@/components/Chips';
import { Field } from '@/components/Fields';
import { EmptyState, ErrorBanner, FormError, Loading } from '@/components/States';
import { Sheet } from '@/components/Sheet';
import { useBotName } from '@/components/useBotName';
import { useColumnStyle } from '@/components/Column';
import { isDesktop } from '@/components/desktop';
import { loadManager } from '@/components/manager';
import { Markdown } from '@/components/Markdown';
import { MessageMenu } from '@/components/MessageMenu';
import { fetch } from '@/components/net';
import { useBotLook } from '@/components/useBotLook';
import { getConnection } from '@/lib/bots';
import { HermesClient, type FetchLike } from '@/lib/hermes';
import { notifyOn, setNotify, type PushDeps } from '@/lib/push';
import { Routines, SCHEDULES, scheduleLabel, whenLabel, type Routine } from '@/lib/routines';
import { onColor } from '@/lib/theme';
import { Button, SmallButton } from '@/components/Buttons';
import { Group } from '@/components/Grouped';
import { makeStyles, useTheme } from '@/components/theme';

// A bot's routines (Hermes cron jobs): what it does on a schedule by itself, like a morning
// digest. Add, pause, run now, delete; each shows its next run and what its last run said.
export default function RoutinesScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { bot } = useLocalSearchParams<{ bot: string }>();
  const botName = useBotName(bot);
  const column = useColumnStyle();
  const { color } = useBotLook(bot);
  const [api, setApi] = useState<Routines | null>(null);
  const [list, setList] = useState<Routine[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // "Notify me": the routines marked on Hermes (dork_bot.push.routines), shared by every device.
  // null: not loaded yet, or no way to reach the bot's settings (the switch stays off and disabled).
  const [marks, setMarks] = useState<string[] | null>(null);
  const [pushDeps, setPushDeps] = useState<PushDeps | null>(null);

  const load = useCallback(
    async (r: Routines) => {
      try {
        setList(await r.list());
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      }
      try {
        const manager = await loadManager();
        if (!manager) return;
        setPushDeps({ getPush: async (b) => (await manager.getMeta(b)).push, setPush: (b, push) => manager.setMeta(b, { push }) });
        setMarks(((await manager.getMeta(bot)).push?.routines ?? []).slice());
      } catch {
        // the switches stay as they were; the list above still works
      }
    },
    [bot],
  );

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

  const notify = {
    ready: !!pushDeps && marks !== null,
    isOn: (id: string) => marks?.includes(id) === true,
    set: async (id: string, on: boolean) => {
      if (!pushDeps) throw new Error('Connect to Hermes first.');
      setMarks(await setNotify(pushDeps, bot, id, on));
    },
  };

  // The header's + opens the new-routine form (once the routines are reachable).
  const action = useMemo(() => (api && !adding ? { label: 'New routine', icon: 'plus' as const, onPress: () => setAdding(true) } : undefined), [api, adding]);

  return (
    <View style={styles.screen}>
      <Sheet title="Routines" bot={bot} action={action} />
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
            notify={notify}
            onDone={(added) => {
              setAdding(false);
              if (added) void load(api);
            }}
          />
        ) : null}
        {error ? <ErrorBanner card text={error} /> : null}
        {list === null && !error ? <Loading /> : null}
        {list?.length === 0 ? <EmptyState body="No routines yet." /> : null}
        {api && list?.length ? <Group>{list.map((r) => <RoutineCard key={r.id} routine={r} bot={bot} api={api} color={color} notify={notify} onChanged={() => void load(api)} />)}</Group> : null}
      </ScrollView>
    </View>
  );
}

/** The screen's hold on the "Notify me" marks (dork_bot.push.routines on Hermes). */
interface NotifyMarks {
  ready: boolean;
  isOn: (id: string) => boolean;
  set: (id: string, on: boolean) => Promise<void>;
}

/** "Notify me": the routine's result goes in the bot's chat and to the phone. Off unless switched on. */
function NotifySwitch({ value, disabled, spacing, onChange }: { value: boolean; disabled: boolean; spacing: number; onChange: (on: boolean) => void }) {
  const { switchProps } = useTheme();
  const styles = useStyles();
  return (
    <View style={[styles.notifyRow, { marginVertical: spacing }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.notifyLabel}>Notify me</Text>
        <Text style={styles.notifyHint}>Puts the result in the chat and sends a notification.</Text>
      </View>
      <Switch value={value} disabled={disabled} onValueChange={onChange} accessibilityLabel="Notify me" {...switchProps} />
    </View>
  );
}

function NewRoutine({ bot, api, color, notify, onDone }: { bot: string; api: Routines; color: string; notify: NotifyMarks; onDone: (added: boolean) => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const botName = useBotName(bot);
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [schedule, setSchedule] = useState(SCHEDULES[0].value);
  const [custom, setCustom] = useState(false);
  const [notifyMe, setNotifyMe] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const added = await api.create({ name, prompt, schedule });
      if (notifyMe) {
        try {
          await notify.set(added.id, true);
        } catch (e) {
          Alert.alert("Added, but Notify me didn't save", `${(e as Error).message}\n\nTurn it on from the routine's card.`);
        }
      }
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
      <Field value={name} onChangeText={setName} placeholder="Morning digest" tint={color} accessibilityLabel="Routine name" maxLength={200} />
      <Text style={styles.label}>What should {botName} do?</Text>
      <Field
        value={prompt}
        onChangeText={setPrompt}
        placeholder="Check my calendar and email and write me a short digest of what needs me today."
        tint={color}
        multiline
        accessibilityLabel="What the routine does"
        maxLength={5000}
      />
      <Text style={styles.label}>When</Text>
      <View style={styles.chips}>
        {SCHEDULES.map((s) => (
          <Chip
            key={s.value}
            label={s.label}
            tint={color}
            selected={!custom && schedule === s.value}
            onPress={() => {
              setCustom(false);
              setSchedule(s.value);
            }}
          />
        ))}
        <Chip
          label="Other…"
          tint={color}
          selected={custom}
          onPress={() => {
            setCustom(true);
            setSchedule('');
          }}
        />
      </View>
      {custom ? (
        <>
          <Field
            value={schedule}
            onChangeText={setSchedule}
            placeholder="every 2h · 30m · 0 7 * * 6 · 2026-11-10T09:00"
            tint={color}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Custom schedule"
          />
          <Text style={styles.hint}>A cron line (minute hour day month weekday), "every 2h", "30m" (once, in 30 minutes) or a date and time. Times are b-lab's (New York).</Text>
        </>
      ) : null}
      <NotifySwitch value={notifyMe} disabled={!notify.ready || busy} spacing={16} onChange={setNotifyMe} />
      {error ? <FormError text={error} /> : null}
      <View style={styles.formButtons}>
        <Button kind="secondary" bot={bot} label="Cancel" onPress={() => onDone(false)} style={{ flex: 1 }} />
        <Button bot={bot} label="Add routine" busy={busy} disabled={!ready} onPress={save} style={{ flex: 1 }} />
      </View>
    </View>
  );
}

function RoutineCard({ routine: r, bot, api, color, notify, onChanged }: { routine: Routine; bot: string; api: Routines; color: string; notify: NotifyMarks; onChanged: () => void }) {
  const { colors, mix } = useTheme();
  const styles = useStyles();
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
      { text: 'Delete', style: 'destructive', onPress: () => void act('Delete', async () => {
          await api.remove(r.id);
          if (notify.isOn(r.id)) await notify.set(r.id, false).catch(() => undefined); // a stale mark is harmless, just tidy
        }) },
    ]);

  const flipNotify = async (on: boolean) => {
    setBusy('Notify me');
    try {
      await notify.set(r.id, on);
    } catch (e) {
      Alert.alert("Couldn't save Notify me", (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const status = paused ? 'Paused' : r.nextRunAt ? `Next: ${whenLabel(r.nextRunAt)}` : r.state;
  const last = r.lastRunAt ? `Last: ${whenLabel(r.lastRunAt)}${r.lastStatus && r.lastStatus !== 'ok' ? ` · ${r.lastStatus}` : ''}` : 'Not run yet';
  return (
    <View style={[styles.card, paused && { opacity: 0.75 }]}>
      <Pressable onPress={() => setOpen(!open)} accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`${r.name}, ${scheduleLabel(r.schedule)}, ${status}`}>
        <View style={styles.row}>
          <Text style={[styles.name, { flex: 1 }]} numberOfLines={1}>
            {r.name}
          </Text>
          <Icon name={open ? 'chevron-down' : 'chevron'} size={14} color={colors.dim} stroke={2.4} />
        </View>
        <Text style={styles.sub}>
          {scheduleLabel(r.schedule)} · {status}{notify.isOn(r.id) ? ' · Notify me' : ''}
        </Text>
        <Text style={[styles.sub, r.lastStatus === 'error' && { color: colors.bad }]}>{last}</Text>
      </Pressable>
      {open ? (
        <View style={{ gap: 10, marginTop: 4 }}>
          <Text style={styles.prompt}>{r.prompt}</Text>
          {r.lastError ? <FormError text={r.lastError} /> : null}
          <NotifySwitch value={notify.isOn(r.id)} disabled={!notify.ready || busy !== null} spacing={10} onChange={(on) => void flipNotify(on)} />
          <View style={[styles.result, { borderColor: mix(color, 0.4) }]}>
            <Text style={styles.label}>{result ? `Last result · ${whenLabel(new Date(result.at * 1000).toISOString())}` : 'Last result'}</Text>
            {result === undefined ? <Loading style={{ marginTop: 8 }} /> : result?.text ? <MessageMenu text={result.text} bot={bot}><Markdown text={result.text} accent={color} /></MessageMenu> : <Text style={styles.sub}>Nothing yet.</Text>}
          </View>
          <View style={styles.row}>
            <SmallButton label="Run now" bot={bot} tone="tint" busy={busy === 'Run now'} onPress={() => void act('Run now', () => api.runNow(r.id)).then(() => setResult(undefined))} />
            <SmallButton label={paused ? 'Turn on' : 'Pause'} tone="neutral" busy={busy === 'Pause' || busy === 'Turn on'} onPress={() => void act(paused ? 'Turn on' : 'Pause', () => (paused ? api.resume(r.id) : api.pause(r.id)))} />
            <SmallButton label="Delete" tone="danger" busy={busy === 'Delete'} onPress={remove} />
          </View>
        </View>
      ) : null}
    </View>
  );
}


const useStyles = makeStyles(({ colors }) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: { padding: 16, gap: 12 },
  intro: { color: colors.dim, fontSize: 14, lineHeight: 20 },
  card: { padding: 16, gap: 6 },
  name: { color: colors.text, fontSize: 16, fontWeight: '600' },
  toggle: { color: colors.dim, fontSize: 14 },
  sub: { color: colors.dim, fontSize: 13 },
  prompt: { color: colors.text, fontSize: 14, lineHeight: 20 },
  result: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 6 },
  label: { color: colors.dim, fontSize: 13 },
  hint: { color: colors.dim, fontSize: 12, lineHeight: 17 },
  notifyRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52 },
  notifyLabel: { color: colors.text, fontSize: 17, lineHeight: 22, fontWeight: '600' },
  notifyHint: { color: colors.dim, fontSize: 13, lineHeight: 18 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  formButtons: { flexDirection: 'row', gap: 10 },
}));

// Pieces of the Usage screen (card 25): progress bars, provider cards, the 7/30/90 control, bot rows, the
// daily chart and the header gauge. Colors follow the thresholds in lib/usage.ts; layout waits for the comps
// (design/usage-screen, docs/design/REVIEW.md Fix 12) and is adjusted when they merge.
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { BotAvatar } from '@/components/BotSprite';
import { isDesktop } from '@/components/desktop';
import { useBotName } from '@/components/useBotName';
import { colors } from '@/lib/theme';
import {
  DAY_CHOICES,
  formatCost,
  formatCredits,
  formatTokens,
  gaugeState,
  levelFor,
  resetLine,
  type BotUsage,
  type Days,
  type GaugeState,
  type Level,
  type ProviderUsage,
  type UsageAccount,
  type UsageSnapshot,
  type UsageWindow,
} from '@/lib/usage';

export const levelColor: Record<Level, string> = { ok: colors.ok, warn: colors.warn, bad: colors.bad };

/** "today 5:30 PM" / "Fri 10:00 AM", in the device's own time zone. */
export function localReset(resetsAt: number | null, now: number): string | null {
  if (resetsAt === null) return null;
  const d = new Date(resetsAt);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const sameDay = d.toDateString() === new Date(now).toDateString();
  return sameDay ? time : `${d.toLocaleDateString([], { weekday: 'short' })} ${time}`;
}

export function ProgressBar({ percent, level }: { percent: number; level: Level }) {
  return (
    <View style={styles.track} accessibilityRole="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}>
      <View style={[styles.fill, { width: `${Math.max(percent, percent > 0 ? 2 : 0)}%`, backgroundColor: levelColor[level] }]} />
    </View>
  );
}

export function WindowRow({ w, now }: { w: UsageWindow; now: number }) {
  const level = levelFor(w.percent);
  const at = localReset(w.resetsAt, now);
  return (
    <View style={styles.window} accessible accessibilityLabel={`${w.label}, ${Math.round(w.percent)} percent used. ${resetLine(w.resetsAt, now)}`}>
      <View style={styles.windowTop}>
        <Text style={styles.windowLabel} numberOfLines={1} maxFontSizeMultiplier={1.4}>
          {w.label}
        </Text>
        <Text style={[styles.percent, { color: level === 'ok' ? colors.text : levelColor[level] }]} maxFontSizeMultiplier={1.4}>
          {Math.round(w.percent)}% used
        </Text>
      </View>
      <ProgressBar percent={w.percent} level={level} />
      <Text style={styles.reset} maxFontSizeMultiplier={1.4}>
        {resetLine(w.resetsAt, now)}
        {at ? ` · ${at}` : ''}
      </Text>
    </View>
  );
}

function AccountBlock({ a, now }: { a: UsageAccount; now: number }) {
  return (
    <View style={styles.account}>
      <Text style={styles.accountLabel} numberOfLines={1} maxFontSizeMultiplier={1.4}>
        {a.label}
      </Text>
      {a.windows.length ? (
        a.windows.map((w, i) => <WindowRow key={`${w.label}-${i}`} w={w} now={now} />)
      ) : (
        <Text style={styles.note} maxFontSizeMultiplier={1.4}>
          {a.state === 'limited' ? `Limit reached. ${resetLine(a.resetsAt, now)}` : a.state === 'unavailable' ? 'Not signed in' : 'No usage data from Hermes'}
        </Text>
      )}
    </View>
  );
}

/** One card per provider. */
export function ProviderCard({ p, now }: { p: ProviderUsage; now: number }) {
  return (
    <View style={styles.card} accessibilityLabel={`${p.name} usage`}>
      <Text style={styles.cardTitle} accessibilityRole="header" maxFontSizeMultiplier={1.4}>
        {p.name}
      </Text>
      {p.kind === 'windows' ? p.windows.map((w, i) => <WindowRow key={`${w.label}-${i}`} w={w} now={now} />) : null}
      {p.kind === 'accounts' ? p.accounts.map((a) => <AccountBlock key={a.id} a={a} now={now} />) : null}
      {p.credits ? (
        <View style={styles.windowTop}>
          <Text style={styles.windowLabel} maxFontSizeMultiplier={1.4}>
            Credits
          </Text>
          <Text style={styles.percent} maxFontSizeMultiplier={1.4}>
            {formatCredits(p.credits)}
          </Text>
        </View>
      ) : null}
      {p.kind === 'none' ? (
        <Text style={styles.note} maxFontSizeMultiplier={1.4}>
          {p.local ? 'Local model: tokens only (see Bots below)' : 'No usage data from Hermes'}
        </Text>
      ) : null}
    </View>
  );
}

export function Segmented({ value, onChange }: { value: Days; onChange: (d: Days) => void }) {
  return (
    <View style={styles.segmented} accessibilityRole="tablist">
      {DAY_CHOICES.map((d) => (
        <Pressable
          key={d}
          onPress={() => onChange(d)}
          accessibilityRole="tab"
          accessibilityState={{ selected: d === value }}
          accessibilityLabel={`${d} days`}
          style={[styles.segment, d === value && styles.segmentOn]}
        >
          <Text style={[styles.segmentText, d === value && { color: colors.text }]} maxFontSizeMultiplier={1.4}>
            {d} days
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue} numberOfLines={1} maxFontSizeMultiplier={1.4}>
        {value}
      </Text>
      <Text style={styles.statLabel} numberOfLines={1} maxFontSizeMultiplier={1.4}>
        {label}
      </Text>
    </View>
  );
}

export function BotUsageRow({ u, onPress }: { u: BotUsage; onPress: () => void }) {
  const name = useBotName(u.bot);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${formatTokens(u.input)} in, ${formatTokens(u.output)} out, ${u.apiCalls} API calls, ${formatCost(u.cost)} estimated${u.topModel ? `, top model ${u.topModel}` : ''}`}
      style={({ pressed }) => [styles.botRow, pressed && { backgroundColor: colors.raised }]}
    >
      <BotAvatar bot={u.bot} size={36} />
      <View style={styles.botBody}>
        <View style={styles.botTop}>
          <Text style={styles.botName} numberOfLines={1} maxFontSizeMultiplier={1.4}>
            {name}
          </Text>
          <Text style={styles.cost} maxFontSizeMultiplier={1.4}>
            {formatCost(u.cost)}
          </Text>
        </View>
        <Text style={styles.botLine} numberOfLines={1} maxFontSizeMultiplier={1.4}>
          {formatTokens(u.input)} in · {formatTokens(u.output)} out · {u.apiCalls} calls
        </Text>
        <Text style={styles.botLine} numberOfLines={1} maxFontSizeMultiplier={1.4}>
          {u.topModel ?? 'No activity'}
        </Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

/** Daily tokens (input + output) as bars; the tallest day fills the chart. */
export function DailyChart({ u }: { u: BotUsage }) {
  const max = Math.max(1, ...u.daily.map((d) => d.input + d.output));
  if (!u.daily.length) {
    return (
      <Text style={styles.note} maxFontSizeMultiplier={1.4}>
        No activity in the last {u.days} days.
      </Text>
    );
  }
  return (
    <View accessible accessibilityLabel={`Daily tokens, ${u.daily.length} days with activity, busiest ${formatTokens(max)}`}>
      <View style={styles.chart}>
        {u.daily.map((d) => {
          const total = d.input + d.output;
          return (
            <View key={d.day} style={styles.barSlot}>
              <View style={[styles.bar, { height: `${Math.max((total / max) * 100, total > 0 ? 3 : 0)}%` }]} />
            </View>
          );
        })}
      </View>
      <View style={styles.chartAxis}>
        <Text style={styles.axis} maxFontSizeMultiplier={1.4}>
          {u.daily[0].day.slice(5)}
        </Text>
        <Text style={styles.axis} maxFontSizeMultiplier={1.4}>
          {formatTokens(max)} max
        </Text>
        <Text style={styles.axis} maxFontSizeMultiplier={1.4}>
          {u.daily[u.daily.length - 1].day.slice(5)}
        </Text>
      </View>
    </View>
  );
}

const GAUGE = isDesktop ? 22 : 26;

/** The header gauge: a ring with the Claude session % in it. Grey with no data, amber 70 to 90, red over 90. */
export function UsageGaugeView({ state, onPress, size = GAUGE }: { state: GaugeState; onPress: () => void; size?: number }) {
  const hit = isDesktop ? 32 : 44;
  const stroke = 3;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const color = state.kind === 'value' ? levelColor[state.level] : colors.faint;
  const frac = state.kind === 'value' ? state.percent / 100 : 0;
  const label = state.kind === 'value' ? `Claude session ${Math.round(state.percent)} percent used. Open usage` : 'Usage. No Claude session data yet';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => [
        { width: hit, height: hit, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
        (hovered || pressed) && isDesktop && { backgroundColor: colors.raised },
        pressed && !isDesktop && { opacity: 0.6 },
      ]}
    >
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size}>
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.border} strokeWidth={stroke} fill="none" />
          {frac > 0 ? (
            <Circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              stroke={color}
              strokeWidth={stroke}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={`${circ * frac} ${circ}`}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
          ) : null}
        </Svg>
        <View style={styles.gaugeText} pointerEvents="none">
          <Text style={[styles.gaugePct, { color }]} maxFontSizeMultiplier={1}>
            {state.kind === 'value' ? Math.round(state.percent) : '–'}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

export function UsageGauge({ snapshot, onPress }: { snapshot: UsageSnapshot | null; onPress: () => void }) {
  return <UsageGaugeView state={gaugeState(snapshot?.providers ?? null)} onPress={onPress} />;
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 16, gap: 14 },
  cardTitle: { color: colors.text, fontSize: 17, lineHeight: 22, fontWeight: '600' },
  window: { gap: 6 },
  windowTop: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  windowLabel: { flexShrink: 1, color: colors.text, fontSize: 15, lineHeight: 20 },
  percent: { color: colors.text, fontSize: 15, lineHeight: 20, fontWeight: '600' },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.border, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
  reset: { color: colors.dim, fontSize: 13, lineHeight: 18 },
  note: { color: colors.dim, fontSize: 14, lineHeight: 20 },
  account: { gap: 10 },
  accountLabel: { color: colors.dim, fontSize: 13, lineHeight: 18, textTransform: 'uppercase', letterSpacing: 0.3 },
  segmented: { flexDirection: 'row', backgroundColor: colors.card, borderRadius: 10, padding: 3 },
  segment: { flex: 1, minHeight: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  segmentOn: { backgroundColor: colors.raised },
  segmentText: { color: colors.dim, fontSize: 14, fontWeight: '600' },
  stat: { flex: 1, minWidth: 0, gap: 2 },
  statValue: { color: colors.text, fontSize: 20, lineHeight: 26, fontWeight: '600' },
  statLabel: { color: colors.dim, fontSize: 13, lineHeight: 18 },
  botRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 72, paddingHorizontal: 16, paddingVertical: 10 },
  botBody: { flex: 1, minWidth: 0, gap: 1 },
  botTop: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  botName: { flexShrink: 1, color: colors.text, fontSize: 17, lineHeight: 22 },
  cost: { color: colors.text, fontSize: 15, lineHeight: 20, fontWeight: '600' },
  botLine: { color: colors.dim, fontSize: 13, lineHeight: 18 },
  chevron: { color: colors.disclosure, fontSize: 17 },
  chart: { height: 120, flexDirection: 'row', alignItems: 'flex-end', gap: 3 },
  barSlot: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  bar: { width: '100%', backgroundColor: colors.accent, borderTopLeftRadius: 3, borderTopRightRadius: 3 },
  chartAxis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  axis: { color: colors.faint, fontSize: 12, lineHeight: 16 },
  gaugeText: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  gaugePct: { fontSize: 9, fontWeight: '700' },
});

// Pieces of the Usage screen (card 25, docs/design/REVIEW.md "Fix 12", comps in docs/design/comps/25-*).
// Thresholds, number formats and copy are the tested rules in lib/usage.ts.
import { useState } from 'react';
import { ActivityIndicator, PixelRatio, Pressable, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { Icon } from '@/components/AppIcons';
import { Button } from '@/components/Buttons';
import { BotAvatar } from '@/components/BotSprite';
import { isDesktop } from '@/components/desktop';
import { useBotName } from '@/components/useBotName';
import {
  DAY_CHOICES,
  axisLabels,
  calloutText,
  clockLabel,
  countdown,
  daySeries,
  displayName,
  formatCost,
  formatCount,
  formatCredits,
  formatTokens,
  gaugeState,
  hasActivity,
  levelFor,
  niceTop,
  providerOfModel,
  resetLine,
  shareOf,
  spokenCallout,
  spokenTokens,
  stepPicked,
  stateWord,
  subtitle,
  totalsOf,
  type BotUsage,
  type Days,
  type GaugeState,
  type Level,
  type ModelUsage,
  type ProviderUsage,
  type UsageAccount,
  type UsageSnapshot,
  type UsageWindow,
} from '@/lib/usage';
import { makeStyles, useTheme } from '@/components/theme';
import { maxScale, scaled } from '@/lib/type';
import type { Colors } from '@/lib/themes';

export const levelColor = (colors: Colors, level: Level): string => ({ ok: colors.ok, warn: colors.warn, bad: colors.bad })[level];
const TABULAR = { fontVariant: ['tabular-nums' as const] };

// ---- subscriptions ----

/** Bar 8 tall, radius 4, track #2A2D33; the fill is max(8px, pct%) when pct > 0. */
export function ProgressBar({ percent, level }: { percent: number; level: Level }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const shown = Math.round(percent);
  return (
    <View style={styles.track} aria-hidden>
      {shown > 0 ? <View style={[styles.fill, { width: `${shown}%`, minWidth: 8, backgroundColor: levelColor(colors, level) }]} /> : null}
    </View>
  );
}

function spokenCountdown(at: number, now: number): string {
  const c = countdown(at, now) ?? '';
  return c
    .replace(/(\d+)d/, (_, n) => `${n} ${n === '1' ? 'day' : 'days'}`)
    .replace(/(\d+)h/, (_, n) => `${n} ${n === '1' ? 'hour' : 'hours'}`)
    .replace(/(\d+)m/, (_, n) => `${n} ${n === '1' ? 'minute' : 'minutes'}`)
    .replace('<1 minutes', 'under a minute')
    .replace('<1m', 'under a minute');
}

function spoken(w: UsageWindow, now: number): string {
  const word = stateWord(w.percent);
  const reset = w.resetsAt === null ? 'reset time not given' : countdown(w.resetsAt, now) === null ? 'reset due' : `resets in ${spokenCountdown(w.resetsAt, now)} at ${clockLabel(w.resetsAt, now)}`;
  return `${w.label}, ${Math.round(w.percent)} percent used, ${reset}${word ? `. ${word}` : ''}`;
}

export function WindowRow({ w, now }: { w: UsageWindow; now: number }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const level = levelFor(w.percent);
  const word = stateWord(w.percent);
  const c = level === 'ok' ? colors.text : levelColor(colors, level);
  const clock = w.resetsAt !== null && countdown(w.resetsAt, now) !== null ? ` · ${clockLabel(w.resetsAt, now)}` : '';
  return (
    <View style={styles.window} accessible accessibilityLabel={spoken(w, now)}>
      <View style={styles.line}>
        <Text style={[styles.windowLabel, { flexShrink: 1 }]} numberOfLines={1}>
          {w.label}
        </Text>
        <Text style={[styles.windowPercent, TABULAR, { color: c }]}>
          {Math.round(w.percent)}%
        </Text>
      </View>
      <ProgressBar percent={w.percent} level={level} />
      <View style={styles.line}>
        <Text style={[styles.reset, { flexShrink: 1 }]}>
          {resetLine(w.resetsAt, now)}
          {clock}
        </Text>
        {word ? (
          <Text style={[styles.word, { color: levelColor(colors, level) }]}>
            {word}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** The generic chip glyph in the provider disc (v1 has no provider logos). */
function ChipGlyph() {
  const { colors } = useTheme();
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={colors.dim} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <Rect x={6} y={6} width={12} height={12} rx={2} />
      <Rect x={10} y={10} width={4} height={4} rx={0.5} />
      <Path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" />
    </Svg>
  );
}

function ProviderHead({ p }: { p: ProviderUsage }) {
  const styles = useStyles();
  const sub = subtitle(p);
  return (
    <View style={styles.head} accessibilityRole="header">
      <View style={styles.disc}>
        <ChipGlyph />
      </View>
      <View style={styles.headText}>
        <Text style={styles.providerName} numberOfLines={1}>
          {displayName(p)}
        </Text>
        {sub ? (
          <Text style={styles.providerSub} numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const Sep = () => {
const styles = useStyles();
return <View style={styles.sep} />;
};

function AccountRows({ a, now }: { a: UsageAccount; now: number }) {
  const styles = useStyles();
  return (
    <>
      <Sep />
      <View style={styles.accountHead}>
        <Text style={styles.accountLabel} numberOfLines={1}>
          {a.label}
        </Text>
      </View>
      {a.windows.length ? (
        a.windows.map((w, i) => (
          <View key={`${w.label}-${i}`}>
            {i > 0 ? <Sep /> : null}
            <WindowRow w={w} now={now} />
          </View>
        ))
      ) : (
        <View style={styles.plainRow}>
          <Text style={styles.noData}>
            {a.state === 'limited' ? `Limit reached. ${resetLine(a.resetsAt, now)}` : a.state === 'unavailable' ? 'Not signed in' : 'No usage data from Hermes'}
          </Text>
        </View>
      )}
    </>
  );
}

/** One grouped card per provider. `localTokens`/`days` feed the local-model row; Hermes sends no plan or detail, so none shows. */
export function ProviderCard({ p, now, localTokens, days }: { p: ProviderUsage; now: number; localTokens: number | null; days: Days }) {
  const styles = useStyles();
  return (
    <View style={styles.card} accessibilityLabel={`${displayName(p)} usage`}>
      <ProviderHead p={p} />
      {p.kind === 'windows'
        ? p.windows.map((w, i) => (
            <View key={`${w.label}-${i}`}>
              <Sep />
              <WindowRow w={w} now={now} />
            </View>
          ))
        : null}
      {p.kind === 'accounts' ? p.accounts.map((a) => <AccountRows key={a.id} a={a} now={now} />) : null}
      {p.credits ? (
        <>
          <Sep />
          <View style={styles.window}>
            <View style={styles.line}>
              <Text style={styles.windowLabel}>
                Credits
              </Text>
              <Text style={[styles.windowPercent, TABULAR]}>
                {formatCredits(p.credits)}
              </Text>
            </View>
            <Text style={styles.reset}>
              Balance from {p.name}
            </Text>
          </View>
        </>
      ) : null}
      {p.local ? (
        <>
          <Sep />
          <View style={[styles.plainRow, styles.line]}>
            <Text style={styles.windowLabel}>
              Tokens · {days} days
            </Text>
            <Text style={[styles.windowPercent, TABULAR]}>
              {localTokens === null ? '…' : formatTokens(localTokens)}
            </Text>
          </View>
        </>
      ) : null}
      {p.kind === 'none' && !p.local && !p.credits ? (
        <>
          <Sep />
          <View style={styles.plainRow}>
            <Text style={styles.noData}>
              No usage data from Hermes
            </Text>
          </View>
        </>
      ) : null}
    </View>
  );
}

export function SkeletonCard() {
  const { colors } = useTheme();
  const styles = useStyles();
  const block = (w: number, h: number) => <View style={[styles.skel, { width: w, height: h }]} />;
  return (
    <View style={styles.card} accessibilityLabel="Loading subscriptions">
      <View style={styles.head}>
        <View style={styles.disc} />
        <View style={{ gap: 6 }}>
          {block(90, 14)}
          {block(140, 11)}
        </View>
      </View>
      <Sep />
      <View style={styles.window}>
        <View style={styles.line}>
          {block(120, 14)}
          {block(34, 14)}
        </View>
        <View style={[styles.track, { backgroundColor: colors.raised }]} />
        {block(180, 11)}
      </View>
    </View>
  );
}

export function SkeletonBotRows() {
  const styles = useStyles();
  return (
    <View style={styles.group} accessibilityLabel="Loading bots">
      {[0, 1, 2].map((i) => (
        <View key={i}>
          {i > 0 ? <View style={[styles.sep, { marginLeft: 68 }]} /> : null}
          <View style={styles.botRow}>
            <View style={[styles.skel, { width: 40, height: 40, borderRadius: 20 }]} />
            <View style={{ gap: 6 }}>
              <View style={[styles.skel, { width: 110, height: 14 }]} />
              <View style={[styles.skel, { width: 200, height: 11 }]} />
            </View>
          </View>
        </View>
      ))}
    </View>
  );
}

// ---- states ----

/** "Couldn't update. Showing data from 9:38 AM." above the cards, old numbers kept. */
export function FailBanner({ since, onRetry }: { since: string; onRetry: () => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.banner} accessibilityRole="alert">
      <Icon name="warning" size={18} color={colors.bad} />
      <Text style={styles.bannerText}>
        Couldn't update. Showing data from {since}.
      </Text>
      <Pressable onPress={onRetry} accessibilityRole="button" accessibilityLabel="Retry" hitSlop={7} style={styles.bannerButton}>
        <Text style={styles.bannerButtonText}>
          Retry
        </Text>
      </Pressable>
    </View>
  );
}

export function Unreachable({ onRetry }: { onRetry: () => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.unreachable}>
      <Icon name="warning" size={36} color={colors.dim} />
      <Text style={styles.unreachableTitle}>
        Can't reach b-lab
      </Text>
      <Text style={styles.unreachableText}>
        Usage comes from Hermes. Check the connection and try again.
      </Text>
      <Button label="Try again" onPress={onRetry} style={{ marginTop: 12 }} />
    </View>
  );
}

/** The Updated line: spinner + Updating…, Couldn't update · Retry, or the age. */
export function UpdatedLine({ text, loading, failed, onRetry }: { text: string | null; loading: boolean; failed: boolean; onRetry: () => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  if (loading)
    return (
      <View style={styles.updated}>
        <ActivityIndicator size="small" color={colors.dim} style={{ transform: [{ scale: 0.6 }], width: 12, height: 12 }} />
        <Text style={styles.updatedText}>
          Updating…
        </Text>
      </View>
    );
  if (failed)
    return (
      <View style={styles.updated}>
        <Text style={styles.updatedText}>
          Couldn't update ·
        </Text>
        <Pressable onPress={onRetry} accessibilityRole="button" accessibilityLabel="Retry" hitSlop={10}>
          <Text style={[styles.updatedText, { color: colors.accent }]}>
            Retry
          </Text>
        </Pressable>
      </View>
    );
  return (
    <View style={styles.updated}>
      <Text style={styles.updatedText}>
        {text ?? ''}
      </Text>
    </View>
  );
}

// ---- bots ----

/** 7 / 30 / 90 days. 36 tall, radius 10, padding 2; selected fill is mix(color, .30); each segment is a 44 tall target. */
export function Segmented({ value, onChange, color: given }: { value: Days; onChange: (d: Days) => void; color?: string }) {
  const { colors, mix } = useTheme();
  const styles = useStyles();
  const color = given ?? colors.accent;
  return (
    <View style={styles.segmented} accessibilityRole="tablist">
      {DAY_CHOICES.map((d) => (
        <Pressable
          key={d}
          onPress={() => onChange(d)}
          hitSlop={{ top: 4, bottom: 4 }}
          accessibilityRole="tab"
          accessibilityState={{ selected: d === value }}
          accessibilityLabel={`${d} days`}
          style={[styles.segment, d === value && { backgroundColor: mix(color, 0.3) }]}
        >
          <Text style={[styles.segmentText, d === value ? { color: colors.text, fontWeight: '600' } : { fontWeight: '500' }]} maxFontSizeMultiplier={maxScale.chrome}>
            {d} days
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function Column3({ label, value }: { label: string; value: string }) {
  const styles = useStyles();
  return (
    <View style={styles.col}>
      <Text style={[styles.colValue, TABULAR]} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.colLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** Tokens, API calls, Est. cost across every bot. */
export function TotalsCard({ bots }: { bots: BotUsage[] }) {
  const styles = useStyles();
  const t = totalsOf(bots);
  return (
    <View style={styles.totals} accessible accessibilityLabel={`${formatTokens(t.tokens)} tokens, ${formatCount(t.apiCalls)} API calls, ${formatCost(t.cost)} estimated cost`}>
      <Column3 label="Tokens" value={formatTokens(t.tokens)} />
      <Column3 label="API calls" value={formatCount(t.apiCalls)} />
      <Column3 label="Est. cost" value={formatCost(t.cost)} />
    </View>
  );
}

export function BotUsageRow({ u, hidden, providers, onPress }: { u: BotUsage; hidden: boolean; providers: ProviderUsage[]; onPress: () => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const name = useBotName(u.bot);
  const active = hasActivity(u);
  const top = u.topModel ? [u.topModel, providerOfModel(u.topModel, providers)].filter(Boolean).join(' · ') : null;
  const cost = active ? formatCost(u.cost) : '—';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={
        active
          ? `${name}${hidden ? ', hidden' : ''}, ${spokenTokens(u.input)} tokens in, ${spokenTokens(u.output)} out, ${formatCount(u.apiCalls)} calls, ${formatCost(u.cost)} estimated`
          : `${name}${hidden ? ', hidden' : ''}, no activity in ${u.days} days`
      }
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [styles.botRow, hovered && isDesktop && { backgroundColor: colors.hover }, pressed && { backgroundColor: colors.raised }]}
    >
      <BotAvatar bot={u.bot} size={isDesktop ? 36 : 40} mood={active ? undefined : 'sleeping'} />
      <View style={styles.botBody}>
        <View style={styles.line}>
          <Text style={[styles.botName, !active && { color: colors.dim }]} numberOfLines={1}>
            {name}
            {hidden ? <Text style={styles.hiddenTag}>  Hidden</Text> : null}
          </Text>
          <Text style={[styles.botCost, TABULAR, !active && { color: colors.dim }]}>
            {cost}
          </Text>
        </View>
        {active ? (
          <>
            <Text style={[styles.botLine, TABULAR]} numberOfLines={1}>
              {formatTokens(u.input)} in · {formatTokens(u.output)} out · {formatCount(u.apiCalls)} calls
            </Text>
            {top ? (
              <Text style={styles.botLine} numberOfLines={1}>
                {top}
              </Text>
            ) : null}
          </>
        ) : (
          <Text style={styles.botLine}>
            No activity in {u.days} days
          </Text>
        )}
      </View>
      <Icon name="chevron" size={16} color={colors.disclosure} stroke={2.4} />
    </Pressable>
  );
}

// ---- bot detail ----

export function Tile({ label, value }: { label: string; value: string }) {
  const styles = useStyles();
  return (
    <View style={styles.tile} accessible accessibilityLabel={`${label}, ${value}`}>
      <Text style={[styles.colValue, TABULAR]} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.colLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const PLOT = isDesktop ? 168 : 132;

/**
 * Tokens per day: a bar per day in the bot's color (input plus output), gridlines at 0, 50% and 100% of a nice top,
 * labels in a 36 gutter on the right. Tap or drag anywhere on the chart to pick a day; the rest dim to mix(c, .45).
 */
export function DailyChart({ u, color, now }: { u: BotUsage; color: string; now: number }) {
  const { colors, mix } = useTheme();
  const styles = useStyles();
  const [plotW, setPlotW] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const series = daySeries(u, now);
  const max = Math.max(0, ...series.map((p) => p.tokens));
  const top = niceTop(max);
  const gap = u.days === 7 ? 4 : u.days === 90 ? 1 : isDesktop ? 3 : 2;
  const pick = (e: GestureResponderEvent) => {
    if (!plotW) return;
    setPicked(Math.max(0, Math.min(series.length - 1, Math.floor((e.nativeEvent.locationX / plotW) * series.length))));
  };
  const busiest = series.reduce((b, p, i) => (p.tokens > series[b].tokens ? i : b), 0);
  const labels = axisLabels(series, u.days);
  const point = picked === null ? null : series[picked];
  const slot = plotW / Math.max(1, series.length);
  const fontScale = PixelRatio.getFontScale();
  return (
    <View
      style={styles.chartCard}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={`Tokens per day, busiest day ${calloutText(series[busiest].day, series[busiest].tokens).replace(' tokens', '')}`}
      accessibilityValue={{ text: point ? spokenCallout(point.day, point.tokens) : undefined }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        const delta = e.nativeEvent.actionName === 'increment' ? 1 : e.nativeEvent.actionName === 'decrement' ? -1 : 0;
        if (delta) setPicked((cur) => stepPicked(cur, delta, series.length));
      }}
    >
      <View style={{ height: 12 + scaled(18, fontScale) * (fontScale > 1.2 ? 2 : 1) }}>
        {point ? (
          <View style={[styles.callout, { left: Math.max(0, Math.min(plotW - 190, (picked ?? 0) * slot + slot / 2 - 95)) }]}>
            <Text style={styles.calloutText}>
              <Text style={{ fontWeight: '600', color: colors.text }}>{calloutText(point.day, point.tokens).split(' · ')[0]}</Text> · {formatTokens(point.tokens)} tokens
            </Text>
          </View>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row' }}>
        <View
          style={{ flex: 1, height: PLOT }}
          onLayout={(e) => setPlotW(e.nativeEvent.layout.width)}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderGrant={pick}
          onResponderMove={pick}
        >
          {[0, 0.5, 1].map((f) => (
            <View key={f} style={[styles.grid, { bottom: f * (PLOT - 1) }]} />
          ))}
          <View style={[styles.bars, { gap }]}>
            {series.map((p, i) => (
              <View key={p.day} style={styles.barSlot}>
                {p.tokens > 0 ? (
                  <View
                    style={{
                      width: '100%',
                      height: Math.max(2, (p.tokens / top) * PLOT),
                      backgroundColor: picked === null || picked === i ? color : mix(color, 0.45),
                      borderTopLeftRadius: 2,
                      borderTopRightRadius: 2,
                    }}
                  />
                ) : null}
              </View>
            ))}
          </View>
        </View>
        <View style={styles.gutter}>
          {[1, 0.5].map((f) => (
            <Text key={f} style={[styles.axis, TABULAR, { position: 'absolute', left: 6, bottom: f * (PLOT - 1) - 8 }]} maxFontSizeMultiplier={maxScale.chrome}>
              {formatTokens(top * f)}
            </Text>
          ))}
        </View>
      </View>
      <View style={[styles.axisRow, { marginRight: 36, height: scaled(16, fontScale, maxScale.chrome) }]}>
        {labels.map((l, k) => (
          <Text
            key={`${l.index}-${l.text}`}
            style={[styles.axis, { position: 'absolute', left: Math.max(0, Math.min(plotW - 40, l.index * slot + slot / 2 - 20)), width: 40, textAlign: 'center' }]}
            maxFontSizeMultiplier={maxScale.chrome}
          >
            {l.text}
          </Text>
        ))}
      </View>
    </View>
  );
}

export function EmptyChart({ days }: { days: number }) {
  const styles = useStyles();
  return (
    <View style={[styles.chartCard, { height: PLOT + 24, alignItems: 'center', justifyContent: 'center' }]}>
      <Text style={styles.noData}>
        No activity in the last {days} days
      </Text>
    </View>
  );
}

export function ModelRow({ m, u, providers, color }: { m: ModelUsage; u: BotUsage; providers: ProviderUsage[]; color: string }) {
  const styles = useStyles();
  const share = shareOf(m, u);
  const provider = providerOfModel(m.model, providers);
  return (
    <View style={styles.modelRow} accessible accessibilityLabel={`${m.model}${provider ? `, ${provider}` : ''}, ${spokenTokens(m.input)} tokens in, ${spokenTokens(m.output)} out, ${formatCount(m.apiCalls)} calls, ${share} percent, ${formatCost(m.cost)}`}>
      <View style={styles.line}>
        <Text style={[styles.botName, { fontWeight: '400' }]} numberOfLines={1}>
          {m.model}
        </Text>
        <Text style={[styles.windowPercent, TABULAR]}>
          {formatCost(m.cost)}
        </Text>
      </View>
      {provider ? (
        <Text style={styles.botLine}>
          {provider}
        </Text>
      ) : null}
      <View style={styles.share}>
        <View style={{ width: `${share}%`, minWidth: share > 0 ? 2 : 0, height: 4, borderRadius: 2, backgroundColor: color }} />
      </View>
      <Text style={[styles.botLine, TABULAR]}>
        {formatTokens(m.input)} in · {formatTokens(m.output)} out · {formatCount(m.apiCalls)} calls · {share}%
      </Text>
    </View>
  );
}

// ---- header gauge ----

/**
 * The header gauge (Fix 12): a pill 32 tall in a 44 target with a 20 ring and the highest used percent across every
 * provider window. Normal #1A1C20 / green, warning mix(#F2A65A,.14), red mix(#F06A6A,.18). Hidden with no data.
 */
export function GaugePill({ state, onPress, active = false }: { state: GaugeState; onPress: () => void; active?: boolean }) {
  const { colors, mix } = useTheme();
  const styles = useStyles();
  if (state.kind === 'none') return null;
  const c = levelColor(colors, state.level);
  const r = 8.5;
  const circ = 2 * Math.PI * r;
  const fill = state.level === 'ok' ? colors.card : mix(c, state.level === 'warn' ? 0.14 : 0.18);
  const pressedFill = state.level === 'ok' ? colors.raised : mix(c, state.level === 'warn' ? 0.18 : 0.22);
  const shown = Math.round(state.percent);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${state.provider}, ${state.label}, ${shown} percent used. Opens Usage.`}
      hitSlop={isDesktop ? 0 : { top: 6, bottom: 6, left: 4, right: 4 }}
      style={({ pressed }) => [styles.pill, { backgroundColor: pressed || (active && state.level === 'ok') ? pressedFill : fill }]}
      {...({ title: `${state.provider} · ${state.label} · ${shown}% used` } as object)}
    >
      <Svg width={20} height={20} viewBox="0 0 20 20">
        <Circle cx={10} cy={10} r={r} stroke={colors.border} strokeWidth={3} fill="none" />
        {shown > 0 ? <Circle cx={10} cy={10} r={r} stroke={c} strokeWidth={3} fill="none" strokeLinecap="round" strokeDasharray={`${circ * (shown / 100)} ${circ}`} transform="rotate(-90 10 10)" /> : null}
      </Svg>
      <Text style={[styles.pillText, TABULAR, { color: state.level === 'ok' ? colors.text : c, fontSize: isDesktop ? 13 : 15 }]} maxFontSizeMultiplier={maxScale.chrome}>
        {shown}%
      </Text>
    </Pressable>
  );
}

export function UsageGauge({ snapshot, onPress, active }: { snapshot: UsageSnapshot | null; onPress: () => void; active?: boolean }) {
  return <GaugePill state={gaugeState(snapshot?.providers ?? null)} onPress={onPress} active={active} />;
}

const useStyles = makeStyles(({ colors, mix }) => StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: 12, overflow: 'hidden' },
  group: { backgroundColor: colors.card, borderRadius: 12, overflow: 'hidden' },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 16 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingHorizontal: 16, paddingVertical: 8 },
  disc: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' },
  headText: { flex: 1, minWidth: 0 },
  providerName: { color: colors.text, fontSize: 17, lineHeight: 22, fontWeight: '600' },
  providerSub: { color: colors.dim, fontSize: 13, lineHeight: 18 },
  window: { paddingHorizontal: 16, paddingVertical: 12 },
  line: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  windowLabel: { color: colors.text, fontSize: 17, lineHeight: 22 },
  windowPercent: { color: colors.text, fontSize: 17, lineHeight: 22, fontWeight: '600' },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.track, overflow: 'hidden', marginTop: 8, marginBottom: 6 },
  fill: { height: 8, borderRadius: 4 },
  reset: { color: colors.dim, fontSize: 13, lineHeight: 18 },
  word: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  plainRow: { paddingHorizontal: 16, paddingVertical: 14 },
  noData: { color: colors.dim, fontSize: 15, lineHeight: 20 },
  accountHead: { paddingHorizontal: 16, paddingTop: 10 },
  accountLabel: { color: colors.dim, fontSize: 13, lineHeight: 18, textTransform: 'uppercase', letterSpacing: 0.3 },
  skel: { backgroundColor: colors.raised, borderRadius: 6 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.errorBg, borderColor: colors.errorLine, borderWidth: 0.5, borderRadius: 12, padding: 12 },
  bannerText: { flex: 1, color: colors.errorText, fontSize: 13, lineHeight: 18 },
  bannerButton: { minHeight: 30, borderRadius: 15, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: mix(colors.bad, 0.25) },
  bannerButtonText: { color: colors.errorText, fontSize: 13, fontWeight: '600' },
  unreachable: { alignItems: 'center', gap: 10, paddingVertical: 80, paddingHorizontal: 32 },
  unreachableTitle: { color: colors.text, fontSize: 17, lineHeight: 22, fontWeight: '600', marginTop: 6 },
  unreachableText: { color: colors.dim, fontSize: 15, lineHeight: 20, textAlign: 'center' },
  updated: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 18 },
  updatedText: { color: colors.dim, fontSize: 13, lineHeight: 18 },
  segmented: { flexDirection: 'row', minHeight: 36, backgroundColor: colors.card, borderRadius: 10, padding: 2 },
  segment: { flex: 1, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  segmentText: { color: colors.dim, fontSize: 15 },
  totals: { flexDirection: 'row', backgroundColor: colors.card, borderRadius: 12, padding: 12, gap: 8 },
  col: { flex: 1, minWidth: 0 },
  colValue: { color: colors.text, fontSize: isDesktop ? 17 : 20, lineHeight: isDesktop ? 22 : 24, fontWeight: '600' },
  colLabel: { color: colors.dim, fontSize: 13, lineHeight: 18 },
  tile: { flexGrow: 1, flexBasis: '30%', minHeight: isDesktop ? 64 : 68, backgroundColor: colors.card, borderRadius: 12, padding: 12, justifyContent: 'center' },
  botRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: isDesktop ? 60 : 64, paddingHorizontal: 16, paddingVertical: 10 },
  botBody: { flex: 1, minWidth: 0 },
  botName: { flexShrink: 1, color: colors.text, fontSize: 17, lineHeight: 22, fontWeight: '600' },
  hiddenTag: { color: colors.dim, fontSize: 13, fontWeight: '400' },
  botCost: { color: colors.text, fontSize: 17, lineHeight: 22 },
  botLine: { color: colors.dim, fontSize: 13, lineHeight: 18 },
  chevron: { color: colors.disclosure, fontSize: 17 },
  chartCard: { backgroundColor: colors.card, borderRadius: 12, paddingTop: 14, paddingRight: 12, paddingBottom: 10, paddingLeft: 16 },
  grid: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  bars: { flex: 1, flexDirection: 'row', alignItems: 'flex-end' },
  barSlot: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  gutter: { width: 36, height: PLOT },
  axis: { color: colors.dim, fontSize: 12, lineHeight: 16 },
  axisRow: { height: 16, marginTop: 8 },
  callout: { position: 'absolute', bottom: 6, width: 190, alignItems: 'center', backgroundColor: colors.raised, borderColor: colors.menuBorder, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4, boxShadow: '0 8px 24px rgba(0,0,0,0.45)' },
  calloutText: { color: colors.dim, fontSize: 13, lineHeight: 18 },
  modelRow: { paddingHorizontal: 16, paddingVertical: 12 },
  share: { height: 4, borderRadius: 2, backgroundColor: colors.border, marginTop: 6, marginBottom: 6, overflow: 'hidden' },
  pill: { minHeight: 32, borderRadius: 16, paddingLeft: 7, paddingRight: 10, flexDirection: 'row', alignItems: 'center', gap: 6 },
  pillText: { fontWeight: '600' },
}));

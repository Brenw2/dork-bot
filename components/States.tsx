// Empty, loading and error states: one of each (docs/design/UI-KIT.md K10). A screen never styles its own
// "nothing here", spinner or error line.
import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { Icon } from '@/components/AppIcons';
import { SmallButton } from '@/components/Buttons';
import { makeStyles, useTheme } from '@/components/theme';

/** Nothing to show yet: centered, body 15/22 dim, 24 side padding, 48 from the top. Real copy only. */
export function EmptyState({ body, title, icon, style }: { body?: string; title?: string; icon?: ReactNode; style?: StyleProp<ViewStyle> }) {
  const styles = useStyles();
  return (
    <View style={[styles.empty, style]}>
      {icon ? <View style={styles.disc}>{icon}</View> : null}
      {title ? (
        <Text style={styles.title} maxFontSizeMultiplier={1.4}>
          {title}
        </Text>
      ) : null}
      {body ? (
        <Text style={styles.body} maxFontSizeMultiplier={1.4}>
          {body}
        </Text>
      ) : null}
    </View>
  );
}

/** A list or page that is still loading: a centered spinner in the dim color, 48 from the top. */
export function Loading({ style }: { style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={[styles.loading, style]} accessibilityLabel="Loading" accessibilityRole="progressbar">
      <ActivityIndicator color={colors.dim} />
    </View>
  );
}

/**
 * A page-level error: warning icon, 13/18 text, and an optional small button ("Try again"). `card` draws it as a
 * rounded card inside a page body; without it it is a full-width band under a header.
 */
export function ErrorBanner({ text, action, card, style, testID }: { text: string; action?: { label: string; onPress: () => void; accessibilityLabel?: string }; card?: boolean; style?: StyleProp<ViewStyle>; testID?: string }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={[styles.banner, card ? styles.card : styles.band, style]} accessibilityLiveRegion="polite" testID={testID}>
      <Icon name="warning" size={18} color={colors.bad} />
      <Text style={styles.bannerText} maxFontSizeMultiplier={1.4}>
        {text}
      </Text>
      {action ? <SmallButton label={action.label} tone="danger" onPress={action.onPress} accessibilityLabel={action.accessibilityLabel} /> : null}
    </View>
  );
}

/** A form's problem, under the field: 13/18 in the error color. */
export function FormError({ text, style }: { text: string; style?: StyleProp<TextStyle> }) {
  const styles = useStyles();
  return (
    <Text style={[styles.formError, style]} accessibilityLiveRegion="polite" maxFontSizeMultiplier={1.4}>
      {text}
    </Text>
  );
}

const useStyles = makeStyles(({ colors, mix }) =>
  StyleSheet.create({
    empty: { alignItems: 'center', marginTop: 48, paddingHorizontal: 24, gap: 8 },
    disc: { width: 52, height: 52, borderRadius: 26, backgroundColor: mix(colors.accent, 0.18), alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
    title: { color: colors.text, fontSize: 17, lineHeight: 22, fontWeight: '600', textAlign: 'center' },
    body: { color: colors.dim, fontSize: 15, lineHeight: 22, textAlign: 'center' },
    loading: { alignItems: 'center', marginTop: 48 },
    banner: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.errorBg, borderColor: colors.errorLine },
    band: { paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
    card: { padding: 12, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth },
    bannerText: { flex: 1, color: colors.errorText, fontSize: 13, lineHeight: 18 },
    formError: { color: colors.bad, fontSize: 13, lineHeight: 18 },
  }),
);

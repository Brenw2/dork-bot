// Text fields (docs/design/UI-KIT.md K11): one Field and one SearchField. A screen never styles its own TextInput.
import { forwardRef, useState, type ComponentRef } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import { Icon } from '@/components/AppIcons';
import { makeStyles, useTheme } from '@/components/theme';

type FieldProps = TextInputProps & {
  /** The focus ring color: the bot's color inside its context, the accent elsewhere (not white). */
  tint?: string;
  /** The field sits on a card (a Group), so it takes the screen color instead of the card's. */
  onCard?: boolean;
  containerStyle?: StyleProp<ViewStyle>;
};

const NO_OUTLINE = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null;

/** 44 tall (multiline: at least 90), radius 12, card fill, hairline border, 17pt, placeholder `faint`, padding 14. */
export const Field = forwardRef<ComponentRef<typeof TextInput>, FieldProps>(function Field({ tint, onCard, containerStyle, style, multiline, onFocus, onBlur, ...rest }, ref) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [focus, setFocus] = useState(false);
  return (
    <TextInput
      ref={ref}
      multiline={multiline}
      placeholderTextColor={colors.faint}
      {...rest}
      onFocus={(e) => {
        setFocus(true);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocus(false);
        onBlur?.(e);
      }}
      style={[styles.field, onCard && { backgroundColor: colors.bg }, multiline && styles.multiline, focus && { borderColor: tint ?? colors.accent }, NO_OUTLINE, style]}
    />
  );
});

/** 36 tall, radius 10, card fill, search icon 16 `dim`, and a clear button once there is text. */
export function SearchField({ value, onChangeText, placeholder, accessibilityLabel, style, ...rest }: Omit<TextInputProps, 'value' | 'onChangeText'> & { value: string; onChangeText: (t: string) => void; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={[styles.search, style]}>
      <Icon name="search" size={16} color={colors.dim} />
      <TextInput
        style={[styles.searchInput, NO_OUTLINE]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.faint}
        accessibilityLabel={accessibilityLabel ?? placeholder}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        {...rest}
      />
      {value ? (
        <Pressable onPress={() => onChangeText('')} hitSlop={12} accessibilityRole="button" accessibilityLabel="Clear search" style={styles.clear}>
          <Icon name="close" size={14} color={colors.dim} stroke={2.4} />
        </Pressable>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles(({ colors }) =>
  StyleSheet.create({
    field: { minHeight: 44, borderRadius: 12, backgroundColor: colors.card, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, color: colors.text, fontSize: 17, paddingHorizontal: 14, paddingVertical: 10 },
    multiline: { minHeight: 90, textAlignVertical: 'top' },
    search: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 36, borderRadius: 10, paddingHorizontal: 10, backgroundColor: colors.card },
    searchInput: { flex: 1, color: colors.text, fontSize: 17, padding: 0 },
    clear: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.raised },
  }),
);

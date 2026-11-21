import { useEffect, useRef } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/AppIcons';
import { makeStyles, useTheme } from '@/components/theme';

/**
 * "Jump to latest" (Design's streaming spec): 32 tall, raised fill, hairline border, quiet. Centred over the
 * transcript, 12 above the message box. Fades in and out over 150 ms; hidden it can't be tapped or read out.
 */
export function JumpPill({ visible, onPress }: { visible: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(opacity, { toValue: visible ? 1 : 0, duration: 150, useNativeDriver: Platform.OS !== 'web' }).start();
  }, [visible, opacity]);
  return (
    <View pointerEvents="box-none" style={styles.wrap}>
      <Animated.View pointerEvents={visible ? 'auto' : 'none'} style={{ opacity }} accessibilityElementsHidden={!visible} importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}>
        <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="Jump to latest" hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }} style={styles.pill}>
          <Icon name="arrow-down" size={14} color={colors.text} stroke={3.43} />
          <Text style={styles.text}>Jump to latest</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 12, alignItems: 'center' },
  pill: { height: 32, paddingHorizontal: 14, borderRadius: 16, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.raised, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  text: { color: colors.text, fontSize: 13, fontWeight: '600' },
}));

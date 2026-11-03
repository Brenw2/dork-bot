import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Sprite } from '@/components/BotSprite';
import { BOT_COLORS, CHARACTER_IDS, MOODS, lookName, looksOf } from '@/lib/sprites';
import { colors } from '@/lib/theme';

// Design gallery (not linked from the app): every look of every character in every mood, and the
// app icon. Open /gallery in the web build to review the art.
const ROWS = CHARACTER_IDS.flatMap((id) => looksOf(id).map((_, v) => ({ id, v })));

export default function Gallery() {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.body}>
      <Text style={styles.h}>App icon</Text>
      <View style={styles.icons}>
        <Image source={require('../assets/icon.png')} style={styles.icon} />
        <Image source={require('../assets/icon.png')} style={styles.iconSmall} />
      </View>
      <Text style={styles.h}>Colors</Text>
      <View style={styles.icons}>
        {BOT_COLORS.map((c, i) => (
          <Sprite key={c} character="robot" variant={i % 3} color={c} mood="idle" size={44} seed={i} />
        ))}
      </View>
      <Text style={styles.h}>Characters and styles</Text>
      <ScrollView horizontal>
        <View>
          <View style={styles.row}>
            <Text style={[styles.label, styles.rowHead]} />
            {MOODS.map((m) => (
              <Text key={m} style={[styles.label, styles.cell]}>
                {m}
              </Text>
            ))}
          </View>
          {ROWS.map(({ id, v }, r) => (
            <View key={`${id}-${v}`} style={styles.row}>
              <Text style={[styles.label, styles.rowHead]}>
                {id}
                {'\n'}
                {lookName(id, v)}
              </Text>
              {MOODS.map((m) => (
                <View key={m} style={styles.cell}>
                  <Sprite character={id} variant={v} color={BOT_COLORS[r % BOT_COLORS.length]} mood={m} size={56} seed={r} />
                </View>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: { padding: 16, gap: 14 },
  h: { color: colors.text, fontSize: 18, fontWeight: '600' },
  icons: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' },
  icon: { width: 110, height: 110, borderRadius: 25 },
  iconSmall: { width: 40, height: 40, borderRadius: 9 },
  row: { flexDirection: 'row', alignItems: 'center' },
  rowHead: { width: 64, textAlign: 'left' },
  cell: { width: 70, alignItems: 'center', textAlign: 'center' },
  label: { color: colors.dim, fontSize: 12 },
});

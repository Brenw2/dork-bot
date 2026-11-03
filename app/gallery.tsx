import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Sprite } from '@/components/BotSprite';
import { CHARACTER_IDS, CHARACTERS, MOODS } from '@/lib/sprites';
import { colors } from '@/lib/theme';

// Design gallery (not linked from the app): every character in every mood, and the app icon
// options. Open /gallery in the web build to review the art.
const PALETTE = ['#8B7CF6', '#4CC38A', '#F2A65A', '#5AB0F2', '#F06A9A', '#C8D35A'];
const ICONS = [
  { name: 'A · Robot', src: require('../assets/icon-options/a-robot.png') },
  { name: 'B · The crew', src: require('../assets/icon-options/b-crew.png') },
  { name: 'C · Happy robot', src: require('../assets/icon-options/c-happy.png') },
];

export default function Gallery() {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.body}>
      <Text style={styles.h}>App icon</Text>
      <View style={styles.icons}>
        {ICONS.map((i) => (
          <View key={i.name} style={styles.iconCell}>
            <Image source={i.src} style={styles.icon} />
            <Image source={i.src} style={styles.iconSmall} />
            <Text style={styles.label}>{i.name}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.h}>Characters</Text>
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
          {CHARACTER_IDS.map((id, r) => (
            <View key={id} style={styles.row}>
              <Text style={[styles.label, styles.rowHead]}>{CHARACTERS[id].name}</Text>
              {MOODS.map((m) => (
                <View key={m} style={styles.cell}>
                  <Sprite character={id} color={PALETTE[r % PALETTE.length]} mood={m} size={56} seed={r} />
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
  icons: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  iconCell: { alignItems: 'center', gap: 6 },
  icon: { width: 110, height: 110, borderRadius: 25 },
  iconSmall: { width: 40, height: 40, borderRadius: 9 },
  row: { flexDirection: 'row', alignItems: 'center' },
  rowHead: { width: 56, textAlign: 'left' },
  cell: { width: 70, alignItems: 'center', textAlign: 'center' },
  label: { color: colors.dim, fontSize: 12 },
});

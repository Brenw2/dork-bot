import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Alert } from '@/components/alert';
import { Column } from '@/components/Column';
import { isDesktop } from '@/components/desktop';
import { MemberDisc, MemberStack } from '@/components/RoomAvatar';
import { newId, roomLink } from '@/components/roomsClient';
import { listBots, type SavedBot } from '@/lib/bots';
import { nameOf } from '@/lib/names';
import { createProblem, MAX_MEMBERS, MIN_MEMBERS } from '@/lib/rooms';
import { colors } from '@/lib/theme';

/**
 * New group chat (comps g2): a name plus 2 to 6 of this phone's bots. The room is made on Hermes (groups.create); the
 * picture stays a member stack because Hermes rooms have no picture field. Phone: a sheet with Cancel | title | Create.
 * Desktop: the panel's footer has Cancel and "Create group chat".
 */
export function RoomNew() {
  const [bots, setBots] = useState<SavedBot[] | null>(null);
  const [taken, setTaken] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listBots().then(setBots);
    roomLink.client.list().then((rooms) => setTaken(rooms.map((r) => r.name))).catch(() => undefined);
  }, []);

  const problem = createProblem(name, picked, taken);
  const nameTaken = problem === "That name's taken";
  const ready = problem === null && !busy;
  const full = picked.length >= MAX_MEMBERS;

  const toggle = (bot: string) => setPicked((p) => (p.includes(bot) ? p.filter((x) => x !== bot) : p.length >= MAX_MEMBERS ? p : [...p, bot]));

  const create = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const room = await roomLink.client.create({ roomId: newId(), name, profiles: picked });
      router.replace({ pathname: '/room/[id]', params: { id: room.id } });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const cancel = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const confirm = () => (name || picked.length ? Alert.alert('Discard this group?', undefined, [{ text: 'Keep editing', style: 'cancel' }, { text: 'Discard', style: 'destructive', onPress: cancel }]) : cancel());

  return (
    <View style={styles.screen}>
      <Column>
        {/* The phone sheet's own title row (the desktop panel draws its own header). */}
        {!isDesktop ? (
          <View style={styles.sheetBar}>
            <Pressable onPress={confirm} hitSlop={12} accessibilityRole="button" accessibilityLabel="Cancel" style={styles.barSide}>
              <Text style={styles.barLink}>Cancel</Text>
            </Pressable>
            <Text style={styles.barTitle}>New group chat</Text>
            <Pressable onPress={create} disabled={!ready} hitSlop={12} accessibilityRole="button" accessibilityLabel="Create" accessibilityState={{ disabled: !ready }} style={[styles.barSide, { alignItems: 'flex-end' }]}>
              {busy ? <ActivityIndicator color={colors.accent} /> : <Text style={[styles.barLink, { fontWeight: '600' }, !ready && { color: colors.faint }]}>Create</Text>}
            </Pressable>
          </View>
        ) : null}
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={isDesktop ? styles.headRow : styles.headCol}>
            <View style={isDesktop ? styles.pictureDesk : styles.picture}>
              <MemberStack profiles={picked.length >= 2 ? picked : (bots ?? []).slice(0, 3).map((b) => b.bot)} size={isDesktop ? 64 : 68} />
            </View>
            <View style={isDesktop ? { flex: 1 } : { alignSelf: 'stretch' }}>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Group name"
                placeholderTextColor={colors.faint}
                style={[styles.field, nameTaken && { borderColor: colors.bad, borderWidth: 1 }]}
                maxLength={60}
                accessibilityLabel="Group name"
                returnKeyType="done"
              />
              {nameTaken ? <Text style={styles.taken}>That name's taken</Text> : null}
            </View>
          </View>

          <Text style={styles.section}>
            MEMBERS · {picked.length} OF {MAX_MEMBERS}
          </Text>
          {bots === null ? (
            <ActivityIndicator color={colors.dim} style={{ marginTop: 24 }} />
          ) : bots.length < MIN_MEMBERS ? (
            <Text style={styles.footnote}>Add at least {MIN_MEMBERS} bots first, then make a group.</Text>
          ) : (
            <View style={styles.group}>
              {bots.map((b, i) => {
                const on = picked.includes(b.bot);
                const off = full && !on;
                return (
                  <Pressable
                    key={b.bot}
                    onPress={() => toggle(b.bot)}
                    disabled={off}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on, disabled: off }}
                    accessibilityLabel={nameOf(b.bot, b.displayName)}
                    style={({ pressed }) => [styles.member, i > 0 && styles.memberLine, off && { opacity: 0.4 }, pressed && { backgroundColor: colors.raised }]}
                  >
                    <MemberDisc bot={b.bot} size={32} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.memberName} numberOfLines={1}>
                        {nameOf(b.bot, b.displayName)}
                      </Text>
                    </View>
                    <View style={[styles.check, on && { backgroundColor: colors.accent, borderColor: colors.accent }]}>{on ? <Text style={styles.tick}>✓</Text> : null}</View>
                  </Pressable>
                );
              })}
            </View>
          )}
          <Text style={styles.footnote}>2 to 6 bots. Each one replies when it has something to add; @mention a bot to ask just that one.</Text>
          {error ? <Text style={[styles.footnote, { color: colors.bad }]}>{error}</Text> : null}
        </ScrollView>

        {isDesktop ? (
          <View style={styles.footer}>
            <Pressable onPress={cancel} style={[styles.deskBtn, { backgroundColor: colors.raised }]} accessibilityRole="button">
              <Text style={styles.deskText}>Cancel</Text>
            </Pressable>
            <Pressable onPress={create} disabled={!ready} style={[styles.deskBtn, { backgroundColor: ready ? colors.accent : colors.card }]} accessibilityRole="button" accessibilityState={{ disabled: !ready }}>
              <Text style={[styles.deskText, !ready && { color: colors.faint }]}>Create group chat</Text>
            </Pressable>
          </View>
        ) : null}
      </Column>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  sheetBar: { flexDirection: 'row', alignItems: 'center', height: 56, paddingHorizontal: 16 },
  barSide: { width: 80, minHeight: 44, justifyContent: 'center' },
  barTitle: { flex: 1, textAlign: 'center', color: colors.text, fontSize: 17, fontWeight: '600' },
  barLink: { color: colors.accent, fontSize: 17 },
  content: { padding: 16, paddingBottom: 32 },
  headCol: { alignItems: 'center', gap: 12 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  picture: { width: 84, height: 84, borderRadius: 42, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  pictureDesk: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  field: { height: 44, borderRadius: 12, backgroundColor: colors.card, color: colors.text, fontSize: 17, paddingHorizontal: 16, borderColor: 'transparent', borderWidth: 1 },
  taken: { color: colors.bad, fontSize: 13, lineHeight: 18, marginTop: 6, marginLeft: 4 },
  section: { color: colors.dim, fontSize: 13, lineHeight: 18, letterSpacing: 0.3, marginTop: 24, marginBottom: 8, marginLeft: 16 },
  group: { backgroundColor: colors.card, borderRadius: 12, overflow: 'hidden' },
  member: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 58, paddingHorizontal: 16, paddingVertical: 8 },
  memberLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  memberName: { color: colors.text, fontSize: 17, lineHeight: 22, fontWeight: '600' },
  check: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: '#4B4F56', alignItems: 'center', justifyContent: 'center' },
  tick: { color: '#fff', fontSize: 14, fontWeight: '700', lineHeight: 16 },
  footnote: { color: colors.dim, fontSize: 13, lineHeight: 18, marginTop: 12, marginHorizontal: 16 },
  footer: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, padding: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  deskBtn: { height: 32, borderRadius: 8, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  deskText: { color: colors.text, fontSize: 14, fontWeight: '600' },
});

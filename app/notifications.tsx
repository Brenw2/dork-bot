import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useColumnStyle } from '@/components/Column';
import { getPushToken, notificationsSupported, turnOffNotifications, turnOnNotifications } from '@/components/notifications';
import { button, colors } from '@/lib/theme';

// Notifications on this phone: one switch. Turning on asks iOS, then adds this phone to every bot
// on Hermes; the Hermes plugin dork-bot-push does the sending (hermes-plugin/dork-bot-push).
export default function NotificationsScreen() {
  const column = useColumnStyle();
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void getPushToken().then((t) => setOn(!!t));
  }, []);

  const toggle = async () => {
    setBusy(true);
    setMessage(null);
    try {
      if (on) {
        const errors = await turnOffNotifications();
        setOn(false);
        setMessage(Object.keys(errors).length ? `Off here. Couldn't update: ${Object.keys(errors).join(', ')}.` : 'Off on this phone.');
      } else {
        const r = await turnOnNotifications();
        if (!r.ok) setMessage(r.reason);
        else {
          setOn(true);
          setMessage(Object.keys(r.errors).length ? `On. Couldn't update: ${Object.keys(r.errors).join(', ')}.` : 'On for every bot.');
        }
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: 'Notifications' }} />
      <ScrollView contentContainerStyle={[styles.body, column]}>
        <Text style={styles.intro}>
          Get a notification when a bot finishes a reply, needs your OK, or finishes a routine. Tap it to open that chat.
        </Text>
        {notificationsSupported ? (
          <Pressable
            style={({ pressed }) => [button.primary, pressed && { opacity: 0.7 }, (busy || on === null) && button.disabled]}
            disabled={busy || on === null}
            onPress={() => void toggle()}
            accessibilityRole="button"
            accessibilityLabel={on ? 'Turn notifications off' : 'Turn notifications on'}
          >
            <Text style={button.text}>{on ? 'Turn off on this phone' : 'Turn on'}</Text>
          </Pressable>
        ) : (
          <Text style={styles.intro}>Notifications go to the iPhone app.</Text>
        )}
        {message ? <Text style={styles.message}>{message}</Text> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: { padding: 16, gap: 14 },
  intro: { color: colors.dim, fontSize: 14, lineHeight: 20 },
  message: { color: colors.text, fontSize: 14, lineHeight: 20 },
});

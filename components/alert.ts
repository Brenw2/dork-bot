// Alerts and action menus. On the phone: React Native's Alert (the system's sheets).
import { Alert, type AlertButton } from 'react-native';
import { currentTheme } from '@/components/theme';
import { themed } from '@/lib/themeSkin';

export { Alert };

/** A menu item. The desktop menu draws the icon, the right-aligned shortcut and a separator above; the phone's sheet ignores them. */
export type MenuItem = AlertButton & { icon?: import('@/components/AppIcons').IconName; shortcut?: string; sepBefore?: boolean };

export const Menu = {
  // The system sheet writes the items as the current theme does (lowercase in Terminal); Classic's text is passed as given.
  show: (title: string, items: MenuItem[], _anchor?: { x: number; y: number }) =>
    Alert.alert(
      title,
      undefined,
      items.map((it) => (it.text ? { ...it, text: themed(currentTheme(), it.text) } : it)),
    ),
};

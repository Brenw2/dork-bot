// Alerts and action menus. On the phone: React Native's Alert (the system's sheets).
import { Alert, type AlertButton } from 'react-native';

export { Alert };

export const Menu = {
  show: (title: string, items: AlertButton[], _anchor?: { x: number; y: number }) => Alert.alert(title, undefined, items),
};

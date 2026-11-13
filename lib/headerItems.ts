// Native header buttons without the iOS 26 liquid-glass capsule. Plain headerLeft/headerRight items
// are drawn inside the system's glass capsule on iOS 26+; a custom item with hidesSharedBackground
// is not. Every Stack.Screen that sets header buttons goes through headerSides (test/headerItems.test.ts
// scans app/ and components/ and fails on a direct headerLeft/headerRight).
import type { ReactElement } from 'react';
import { Platform } from 'react-native';

export interface HeaderSides {
  left?: ReactElement | null;
  right?: ReactElement | null;
}

const custom = (element: ReactElement) => ({ type: 'custom' as const, element, hidesSharedBackground: true });

export function headerSides({ left, right }: HeaderSides) {
  if (Platform.OS === 'ios') {
    return {
      ...(left ? { unstable_headerLeftItems: () => [custom(left)] } : {}),
      ...(right ? { unstable_headerRightItems: () => [custom(right)] } : {}),
    };
  }
  return {
    ...(left ? { headerLeft: () => left } : {}),
    ...(right ? { headerRight: () => right } : {}),
  };
}

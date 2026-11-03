import type { ReactNode } from 'react';
import { useWindowDimensions } from 'react-native';
import { SafeAreaFrameContext, SafeAreaInsetsContext, type EdgeInsets } from 'react-native-safe-area-context';

declare global {
  // Set by scripts/test-layout.mjs before the app loads: the safe areas of the posture under test
  // (e.g. the closed iPhone Duo's 84 pt status rail on the right).
  var __DORK_TEST_INSETS__: EdgeInsets | undefined;
}

/** Web build only: hands the screens the Duo's safe areas, which a desktop browser doesn't have. */
export function TestInsets({ children }: { children: ReactNode }) {
  const { width, height } = useWindowDimensions();
  const insets = globalThis.__DORK_TEST_INSETS__;
  if (!insets) return <>{children}</>;
  return (
    <SafeAreaFrameContext.Provider value={{ x: 0, y: 0, width, height }}>
      <SafeAreaInsetsContext.Provider value={insets}>{children}</SafeAreaInsetsContext.Provider>
    </SafeAreaFrameContext.Provider>
  );
}

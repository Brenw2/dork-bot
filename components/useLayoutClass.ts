import { useEffect } from 'react';
import { Dimensions, Platform, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ScreenOrientation from 'expo-screen-orientation';
import { layoutClassFor, orientationActionFor, type LayoutClass, type OrientationAction } from '@/lib/layoutClass';

export function useLayoutClass(): LayoutClass {
  const { width, height } = useWindowDimensions();
  const { left, right } = useSafeAreaInsets();
  return layoutClassFor({ width, height, insetLeft: left, insetRight: right });
}

let applied: OrientationAction | null = null;

function applyOrientation(cls: LayoutClass): void {
  if (Platform.OS === 'web') return;
  const action = orientationActionFor(cls, Platform.OS);
  if (action === applied) return;
  applied = action;
  const run =
    action === 'unlock'
      ? ScreenOrientation.unlockAsync()
      : ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
  run.catch(() => {
    applied = null; // try again on the next change
  });
}

/** Run once at startup, before the first paint, so a regular iPhone never rotates. */
export function applyInitialOrientation(): void {
  const { width, height } = Dimensions.get('window');
  applyOrientation(layoutClassFor({ width, height }));
}

/** Portrait on every compact window; free rotation only on an open Duo. */
export function OrientationController(): null {
  const cls = useLayoutClass();
  useEffect(() => applyOrientation(cls), [cls]);
  return null;
}

import type { ReactNode } from 'react';

/** On the phone the real safe areas come from iOS. See TestInsets.web.tsx for the layout tests. */
export function TestInsets({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

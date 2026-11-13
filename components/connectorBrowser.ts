import * as WebBrowser from 'expo-web-browser';
import { desktop } from '@/components/desktop';
import type { SignInBrowser } from '@/lib/connectors';

// The sign-in page opens in an in-app browser (it shares Safari's logins, so it's often one tap).
// The provider sends it back to Hermes on b-lab; Connectors.signIn sees the approval and closes it.
export const browser: SignInBrowser = {
  open: (url) => (desktop ? desktop.openAuth(url) : WebBrowser.openAuthSessionAsync(url, 'dorkbot://connected').then(() => undefined)),
  close: () => (desktop ? desktop.closeAuth() : WebBrowser.dismissAuthSession()),
};

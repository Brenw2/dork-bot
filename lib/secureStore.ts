// Keychain on the phone (expo-secure-store). The web build (used only by the
// layout tests, scripts/test-layout.mjs) gets lib/secureStore.web.ts instead.
export { deleteItemAsync, getItemAsync, setItemAsync } from 'expo-secure-store';

/**
 * Font loader stub.
 *
 * The app ships no custom fonts — every screen uses the platform
 * system font (Roboto) via plain `fontWeight` styles.
 * This file is kept as a no-op so existing call sites
 * (`await loadFonts()` in App.tsx history) compile without changes.
 *
 * If we later introduce a custom font in the future, place the .ttf files in
 *   android/app/src/main/assets/fonts/   (Android)
 * and add an `assets: ['./assets/fonts']` entry to react-native.config.js.
 */
export async function loadFonts(): Promise<void> {
  return Promise.resolve();
}

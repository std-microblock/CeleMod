/**
 * Shorten an absolute path so it fits in a settings row.
 *
 * Full paths such as
 * `C:\Users\somebody\AppData\Local\CeleMod\mod_list.json` are unreadable in
 * the narrow status line, so well-known roots collapse into the placeholders
 * Explorer accepts: `%LOCALAPPDATA%`, `%APPDATA%` and `~`.
 * Unknown layouts are returned unchanged so the UI still tells the truth.
 */
export function formatDisplayPath(path: string): string {
  if (!path) return "";
  return path
    .replace(/^[A-Za-z]:\\Users\\[^\\]+\\AppData\\Local\\/i, "%LOCALAPPDATA%\\")
    .replace(/^[A-Za-z]:\\Users\\[^\\]+\\AppData\\Roaming\\/i, "%APPDATA%\\")
    .replace(/^[A-Za-z]:\\Users\\[^\\]+(?=\\)/i, "~")
    .replace(/^\/(?:home|Users)\/[^/]+(?=\/)/, "~");
}

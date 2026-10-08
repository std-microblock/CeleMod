/**
 * The native side stops blocking the first screen on the Mod catalog after a
 * few seconds, but it keeps a slow download running and publishes it to the
 * on-disk cache once it lands. These helpers let callers wait for that download
 * to settle instead of failing with an empty catalogue.
 */
export const CATALOG_DOWNLOAD_POLL_INTERVAL_MS = 3000;
/** Matches the native catalog download deadline (60s) when polling. */
export const CATALOG_DOWNLOAD_POLL_LIMIT = 20;

/**
 * Waits until no catalog download is running anymore (or the polling budget is
 * used up). Returns `true` when the download settled, so the caller can retry.
 */
export const waitForCatalogDownload = async (
  downloading: () => Promise<boolean>,
  wait: (ms: number) => Promise<unknown>,
  limit: number = CATALOG_DOWNLOAD_POLL_LIMIT,
  intervalMs: number = CATALOG_DOWNLOAD_POLL_INTERVAL_MS,
): Promise<boolean> => {
  for (let attempt = 0; attempt < limit; attempt += 1) {
    if (!(await downloading())) return true;
    await wait(intervalMs);
  }
  return false;
};

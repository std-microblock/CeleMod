/**
 * Parsing of the raw Mod catalog response.
 *
 * The catalog comes from the mirror (`/api/v2/mod/list`), and the UI used to
 * treat anything that was not an array as an empty catalog. A mirror that
 * renames or drops a top-level field therefore looked exactly like a mirror
 * with no Mods at all: an empty list, no error, and nothing in the log. The
 * response shape is checked here so that case fails loudly instead.
 */
export interface CatalogResponse<T> {
  data: T[];
  code: number;
  message: string;
}

export const parseCatalogResponse = <T>(raw: string): T[] => {
  let parsed: Partial<CatalogResponse<T>>;
  try {
    parsed = JSON.parse(raw) as Partial<CatalogResponse<T>>;
  } catch (error) {
    throw new Error(`Mod catalog response is not valid JSON: ${String(error)}`);
  }
  if (!Array.isArray(parsed?.data)) {
    throw new Error(
      `Mod catalog response has no Mod list (code ${parsed?.code ?? "?"}, message ${parsed?.message ?? ""})`,
    );
  }
  if (typeof parsed.code === "number" && parsed.code !== 200) {
    throw new Error(
      `Mod catalog request failed (code ${parsed.code}, message ${parsed.message ?? ""})`,
    );
  }
  return parsed.data;
};

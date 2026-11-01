import assert from "node:assert/strict";
import test from "node:test";
import { parseCatalogResponse } from "./catalogResponse";

test("a normal catalog response yields its Mods", () => {
  const mods = parseCatalogResponse<{ name: string }>(
    '{"data":[{"name":"SpeedrunTool"}],"code":200,"message":"OK"}',
  );
  assert.deepEqual(mods, [{ name: "SpeedrunTool" }]);
});

test("an empty catalog is still a valid answer", () => {
  assert.deepEqual(
    parseCatalogResponse('{"data":[],"code":200,"message":"OK"}'),
    [],
  );
});

/**
 * A mirror that renames or drops `data` used to look like an empty catalog:
 * no Mods, no error, nothing in the log.
 */
test("a response without a Mod list is an error instead of an empty catalog", () => {
  assert.throws(
    () => parseCatalogResponse('{"mods":[],"code":200,"message":"OK"}'),
    /no Mod list/,
  );
  assert.throws(
    () => parseCatalogResponse('{"data":null,"code":200,"message":"OK"}'),
    /no Mod list/,
  );
});

test("a failed catalog request keeps its reason", () => {
  assert.throws(
    () =>
      parseCatalogResponse(
        '{"data":null,"code":404,"message":"接口未找到"}',
      ),
    /code 404/,
  );
  assert.throws(
    () => parseCatalogResponse('{"data":[],"code":500,"message":"boom"}'),
    /code 500.*boom/,
  );
});

test("a non-JSON body is an error", () => {
  assert.throws(() => parseCatalogResponse("<html>502</html>"), /not valid JSON/);
});

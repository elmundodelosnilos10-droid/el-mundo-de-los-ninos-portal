import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadSchoolBackupTables } from "../scripts/supabase-school-backup.mjs";

test("backup grant provides SELECT only to existing server role on the exact 33 table catalog", async () => {
  const source = await readFile(new URL("../supabase/migrations/20261029000000_school_backup_read_access.sql", import.meta.url), "utf8");
  const sql = source.replace(/^\s*--.*$/gm, "").trim();
  const match = sql.match(/^begin;\s*grant select on table\s+([\s\S]+?)\s+to service_role;\s*commit;$/i);
  assert.ok(match, "one explicit read-only grant, no additional SQL");
  const granted = match[1].split(",").map(value => value.trim());
  const expected = (await loadSchoolBackupTables()).map(table => `public.${table.name}`);
  assert.equal(new Set(granted).size, 33);
  assert.deepEqual(granted, expected);
  assert.ok(!/\b(?:anon|authenticated)\b/.test(sql));
  assert.ok(!/\b(?:insert|update|delete|truncate|alter|create|execute|all|default)\b/i.test(sql));
});

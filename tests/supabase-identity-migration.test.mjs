import test from "node:test";
import assert from "node:assert/strict";
import { buildLegacyUserIdMap, rewriteLegacyUserReferences } from "../scripts/supabase-identity-migration.mjs";

const adminUuid = "11111111-1111-4111-8111-111111111111";
const teacherUuid = "22222222-2222-4222-8222-222222222222";

test("empareja cuentas por correo sin importar mayúsculas y espacios", () => {
  const mapping = buildLegacyUserIdMap(
    [{ id: "better-auth-admin", email: " Admin@Escuela.test " }, { id: "teacher-old", email: "teacher@escuela.test" }],
    [{ id: adminUuid, email: "admin@escuela.test" }, { id: teacherUuid, email: "teacher@escuela.test" }],
  );
  assert.deepEqual([...mapping], [["better-auth-admin", adminUuid], ["teacher-old", teacherUuid]]);
});

test("falla cerrada cuando falta una identidad o hay cuentas ambiguas", () => {
  assert.throws(() => buildLegacyUserIdMap([{ id: "old", email: "a@escuela.test" }], []), /falta una identidad/);
  assert.throws(() => buildLegacyUserIdMap([{ id: "old-1", email: "a@escuela.test" }, { id: "old-2", email: "A@escuela.test" }], []), /correos repetidos/);
  assert.throws(() => buildLegacyUserIdMap([], [{ id: "not-a-uuid", email: "a@escuela.test" }]), /UUID no válido/);
});

test("traduce referencias de usuarios y conserva IDs escolares", () => {
  const input = {
    students: [{ id: "7c47f0e2-73a9-46cc-9903-a56e48ef9813", given_name: "Niño" }],
    user_roles: [{ user_id: "better-auth-admin", assigned_by: null, role: "direccion" }],
    attendance: [{ id: "e87f1837-c938-4a02-93e8-b8f664228d81", student_id: "7c47f0e2-73a9-46cc-9903-a56e48ef9813", recorded_by: "better-auth-admin", modified_by: "teacher-old" }],
  };
  const output = rewriteLegacyUserReferences(input, new Map([["better-auth-admin", adminUuid], ["teacher-old", teacherUuid]]));
  assert.equal(output.user_roles[0].user_id, adminUuid);
  assert.equal(output.user_roles[0].assigned_by, null);
  assert.equal(output.attendance[0].recorded_by, adminUuid);
  assert.equal(output.attendance[0].modified_by, teacherUuid);
  assert.equal(output.attendance[0].student_id, "7c47f0e2-73a9-46cc-9903-a56e48ef9813");
  assert.equal(output.attendance[0].id, "e87f1837-c938-4a02-93e8-b8f664228d81");
  assert.equal(input.user_roles[0].user_id, "better-auth-admin");
});

test("se detiene si una referencia de usuario no tiene pareja", () => {
  assert.throws(() => rewriteLegacyUserReferences({ teachers: [{ id: "teacher-row", user_id: "unmapped" }] }, new Map()), /no tiene correspondencia/);
});

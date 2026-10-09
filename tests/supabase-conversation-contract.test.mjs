import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../supabase/migrations/20261017000000_school_conversation_rpcs.sql", import.meta.url), "utf8");
const [conversationRoute, messageRoute, readRoute, fileRoute, page, panel] = await Promise.all([
  readFile(new URL("../app/api/conversations/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/conversations/[id]/messages/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/conversations/[id]/messages/read/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/files/[id]/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/comunicacion/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/comunicacion/messaging-panel.tsx", import.meta.url), "utf8"),
]);
const sql = migration.replace(/--.*$/gm, "");

function definition(name) {
  return sql.match(new RegExp(`create function public\\.${name}\\(([\\s\\S]*?)\\$\\$;`, "i"))?.[0] ?? "";
}

test("chat RPC signatures match the user-scoped routes and grants", () => {
  assert.match(sql, /create function public\.school_conversation_contacts\(\)\s*returns jsonb/i);
  assert.match(sql, /create function public\.school_conversation_feed\(\)\s*returns jsonb/i);
  assert.match(sql, /create function public\.school_open_conversation\(\s*p_id uuid,\s*p_student_id uuid,\s*p_teacher_id uuid,\s*p_guardian_id uuid default null\s*\)\s*returns jsonb/i);
  assert.match(sql, /create function public\.school_message_page\(\s*p_conversation_id uuid,\s*p_before_sent_at timestamptz default null,\s*p_before_id uuid default null,\s*p_limit integer default 50\s*\)\s*returns jsonb/i);
  assert.match(sql, /create function public\.school_send_message\(\s*p_id uuid,\s*p_conversation_id uuid,\s*p_body text,[\s\S]*?p_size_bytes integer default null\s*\)\s*returns jsonb/i);
  assert.match(sql, /create function public\.school_mark_conversation_read\(\s*p_conversation_id uuid,\s*p_through_sent_at timestamptz,\s*p_through_id uuid\s*\)\s*returns jsonb/i);
  for (const signature of ["school_conversation_contacts()", "school_conversation_feed()", "school_open_conversation(uuid, uuid, uuid, uuid)", "school_message_page(uuid, timestamptz, uuid, integer)", "school_send_message(uuid, uuid, text, uuid, text, text, text, integer)", "school_mark_conversation_read(uuid, timestamptz, uuid)"]) {
    assert.match(sql, new RegExp(`grant execute on function public\\.${signature.replace(/[()]/g, "\\$&")} to authenticated`, "i"));
  }
});

test("contacts and conversations require active school relationships", () => {
  const contacts = definition("school_conversation_contacts");
  const feed = definition("school_conversation_feed");
  const open = definition("school_open_conversation");
  for (const functionSql of [contacts, feed, open]) assert.match(functionSql, /security definer\s+set search_path = ''/i);
  assert.match(contacts, /school_actor_active\(\)/i);
  assert.match(contacts, /enrollment\.ended_at is null/i);
  assert.match(contacts, /student_guardian\.active = true/i);
  assert.match(contacts, /teacher\.active = true/i);
  assert.match(feed, /school_is_conversation_member\(conversation\.id\)/i);
  assert.match(open, /auth\.uid\(\)/i);
  assert.match(open, /guardian\.user_id = v_actor/i);
  assert.match(open, /teacher\.user_id = v_actor/i);
  assert.match(open, /on conflict \(student_id, teacher_id, guardian_id\) do nothing/i);
  assert.match(open, /insert into public\.audit_log/i);
});

test("message history is a bounded keyset page and read receipts stop at the supplied message", () => {
  const page = definition("school_message_page");
  const read = definition("school_mark_conversation_read");
  assert.match(page, /school_is_conversation_member\(p_conversation_id\)/i);
  assert.match(page, /p_limit < 1 or p_limit > 50/i);
  assert.match(page, /message\.sent_at < p_before_sent_at/i);
  assert.match(page, /message\.id < p_before_id/i);
  assert.match(page, /limit p_limit \+ 1/i);
  assert.match(page, /'isMine', visible\.author_id = \(select auth\.uid\(\)\)/i);
  assert.match(page, /to_char\(visible\.sent_at at time zone 'UTC'.*\|/i);
  assert.match(read, /message\.id = p_through_id and message\.conversation_id = p_conversation_id/i);
  assert.match(read, /message\.author_id <> v_actor and message\.read_at is null/i);
  assert.match(read, /message\.sent_at < p_through_sent_at or \(message\.sent_at = p_through_sent_at and message\.id <= p_through_id\)/i);
});

test("sending creates private attachment metadata, notification, message, and audit atomically", () => {
  const send = definition("school_send_message");
  assert.match(send, /school_is_conversation_member\(p_conversation_id\)/i);
  assert.match(send, /p_size_bytes not between 1 and 10485760/i);
  assert.match(send, /application\/pdf', 'image\/jpeg', 'image\/png', 'image\/webp/i);
  assert.match(send, /supabase:private\/message/i);
  assert.match(send, /purpose, uploaded_by, group_id, student_id, created_at/i);
  assert.match(send, /insert into public\.messages/i);
  assert.match(send, /insert into public\.notifications/i);
  assert.match(send, /on conflict \(dedupe_key\) do nothing/i);
  assert.match(send, /insert into public\.audit_log/i);
  assert.match(sql, /revoke insert on table public\.conversations from authenticated/i);
  assert.match(sql, /revoke insert, update on table public\.messages from authenticated/i);
  assert.match(sql, /revoke insert, update, delete on table public\.files from authenticated/i);
});

test("application routes use Supabase RPCs only when selected and retain D1 fallback", () => {
  assert.match(conversationRoute, /SCHOOL_DATA_PROVIDER === "supabase"/);
  assert.match(conversationRoute, /actor\.supabaseAuth\.accessToken/);
  assert.match(conversationRoute, /school_conversation_feed/);
  assert.match(conversationRoute, /school_open_conversation/);
  assert.match(messageRoute, /school_message_page/);
  assert.match(messageRoute, /school_send_message/);
  assert.match(messageRoute, /school_is_conversation_member|\.select<\{ id: string \}>/);
  assert.match(readRoute, /school_mark_conversation_read/);
  assert.match(fileRoute, /fileFromSupabase/);
  assert.match(fileRoute, /"messages"/);
  assert.match(page, /school_conversation_contacts/);
  assert.match(panel, /order: number \| string/);
  assert.match(panel, /compareMessageOrder/);
  for (const route of [conversationRoute, messageRoute, readRoute]) assert.match(route, /if \(env\.SCHOOL_DATA_PROVIDER === "supabase"\)/);
  assert.match(conversationRoute, /const db = getDb\(\)/);
  assert.match(messageRoute, /const messageWrite = db\.insert\(messages\)/);
});

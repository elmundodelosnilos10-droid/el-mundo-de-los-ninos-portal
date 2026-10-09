import { items, requiredId } from './supabase-school-http-local-support.mjs';

/** Authenticated HTTP acceptance only: no provider mocks, files, retries or
 * Realtime claim. Caller owns isolated provisioning, evidence and cleanup. */
export async function exercisePrivateSchoolChat({ call, teacher, families, teacherId, check }) {
  const conversations = [], messageIds = [];
  await call(null, '/api/conversations', { statuses: [401], label: 'Anónimo sin conversaciones' });
  for (let index = 0; index < families.length; index++) {
    const family = families[index], other = families[index === 0 ? 1 : 0];
    const label = index === 0 ? 'A' : 'B';
    const opened = await call(family, '/api/conversations', { method: 'POST', body: { studentId: family.ownStudentId, teacherId }, statuses: [201], label: `Familia ${label} abre chat propio` });
    const id = requiredId(opened?.id, 'Conversación'); conversations.push(id);
    const sent = await call(teacher, `/api/conversations/${id}/messages`, { method: 'POST', body: { body: `Mensaje docente sintético ${label}.` }, statuses: [201], label: `Docente envía mensaje ${label}` });
    const sentId = requiredId(sent?.id, 'Mensaje docente'); messageIds.push(sentId);
    const feed = items(await call(family, '/api/conversations', { label: `Familia ${label} consulta chats` }), 'Conversaciones');
    check(`Chat ${label} tiene pendiente de lectura`, feed.some(row => row.id === id && row.unreadCount === 1));
    const page = await call(family, `/api/conversations/${id}/messages`, { label: `Familia ${label} lee mensaje docente` });
    const received = items(page, 'Mensajes');
    check(`Mensaje docente ${label} íntegro y autorizado`, received.length === 1 && received[0].id === sentId && received[0].body === `Mensaje docente sintético ${label}.` && received[0].isMine === false && received[0].readAt === null && typeof received[0].order === 'string');
    await call(other, `/api/conversations/${id}/messages`, { statuses: [404], label: `Otra familia sin lectura de chat ${label}` });
    await call(other, `/api/conversations/${id}/messages`, { method: 'POST', body: { body: 'Intento ajeno sintético.' }, statuses: [404], label: `Otra familia sin envío a chat ${label}` });
    await call(other, '/api/conversations', { method: 'POST', body: { studentId: family.ownStudentId, teacherId }, statuses: [404], label: `Otra familia no crea chat por alumno ${label}` });
    await call(null, `/api/conversations/${id}/messages`, { statuses: [401], label: `Anónimo sin mensajes ${label}` });
    const read = await call(family, `/api/conversations/${id}/messages/read`, { method: 'POST', body: { throughOrder: received[0].order }, label: `Familia ${label} confirma lectura` });
    check(`Acuse familiar ${label} confirmado`, typeof read?.readAt === 'string');
    const teacherPage = items(await call(teacher, `/api/conversations/${id}/messages`, { label: `Docente confirma acuse ${label}` }), 'Mensajes');
    check(`Acuse familiar ${label} persistido`, teacherPage.length === 1 && teacherPage[0].id === sentId && typeof teacherPage[0].readAt === 'string');
    const reply = await call(family, `/api/conversations/${id}/messages`, { method: 'POST', body: { body: `Respuesta familiar sintética ${label}.` }, statuses: [201], label: `Familia ${label} responde` });
    const replyId = requiredId(reply?.id, 'Respuesta familiar'); messageIds.push(replyId);
    const teacherReplies = items(await call(teacher, `/api/conversations/${id}/messages`, { label: `Docente lee respuesta ${label}` }), 'Mensajes');
    const response = teacherReplies.find(row => row.id === replyId);
    check(`Respuesta familiar ${label} íntegra`, teacherReplies.length === 2 && response?.body === `Respuesta familiar sintética ${label}.` && response.isMine === false && typeof response.order === 'string');
    await call(teacher, `/api/conversations/${id}/messages/read`, { method: 'POST', body: { throughOrder: response.order }, label: `Docente confirma respuesta ${label}` });
    const ownMessages = items(await call(family, `/api/conversations/${id}/messages`, { label: `Familia ${label} confirma acuse docente` }), 'Mensajes');
    check(`Acuse docente ${label} persistido`, ownMessages.length === 2 && ownMessages.some(row => row.id === replyId && typeof row.readAt === 'string'));
    const ownNotices = items(await call(family, '/api/notifications', { label: `Familia ${label} consulta aviso de mensaje` }), 'Avisos');
    const foreignNotices = items(await call(other, '/api/notifications', { label: `Otra familia sin aviso de mensaje ${label}` }), 'Avisos');
    check(`Aviso de mensaje ${label} privado`, ownNotices.some(row => row.kind === 'mensaje') && (index === 0 ? !foreignNotices.some(row => row.kind === 'mensaje') : foreignNotices.filter(row => row.kind === 'mensaje').length === 1));
    const unread = items(await call(family, '/api/conversations', { label: `Chat ${label} sin pendientes tras lectura` }), 'Conversaciones');
    check(`Chat ${label} sin mensajes pendientes`, unread.some(row => row.id === id && row.unreadCount === 0));
  }
  for (let index = 0; index < families.length; index++) {
    const visible = items(await call(families[index], '/api/conversations', { label: 'Conversaciones familiares aisladas' }), 'Conversaciones');
    check(`Familia ${index === 0 ? 'A' : 'B'} solo ve su chat`, visible.length === 1 && visible[0].id === conversations[index]);
  }
  const teacherChats = items(await call(teacher, '/api/conversations', { label: 'Docente ve sus dos chats autorizados' }), 'Conversaciones');
  check('Docente ve dos conversaciones autorizadas', teacherChats.length === 2 && conversations.every(id => teacherChats.some(row => row.id === id)));
  return { conversations, messageIds };
}

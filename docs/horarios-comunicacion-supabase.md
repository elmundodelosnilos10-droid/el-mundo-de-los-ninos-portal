# Horarios de comunicación en Supabase

Contrato: `getCommunicationHours(actor?: Actor)` devuelve `CommunicationHours`. En modo Supabase exige el actor verificado completo y consulta con su JWT, sin alcanzar D1.

- Un SELECT exitoso sin fila `school` devuelve la política existente `DEFAULT_COMMUNICATION_HOURS` (sin limitación) y el API indica `configured: false`. No se fabrica ni inserta una fila.
- Una configuración existente se valida antes de usarla. Fallos, identidades inconsistentes o datos corruptos generan error; no abren el chat mediante un default.
- GET `/api/communication-settings` usa RLS y devuelve configuración y fecha persistidas.
- PATCH valida origen y rol en el servidor y llama `school_update_communication_settings`; el SQL deriva el actor de `auth.uid()`, valida liderazgo y guarda ajuste/auditoría en una transacción.
- La migración `20261018000000_school_communication_settings_rpc.sql` revoca modificaciones directas a authenticated y agrega un trigger sobre messages, que también alcanza llamadas al RPC de mensajes. Un participante con JWT queda sujeto al horario en Ciudad de México, inicio inclusive y cierre exclusive. Configuración corrupta deniega el envío. Importaciones del dueño sin JWT conservan el acceso histórico y las FK normales.
- La página recibió el contrato con actor y manejo de error; el envío de mensajes también pasa actor y responde 503 si no puede verificar el horario. Se movió su inicialización de D1 al fallback correspondiente.

Verificación local: nueve pruebas del nuevo cliente/contratos más tres pruebas existentes de horarios pasan; ESLint de los archivos editados pasa. Una comprobación TypeScript de Next encontró cuatro errores exclusivamente en tipos generados `.next/types/validator.ts` durante trabajo concurrente. No se ejecutó un build ni SQL remoto.

El fixture `tests/supabase-communication-hours.integration.sql` está preparado para una transacción que termine en ROLLBACK: verifica límites UTC/Ciudad de México, validación de valores, auditoría, revocación de escritura directa, restricciones de familias, trigger con corrupción y acceso histórico sin JWT. Todavía no se ejecutó en PostgreSQL.

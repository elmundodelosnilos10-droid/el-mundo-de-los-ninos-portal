# Configurar el correo de recuperación

## Configuración actual

En producción, `SCHOOL_AUTH_PROVIDER=supabase`: `/recuperar` solicita el enlace mediante Supabase Auth y vuelve a `/restablecer`. La URL del portal y la ruta de restablecimiento ya están permitidas en Supabase Auth. El Site debe conservar el proveedor `supabase`; los secretos `GMAIL_*` y `RESEND_API_KEY` no intervienen en este flujo.

El 8 de octubre de 2026, Supabase rechazó solicitudes de recuperación por su límite temporal de correo. El enlace anterior venció. No sigas reenviando solicitudes mientras el servicio las rechace. Cuando vuelva a aceptar correos, solicita un solo enlace, ábrelo pronto y establece la contraseña en el portal. No compartas el enlace ni la contraseña por chat.

Para uso diario, configura SMTP personalizado en el proyecto Supabase, en Auth → Emails/SMTP, con un proveedor y remitente controlados por la escuela. Guarda las credenciales en la configuración segura de Supabase, no en el repositorio. Después envía una prueba controlada y confirma que el enlace regrese a `/restablecer` antes de habilitar cuentas de familias.

## Alternativas del proveedor Better Auth

Estas opciones solo se usan si la escuela cambia `SCHOOL_AUTH_PROVIDER` a Better Auth; no habilitan el correo de Supabase Auth.

## Usar Gmail de la escuela

La persona titular de la cuenta `elmundodelosnilos10@gmail.com` debe autorizar personalmente la integración. El código solicita únicamente el permiso `https://www.googleapis.com/auth/gmail.send`; Google lo clasifica como sensible y puede pedir verificación OAuth para el uso de producción. No compartas aquí la contraseña, el código de Google ni el token.

1. En Google Cloud Console, crea un proyecto, activa Gmail API y configura la pantalla de consentimiento OAuth. Para una cuenta Gmail personal, configura el tipo de usuario externo y agrega la cuenta escolar como usuario de prueba mientras se valida.
2. Crea credenciales OAuth de tipo aplicación web y registra temporalmente `https://developers.google.com/oauthplayground` como URI de redirección autorizado.
3. Abre [OAuth 2.0 Playground](https://developers.google.com/oauthplayground), activa **Use your own OAuth credentials**, y pega allí el Client ID y Client Secret. Solicita el alcance `https://www.googleapis.com/auth/gmail.send`, autoriza la cuenta escolar y cambia el código por tokens con acceso sin conexión. El playground elimina automáticamente sus tokens si no usas tus propias credenciales.
4. Copia el refresh token directamente en los secretos de entorno del Site. Configura:

   - `GMAIL_CLIENT_ID` — secreto del cliente OAuth.
   - `GMAIL_CLIENT_SECRET` — secreto del cliente OAuth.
   - `GMAIL_REFRESH_TOKEN` — token de actualización.
   - `GMAIL_SENDER_EMAIL` — `elmundodelosnilos10@gmail.com`.

5. Retira el URI temporal de OAuth Playground de las credenciales cuando termines y configura el consentimiento OAuth en producción según los requisitos de Google. En modo de pruebas de una aplicación externa, los refresh tokens que solicitan alcances como Gmail pueden caducar a los siete días; por eso no se debe dejar en pruebas una integración que se vaya a usar diariamente.
6. Dirección solicita un enlace de prueba y confirma que llega a la bandeja escolar. La pantalla solo ofrece esta función si la configuración está completa.

El portal renueva el token OAuth en el servidor y solicita a Gmail enviar un único correo al usuario que pidió recuperar su cuenta. Nunca registra ni muestra tokens o enlaces en el panel.

## Alternativa: Resend

Configura `RESEND_API_KEY` como secreto del Site y `EMAIL_FROM` con una dirección de un dominio que la escuela haya verificado en Resend. El correo remitente debe pertenecer a ese dominio. Si se configura una integración Gmail parcial, el portal no cambia silenciosamente a Resend.

## Configuración local

Usa `.env.example` como referencia; guarda las credenciales locales solo en `.dev.vars`, archivo ignorado por Git. No uses cuentas, alumnos ni destinatarios reales en las pruebas automatizadas. Consulta también [Pruebas y operación](pruebas-y-operacion.md).

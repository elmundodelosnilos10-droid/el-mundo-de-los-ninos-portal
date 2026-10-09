# El Mundo de los Niños

Plataforma escolar para dirección, docentes y familias, con el diseño institucional de la escuela.

## Aplicación

- Hosting: [Vercel](https://el-mundo-de-los-ninos-portal.vercel.app).
- Datos, autenticación y almacenamiento privado: Supabase.
- Clases virtuales: enlaces autorizados de Google Meet; las grabaciones requieren autorización.

## Desarrollo

Requiere Node.js 22.13 o posterior.

```sh
npm ci
cp .env.example .env.local
npm run dev:vercel
```

Completar únicamente las variables necesarias para el entorno elegido. Mantener las claves de servidor fuera de Git y de cualquier variable pública. No usar datos de alumnos para pruebas.

## Despliegue

La configuración del hosting está en `vercel.json`; Vercel ejecuta `npm run build:vercel`. Las variables de producción se configuran en Vercel, nunca en el repositorio. Conectar este repositorio privado al proyecto Vercel existente y usar `main` como rama de producción.

## Documentación

- [Estado de requisitos y pendientes](docs/estado-requisitos.md).
- [Hosting y configuración](docs/hosting-vercel.md).
- [Cuentas escolares](docs/cuentas-supabase.md).
- [Operación y pruebas](docs/pruebas-y-operacion.md).
- [Respaldo y restauración](docs/respaldo-supabase.md).
- [Servicio de revisión de archivos](docs/servicio-scanner-privado.md).

Las pruebas locales y la conexión de Realtime no sustituyen la aceptación completa en producción. Consultar el estado de requisitos antes de habilitar funciones pendientes.

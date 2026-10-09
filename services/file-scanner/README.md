# Private school file scanner

Node HTTP → ClamAV `clamd` INSTREAM, with FreshClam updates. Deployment source only: Docker images have not been built or run in this workspace. Tests use a synthetic daemon and do **not** prove antivirus detection.

See [deployment and verification notes](../../docs/servicio-scanner-privado.md).

Run local protocol tests from the repository root:

```sh
node --test tests/private-file-scanner.test.mjs tests/file-scanner.test.mjs
```

There is no production mock flag, sample token, persistent uploaded-file volume or antivirus bypass in this service.

# Distribución y mantenimiento de Brisa 1.0

## Alcance y requisitos

Brisa incluye una aplicación para Windows y una web instalable en el iPhone. El ejecutable contiene su propio motor: el usuario final no instala Node.js. Funciona en la red local sin cuentas, nube ni cuotas. No se integra con AirDrop. Licencia MIT.

- Windows 11 x64 (Intel/AMD). Hay configuración para compilar ARM64, que debe validarse en ese hardware antes de distribuirse.
- iPhone con Safari, apps web y soporte para compartir archivos. No necesitas Mac ni cuenta de desarrollador de Apple.
- Ambos equipos en la misma red de confianza, Windows encendido y espacio disponible para los archivos. Windows guarda una copia de cada envío; el iPhone necesita espacio temporal al guardar.

Los certificados locales son gratuitos. Los ejecutables no tienen firma comercial de editor: Windows puede mostrar un aviso. No desactives el antivirus; comprueba el origen del paquete y su SHA-256.

## Instalar y conectar

Abre `Brisa-Setup-1.0.0-x64.exe` para instalar por usuario, sin permisos de administrador. Alternativamente, abre `Brisa-Portable-1.0.0-x64.exe`: no instala accesos directos, pero conserva los datos en el perfil de Windows, no junto al ejecutable. Usa una modalidad a la vez.

Si el firewall pregunta, permite **Brisa en redes privadas**. Usa TCP 3210 para el panel local y la instalación del certificado, TCP 3211 para HTTPS y UDP 5353 para el nombre local mDNS. No abras puertos en el router ni expongas Brisa a Internet. Redes de invitados, VPN y aislamiento entre clientes pueden impedir la conexión. Si `.local` no resuelve, prueba la dirección alternativa que muestra el panel.

La X deja Brisa en la bandeja para mantener la conexión con el teléfono. Para detenerla usa **Salir de Brisa** desde su icono. No se instala inicio automático. Al cambiar de red, usa **Reiniciar conexión** en la bandeja, fuera de una transferencia activa.

### iPhone

1. Pulsa **Conectar iPhone** en Windows y escanea el QR con la cámara.
2. Instala el certificado de tu propia computadora siguiendo las instrucciones del teléfono y activa su confianza en Ajustes. No aceptes certificados de equipos desconocidos.
3. Abre Brisa en Safari, solicita vincular y aprueba el código coincidente en Windows.
4. Usa **Compartir → Añadir a pantalla de inicio** y, si aparece, **Abrir como app web**. Utiliza siempre ese icono.

iOS puede separar los datos de Safari y de la app de inicio: aprueba ese segundo acceso una vez si lo solicita. El vínculo no tiene renovación semanal. Puede perderse al borrar datos, cambiar la dirección de acceso o revocar el dispositivo. La autoridad local dura diez años; el certificado del servidor se renueva automáticamente al iniciar, conservando esa autoridad.

**Descargar** prepara el archivo dentro de Brisa y abre la hoja nativa para guardarlo en Archivos, Fotos u otra app compatible. Si la preparación tarda y iOS exige un nuevo toque, aparece **Guardar** en la misma fila. Cancelar la hoja conserva Brisa. No hay navegación a una página de descarga, diálogo intermedio ni aviso de entrega por guardar.

Mantén la app en primer plano: iOS puede suspenderla al bloquear el teléfono o cambiar de app. Los envíos por bloques pueden reanudarse seleccionando el mismo archivo; las descargas interrumpidas se preparan otra vez. Los archivos grandes usan almacenamiento temporal del navegador; cuando no está disponible, la alternativa en memoria se limita a 128 MiB. El espacio libre y lo que iOS permite compartir también limitan el guardado: no se promete un tamaño ilimitado. Se aceptan ZIP, no carpetas completas.

## Datos, respaldos y actualizaciones

| Ubicación | Contenido |
| --- | --- |
| `%LOCALAPPDATA%\Brisa\Data` | Archivos, pendientes, dispositivos, historial y certificados |
| `%LOCALAPPDATA%\Brisa\Profile` | Preferencias y sesión del escritorio |
| `%LOCALAPPDATA%\Brisa\Logs` | Registro de errores |

Los originales se guardan en `Data\files\<identificador>\<nombre original>`. **Abrir carpeta** los muestra en el Explorador; el identificador evita sobrescribir nombres repetidos. No hay limpieza automática. **Borrar historial** oculta registros para todos los dispositivos, conservando los archivos y la sesión actual. Si eliminas un archivo en el Explorador, su registro puede seguir apareciendo.

Para actualizar, sal desde la bandeja e instala la nueva versión o reemplaza el portátil. Los datos permanecen. No hay actualizaciones automáticas. La desinstalación también conserva los datos; si quieres borrarlos, respáldalos primero y elimina `%LOCALAPPDATA%\Brisa` manualmente.

Para respaldar, cierra Brisa y copia **toda** la carpeta `Data` a un lugar privado. Para restaurar, con Brisa cerrada, guarda una copia de los datos existentes y reemplaza `Data` por el respaldo completo. Contiene claves y autorizaciones: no la compartas ni la subas a GitHub. El instalador no incluye datos personales.

### Pasar de la versión del repositorio al ejecutable

`npm start` sigue usando `.brisa` en el repositorio. Antes de abrir el ejecutable por primera vez:

```powershell
npm.cmd run stop
npm.cmd run migrate -- --from "C:\ruta\Brisa\.brisa"
```

La migración copia a `%LOCALAPPDATA%\Brisa\Data`, conserva el origen y se niega a sobrescribir un destino existente. Cierra todos los servidores antes de migrar. Si ya abriste la app nueva, ciérrala y guarda su carpeta `Data` con otro nombre; no se combinan bibliotecas. La migración conserva nombre local, certificado y vinculaciones.

## Compilar y verificar

En Windows, instala Node.js 22 o posterior y Git. La primera compilación necesita Internet para descargar dependencias y herramientas gratuitas; el uso posterior es local.

```powershell
git clone https://github.com/SebasCH04/Brisa.git
cd Brisa
npm.cmd ci
npm.cmd test
npm.cmd run test:e2e
npm.cmd run dist:win
npm.cmd run test:package
node scripts/verify-package.mjs dist/Brisa-Portable-1.0.0-x64.exe
```

Las pruebas de navegador usan Microsoft Edge. Los ejecutables y `SHA256SUMS.txt` aparecen en `dist`. `npm run desktop` abre el escritorio desde el código; `npm start` conserva el modo de navegador. Comparten puertos: cierra uno antes de abrir el otro.

`npm run dist:win:arm64` genera ARM64; pruébalo en ese hardware antes de publicarlo. GitHub Actions genera ambas arquitecturas como artefactos y ejecuta pruebas en x64. No publica releases automáticamente. El archivo de bloqueo fija dependencias de npm, pero los tiempos y metadatos del empaquetado pueden cambiar los hashes entre compilaciones.

La prueba del paquete usa datos y puertos temporales; comprueba interfaz, aislamiento del renderer, vinculación HTTPS con validación del certificado y descarga con SHA-256. No modifica la biblioteca del usuario. Las pruebas de interfaz simulan la frontera de la hoja de compartir de iOS y no sustituyen una prueba física en el iPhone.

## Lista de publicación

- Actualiza la versión en `package.json` y la raíz de `package-lock.json`, además de `CHANGELOG.md`.
- Ejecuta las pruebas anteriores y `npm audit --omit=dev`. Revisa también `npm audit`: al preparar 1.0.0 hay avisos moderados en las herramientas de compilación derivados de `sprintf-js`, que no se distribuye con la app. No fuerces una degradación del empaquetador sin probarla.
- Prueba instalación, reapertura, bandeja, descarga, **Abrir carpeta** y actualización conservando datos.
- Prueba en un iPhone real el envío y guardado de foto, PDF, ZIP y vídeo grande desde el icono de inicio. Cancela la hoja de compartir, interrumpe la red y comprueba la recuperación.
- Revisa que los paquetes excluyan `.brisa`, perfiles, claves, datos de pruebas y dependencias de desarrollo.
- Crea una release en GitHub con notas, los dos `.exe` de cada arquitectura validada y `SHA256SUMS.txt`. Comprueba un archivo con `Get-FileHash .\Brisa-Setup-1.0.0-x64.exe -Algorithm SHA256`.

## Seguridad y soporte

El teléfono utiliza HTTPS y autorización persistente; Windows debe aprobar cada vinculación. El panel administrador solo admite HTTP desde loopback. Evita aplicaciones locales no confiables en el mismo usuario de Windows. Los dispositivos vinculados acceden a los archivos compartidos: revoca los que no reconozcas. Los datos en disco dependen de los permisos y cifrado de Windows; Brisa no añade cifrado al respaldo.

Para errores, abre un issue con versión, Windows/iOS y pasos para reproducirlos. No adjuntes claves, tokens ni archivos personales. Para fallos de seguridad usa el canal privado del repositorio, si está habilitado, antes de publicar detalles explotables. La licencia MIT no ofrece garantía; la app no sustituye un respaldo.

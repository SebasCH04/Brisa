# Brisa

**Tus archivos, de un lado al otro.** Transfiere entre Windows y iPhone por tu red local, sin nube, cuentas ni suscripciones. Gratis y de código abierto.

## Instalar en Windows

1. Descarga el instalador de [Releases](https://github.com/SebasCH04/Brisa/releases), cuando haya una versión publicada. Si aún no hay binarios, puedes compilarlos con los pasos de abajo.
2. Abre **Brisa-Setup-1.2.1-x64.exe**. También puedes usar **Brisa-Portable-1.2.1-x64.exe** sin instalar. Los ejecutables no necesitan Node.js.
3. Abre Brisa y permite su acceso a tu **red privada** si Windows lo solicita.

Requiere Windows 11; x64 corresponde a Intel/AMD. Los ejecutables no tienen firma comercial y Windows puede mostrar un aviso de editor desconocido. Comprueba su origen y SHA-256.

## Conectar el iPhone

1. Conecta ambos equipos a la misma red y pulsa **Conectar iPhone** en Windows.
2. Escanea el QR e instala el certificado de **tu computadora**, siguiendo las instrucciones del teléfono.
3. Abre Brisa en Safari, solicita vincular y aprueba el código coincidente en Windows.
4. Usa **Compartir → Añadir a pantalla de inicio** y abre ese icono. Si iOS pide otra vinculación para la app de inicio, apruébala una vez.

La vinculación se conserva sin renovaciones semanales. No necesitas Mac, App Store ni cuenta de desarrollador. Brisa usa su propia conexión local; no se integra con AirDrop.

## Transferir

- **Hacia el iPhone:** arrastra archivos a Brisa en Windows. En el teléfono pulsa **Descargar** y usa la hoja de iOS para guardarlos en Archivos o Fotos. Para archivos grandes puede aparecer **Guardar** al terminar de prepararlos.
- **Hacia Windows:** pulsa **Enviar a Windows** en el teléfono. Los archivos se guardan automáticamente; **Abrir carpeta** los muestra en el Explorador.
- **Esta sesión** muestra tu actividad actual; **Historial** conserva los registros. Borrar historial no elimina archivos.
- **Ajustes → Apariencia** permite elegir Claro, Oscuro o Sistema. La elección se guarda en cada dispositivo; Sistema sigue su modo automáticamente.
- En **Ajustes de Windows** puedes elegir la carpeta de nuevos archivos, activar el inicio en la bandeja con Windows y gestionar el almacenamiento. Eliminar pide confirmación; el ejecutable usa la papelera de Windows.

Mantén Windows encendido y la app del iPhone abierta durante la transferencia. La X de Windows deja Brisa en la bandeja: para detenerla elige **Salir de Brisa** desde su icono. Los datos se guardan en `%LOCALAPPDATA%\Brisa\Data` y se conservan al actualizar.

## Compilar desde el repositorio

En Windows con **Node.js 22+** y Git:

```powershell
git clone https://github.com/SebasCH04/Brisa.git
cd Brisa
npm.cmd ci
npm.cmd run dist:win
```

El instalador, portátil y hashes aparecen en `dist/`. Para ARM64 usa `npm run dist:win:arm64` y valida el resultado en ese hardware. GitHub Actions también genera los paquetes. Para desarrollar: `npm run desktop`. Pruebas: `npm test`, `npm run test:e2e` (Edge) y `npm run test:package` después de compilar.

**¿Usabas la versión anterior con Node?** Cierra el servidor anterior y migra `.brisa` antes de abrir el ejecutable: [migración y guía de producción](docs/PRODUCCION.md#pasar-de-la-versión-del-repositorio-al-ejecutable).

Consulta la [guía de producción](docs/PRODUCCION.md) para red, respaldos, actualización, límites de iOS, seguridad y publicación. [Cambios](CHANGELOG.md) · [Reportar un problema](https://github.com/SebasCH04/Brisa/issues) · [Licencia MIT](LICENSE).

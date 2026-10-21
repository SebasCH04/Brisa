# Cambios de Brisa

## 1.0.0

- Instalador y ejecutable portátil de Windows, sin instalar Node.js, con ventana propia y bandeja del sistema.
- Datos persistentes fuera de la instalación y migración desde `.brisa`, conservando archivos, certificados y vinculaciones.
- Apertura de carpetas mediante Windows, descargas con selector de destino y cierre controlado del servidor.
- Compilación x64/ARM64, hashes SHA-256, prueba del paquete y flujo de GitHub Actions.
- README abreviado y guía de producción con instalación del iPhone, respaldos, límites y publicación.
- Se conserva el guardado del iPhone mediante la hoja nativa de iOS, sin diálogo intermedio ni avisos por descargar.

## 0.2.3

- Se silencian los avisos de entrega asociados a descargas; se conservan los de envío y recepción.
- El guardado del iPhone usa la hoja de iOS sin ventana intermedia de Brisa. El progreso, errores y segundo toque cuando iOS lo exige aparecen en la fila del archivo.
- «Borrar historial» limpia los registros visibles en todos los dispositivos con confirmación de Brisa, sin eliminar archivos ni vaciar la sesión actual. Las transferencias nuevas vuelven a aparecer.

## 0.2.2

- Se reemplaza la navegación de descarga del iPhone por recepción dentro de Brisa y un botón «Guardar en Archivos» que invoca la hoja de iOS con el archivo real.
- El cuadro permite cancelar la recepción, reintentar errores y volver a Brisa. Cancelar la hoja de iOS conserva el archivo preparado para reintentar sin otra descarga.
- Se recibe en almacenamiento temporal privado cuando está disponible, con respaldo limitado en memoria y limpieza al cerrar. Los errores de red, espacio y compatibilidad permanecen dentro de Brisa.
- Se retira la confirmación nativa del navegador y se actualiza la caché de la interfaz.

## 0.2.1

- Se retiran la campana y su ventana de notificaciones; se conservan los avisos breves, el progreso, Esta sesión e Historial.
- Solo la descarga en iPhone utiliza una confirmación nativa y un enlace separado sin el atributo `download`, para evitar que la vista del archivo sustituya a Brisa.
- Las demás confirmaciones siguen usando los cuadros de Brisa.

## 0.2.0

- Se centra la «×» de los cuadros con un icono SVG y un botón consistente.
- Se añade una campana con avisos dentro de Brisa y progreso real de recepción y entrega, con recuperación de la conexión.
- «Esta sesión» conserva los archivos recientes al recargar; «Historial» reúne todos los archivos disponibles. Iniciar otra sesión no elimina archivos.
- Las confirmaciones de olvidar dispositivos y empezar una sesión utilizan cuadros de Brisa, sin `confirm()` del navegador.
- Se retira el aviso de cierre del navegador y se explica la reanudación dentro de la pantalla de transferencia.
- Se comprueban las entregas interrumpidas, las notificaciones en vivo, los rangos parciales y la privacidad de los avisos entre teléfonos.

## 0.1.1

- Windows dispone de una descarga real en cada archivo, además de abrir su carpeta.
- La apertura de carpetas utiliza el mecanismo de Windows para abrir una ventana normal, muestra progreso y comunica los errores.
- Los nombres largos, estados y acciones de transferencia se ajustan al ancho de iPhone. Se respetan las áreas de pantalla reservadas y se evita el zoom al escribir en campos.
- Los botones explican las dos direcciones: enviar al iPhone y enviar a Windows.
- El lanzador comprueba el repositorio y la versión del servidor activo.
- La caché de la interfaz se actualiza sin borrar la identidad del dispositivo.
- Las pruebas cubren descargas desde Windows, apertura de carpetas, archivos largos y anchos móviles de 320 a 430 píxeles, además del flujo de transferencia existente.

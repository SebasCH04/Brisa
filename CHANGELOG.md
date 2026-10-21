# Cambios de Brisa

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

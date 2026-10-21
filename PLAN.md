# Brisa: alcance acordado

- Nombre: **Brisa**.
- Equipos objetivo: Windows 11 e iPhone 17 Pro con iOS 27.
- Presupuesto: **cero**, sin membresía de Apple Developer ni renovación semanal.
- Formato elegido: aplicación local de Windows con interfaz web para iPhone, añadida a la pantalla de inicio.
- Transferencia directa por la red local, sin almacenamiento en nube y con HTTPS.
- Vinculación de dispositivos recordada, sin caducidad programada. El QR ayuda con la configuración inicial; no crea una sala temporal.
- Archivos cotidianos, fotos, videos y ZIP. No se requieren carpetas completas.
- Prioridades: conexión sencilla, integridad de archivos grandes, memoria acotada y recuperación de interrupciones.
- AirDrop nativo: no forma parte de la primera versión y no se promete interoperabilidad.

## Primera base

1. Panel de Windows con QR de configuración y aprobación del iPhone.
2. Identidad del servidor y de dispositivos persistente entre reinicios.
3. Nombre local por mDNS más alternativa IP para diagnóstico.
4. Envíos por bloques verificables y progreso guardado en disco.
5. Biblioteca compartida para descargar desde iPhone y ver recibidos en Windows.
6. Pruebas de autorización, reinicio, recuperación, integridad y navegador.

## Próximas pruebas con el usuario

1. Abrir Brisa en Windows y llegar a la configuración desde el iPhone.
2. Instalar el certificado, vincular y guardar el icono con el nombre estable.
3. Transferir una foto y un ZIP en ambos sentidos.
4. Cerrar y reabrir Brisa en ambos equipos, sin repetir la vinculación.
5. Probar un video de 1 GB o más, medir velocidad y luego interrumpir/reanudar una subida.
6. Probar el comportamiento al bloquear el iPhone y al cambiar la IP de Windows.

## Mejoras después de validar la conexión real

- Simplificar la configuración inicial según lo observado en iOS 27.
- Elegir carpeta de destino y gestionar archivos desde el panel.
- Empaquetar un ejecutable de Windows con bandeja e inicio automático opcional.
- Mostrar diagnóstico de red, uso de disco y tiempos de preparación/transferencia.
- Revisar el transporte si las mediciones muestran un cuello de botella.

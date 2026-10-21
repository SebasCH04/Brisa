# Brisa

Tus archivos, de un lado al otro. Primera base funcional para transferir archivos entre Windows y un iPhone por la red local, sin cuentas, suscripciones ni almacenamiento en la nube.

## Abrir en Windows

1. Instala **Node.js 22 o posterior** si no lo tienes. En esta computadora ya está disponible.
2. Abre **`Iniciar-Brisa.cmd`**. La primera instalación descarga bibliotecas gratuitas; las siguientes aperturas funcionan sin Internet.
3. Se abrirá el panel en **http://127.0.0.1:3210**. Puedes cerrar la ventana del navegador: el servidor continúa funcionando hasta abrir `Detener-Brisa.cmd` o apagar Windows.

También puedes ejecutar:

```powershell
npm.cmd ci
npm.cmd start
```

No se instala inicio automático ni se modifican las reglas del firewall automáticamente. Si Windows pregunta por acceso a la red, permite Node.js **en tu red privada de confianza**.

Si cambias de repositorio o actualizas Brisa, cierra el servidor anterior con `Detener-Brisa.cmd` y abre `Iniciar-Brisa.cmd` desde la carpeta nueva. El lanzador detecta si quedó abierta otra copia o versión, para evitar mostrar código anterior por error. Conserva la carpeta local `.brisa` para mantener archivos, certificados y vinculación; debe seguir excluida de Git.

## Conectar el iPhone la primera vez

1. Conecta el iPhone y Windows a la misma red. Windows también puede estar conectado por cable al router.
2. En el panel, pulsa **Conectar iPhone** y escanea el QR con la cámara.
3. Sigue las instrucciones para instalar el certificado local de Brisa y activar su confianza en Ajustes. La página detalla las rutas de iOS. Solo debes confiar en el certificado generado por tu propia computadora.
4. Pulsa **Abrir Brisa**, elige el nombre del teléfono y solicita la vinculación.
5. En Windows aparecerá una solicitud con un código. Comprueba que coincida con el código del iPhone y pulsa **Vincular dispositivo**.
6. En Safari, añade Brisa a la pantalla de inicio con **Compartir → Añadir a pantalla de inicio → Abrir como app web**.

Si el icono de inicio abre sin la autorización que tenías en Safari, aprueba ese acceso una vez en Windows. iOS puede separar el almacenamiento del navegador y el de una app web. Después, utiliza siempre el mismo icono.

**No hay renovación semanal ni caducidad programada del vínculo.** Se conserva al reiniciar Brisa o Windows. Puede perderse si eliminas sus datos del iPhone, borras `.brisa`, cambias de dirección de acceso o eliges olvidar el dispositivo. El certificado del servidor se renueva automáticamente al iniciar cuando corresponde, manteniendo la misma autoridad local. La autoridad tiene diez años de validez; no es una instalación de app con firma semanal.

## Transferir

- **Windows → iPhone:** arrastra o selecciona archivos en el panel de Windows. En el iPhone aparecerán en **Esta sesión** si Brisa ya estaba abierta, o en **Historial** si los preparaste antes de abrirla. Toca **Descargar**. Safari gestiona el guardado. Para imágenes, puedes guardarlas después en Fotos desde iOS.
- **iPhone → Windows:** abre Brisa en el teléfono y toca **Enviar a Windows**. Los archivos quedan guardados automáticamente en la computadora. En cada fila del panel de Windows puedes elegir **Descargar** para guardar otra copia o **Abrir carpeta** para ver la carpeta que contiene el archivo. El botón superior **Abrir carpeta** abre todos los recibidos.
- Se transfieren archivos originales sin convertirlos ni comprimirlos. Se admiten ZIP; no se extraen. No se admiten selecciones de carpetas como tales.
- Puedes pausar y reintentar envíos. Si recargas la página o reinicias Windows, aparecerán las transferencias pendientes. Elige de nuevo el archivo original: Brisa verifica las partes ya recibidas antes de continuar.
- Las descargas usan HTTP Range y ETag. Su reanudación depende del gestor de descargas de Safari; no hay una cola de descargas propia en esta versión.

Los archivos permanecen en **`.brisa/files/<identificador>/<nombre original>`**. Los identificadores permiten recibir dos archivos con el mismo nombre sin sobrescribirlos. Brisa almacena una copia de los archivos enviados desde Windows, por lo que debes tener espacio disponible para ella. No hay limpieza automática: elimina los archivos que no necesites desde el Explorador. Si eliminas uno manualmente, su registro todavía puede aparecer en la interfaz; la gestión de biblioteca queda para una siguiente versión.

## Esta sesión, historial y avisos

- **Esta sesión:** los archivos preparados o recibidos desde que abriste Brisa en esa pestaña, más archivos anteriores que descargues durante ella. Recargar conserva la sesión cuando el navegador permite guardar sus datos. **Nueva sesión** limpia esa vista y sus avisos, sin eliminar archivos.
- **Historial:** todos los archivos disponibles, incluidos los de sesiones anteriores. Se conserva en Windows al reiniciar el servidor.
- **Campana de notificaciones:** avisos dentro de Brisa sobre inicio de envío, archivo disponible, entrega en curso, entrega completada o interrumpida. Muestra los últimos 50 avisos de la sesión. Abrir la campana los marca como leídos.
- El progreso de recepción y entrega aparece en **En camino** y en la campana, con conexión en vivo y consulta periódica de respaldo. Un archivo preparado en Windows queda disponible para el iPhone; su entrega se anuncia cuando este lo descarga.
- Un aviso de entrega completada indica que Brisa terminó de enviar los datos al navegador. Safari o Windows controlan el guardado final. Una descarga por rangos se identifica como parcial.
- Las confirmaciones, como olvidar un dispositivo o empezar otra sesión, son cuadros de Brisa. Los selectores de archivos, el guardado y los permisos del sistema siguen perteneciendo a iOS o Windows.
- Mientras envías un archivo, la página recuerda mantener Brisa abierta. Cerrarla puede interrumpir el envío; no se muestra una confirmación propia del navegador y puedes reanudar seleccionando el original.

## Si el iPhone no conecta

1. Confirma que Windows esté encendido y Brisa esté funcionando. Abre otra vez `Iniciar-Brisa.cmd` si hace falta.
2. Comprueba que ambos dispositivos estén en la misma red y que no sea una red de invitados con aislamiento.
3. En **Conectar iPhone**, prueba otra dirección de la lista. El QR usa una IP para llegar a la configuración incluso si falla la resolución de nombres.
4. El acceso recomendado es **`https://brisa-<identificador>.local:3211`**. Este nombre se conserva al reiniciar y evita depender de una IP fija. Requiere que la red permita mDNS; debe comprobarse en tu router y en el iPhone real.
5. Si falla el nombre, la configuración ofrece una dirección IP alternativa. Si cambia la IP, esa dirección y su almacenamiento se consideran distintos; conviene recuperar el nombre estable antes de guardar el icono definitivo.
6. Si cambias de red con Brisa abierta, detén y vuelve a iniciar Brisa para actualizar las direcciones anunciadas y el certificado.
7. Si una VPN impide el tráfico local, revisa su configuración. Si el firewall bloquea Brisa, permite TCP 3210 y 3211 y UDP 5353 **solo para Node.js, red privada y subred local**. No abras puertos del router hacia Internet.

El puerto **3210** sirve el panel de Windows por loopback y la configuración pública del iPhone. No admite transferencias remotas sin cifrado. El puerto **3211** sirve la app y transferencias por HTTPS. El puerto UDP **5353** anuncia el nombre local.

## Privacidad y datos locales

- El iPhone necesita aprobación desde el panel local de Windows. Los códigos de solicitudes caducan a los diez minutos; los **dispositivos aprobados no caducan**.
- La identidad del iPhone se guarda en el navegador y en una cookie segura; Windows guarda su hash. Se puede revocar desde **Mis dispositivos**.
- HTTPS cifra las transferencias. Cada bloque de hasta 4 MiB se verifica con SHA-256 antes de confirmarlo; al finalizar se calcula el hash del archivo completo.
- Archivos y API requieren autorización. El panel de administración solo está disponible mediante loopback en Windows. Se verifican Host, Origin y encabezados de las solicitudes.
- La caché de la app web contiene únicamente su interfaz, sin archivos ni respuestas de la API. No hay analítica ni recursos de terceros en las páginas.
- `.brisa/certificates/root.key` es la clave privada de la autoridad local. Nunca se sirve por HTTP, ni se incluye en Git. Conserva `.brisa` en una cuenta de Windows protegida y no compartas esa carpeta.

## Qué falta validar y mejorar

- **Todavía hay que probarlo en el iPhone 17 Pro con iOS 27 y tu red real**, incluyendo instalación del certificado, mDNS, la pantalla de inicio y archivos de varios GB.
- Mantén Brisa abierta mientras envías archivos grandes. La app solicita mantener la pantalla activa si el navegador lo permite, pero no promete ejecutar subidas en segundo plano.
- Es un servidor local con lanzador para Windows, todavía no un `.exe` con bandeja del sistema ni un servicio de Windows.
- No aparece dentro de AirDrop, no busca dispositivos por Bluetooth, no funciona entre redes distintas y no tiene sincronización automática.
- Todavía no incluye selección de carpeta de destino, eliminación desde la interfaz ni aviso de espacio disponible.

## Desarrollo y pruebas

```powershell
npm.cmd ci
npm.cmd test
npx.cmd playwright test
```

Las pruebas de navegador usan Microsoft Edge instalado en Windows. Comprueban vinculación con dos contextos independientes, envío y descarga de archivos multibloque en ambos sentidos, recuperación de identidad al recargar y el diseño a tamaño de iPhone. Eso **no sustituye** una prueba en Safari real. Solo el navegador de pruebas omite la confianza del certificado temporal; la aplicación de uso real no desactiva la verificación TLS.

```powershell
npm.cmd run dev
```

Ejecuta el servidor en primer plano. Los registros del lanzador están en `.brisa/brisa.log`. Para regenerar los iconos a partir del SVG: `node scripts/icons.mjs`.

## Estructura

- `server.mjs`: servidores HTTP/HTTPS, autorización, API y descubrimiento mDNS.
- `lib/`: estado persistente, certificados y motor de transferencias.
- `public/`: interfaz responsive, configuración del iPhone y app web.
- `scripts/`: lanzador de Windows, cierre y generación de iconos.
- `test/`: pruebas de integración del servidor.
- `e2e/`: pruebas del flujo completo en el navegador.

El código de la aplicación y sus dependencias se ejecutan localmente. Esta primera base no registra servicios de pago ni publica el proyecto.

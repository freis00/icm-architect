# UCDM · Envío diario de lecciones y audios

Un script de Google Apps Script que, cada mañana, publica la lección del día (texto y audio):

- en un **canal privado de Telegram** (bot oficial, gratis), donde se puede escuchar y leer pero no reenviar, copiar ni descargar, y/o
- por **email** a una lista (Gmail personal: máximo 100 destinatarios al día, unas 90 personas).

Lee los audios de tu carpeta de Drive y los textos de una hoja de cálculo. No necesita servidor ni tener el ordenador encendido: corre en la nube de Google. Coste: 0 €.

## Cómo funciona

- Lección 1 = 17/10/2026. Cada día después, la siguiente. La víspera (16/10) envía la bienvenida si existe.
- Sale en la primera ejecución a partir de las 7:00 (hora de Madrid), es decir, entre las 7:00 y las 8:00.
- **Audio:** el archivo de la carpeta cuyo nombre contenga `lección N`. Valen `lección 9`, `lección 009`, `Leccion_9`. Si hay dos para la misma lección, gana el modificado más reciente.
- **Texto:** la fila de esa lección en la pestaña `Lecciones` (título y texto).
  - Si todo cabe junto al audio (1.024 caracteres), sale un solo mensaje: el audio con el texto debajo.
  - Si no cabe, primero el texto (con el título en negrita) y debajo el audio. Las lecciones de más de 4.000 caracteres se parten en varios mensajes, siempre por párrafos.
  - Sin texto, sale solo el audio con "Lección N".
- Cada lección se cierra con la línea de `PIE_MENSAJE` (a quién escribir las preguntas por privado).
- **Contenido protegido** (`PROTEGER_CONTENIDO`): se escucha y se lee en Telegram, pero no se puede reenviar, copiar ni guardar. No impide que alguien lo grabe con otro dispositivo.
- **Si falta el audio de hoy**, no envía nada, te avisa por email y lo reintenta cada hora: en cuanto lo subes, sale solo. Si falta el texto, sale el audio sin texto.
- **Cada día te avisa de lo que falta (audio o texto) de los próximos 7 días.**
- Nunca repite una lección ni un mensaje, aunque un envío falle a medias y se reintente.

## Instalación (todo desde el navegador, unos 30 minutos)

### 0. Ordena la carpeta de audios

1. Todos los audios dentro de la carpeta **UCDM Lecciones - Audios**. Ahora mismo las lecciones 19 a 22 están sueltas en "Mi unidad": muévelas dentro.
2. Sube también el audio de bienvenida (nombre con la palabra `bienvenida`).
3. Copia el ID de la carpeta: es lo que va después de `/folders/` en la dirección del navegador al abrirla.

### 1. Crea la hoja de cálculo y el script

1. Abre [sheets.new](https://sheets.new) y llama a la hoja `UCDM · Envío`.
2. Pestaña `Lecciones`: fila 1 = cabeceras (`n`, `título`, `texto`). Desde la fila 2, una fila por lección:
   - A = número de lección (13).
   - B = título (`Un mundo sin significado engendra temor.`). Puedes escribirlo con o sin "Lección 13." delante.
   - C = texto completo.
   - **Para pegar el texto: haz doble clic en la celda (o pulsa F2) y luego pega.** Si pegas con la celda solo seleccionada, Google Sheets reparte los párrafos en varias filas. Una celda admite el texto de cualquier lección.
3. Pestaña `Participantes` (solo si usas email): columna A = email, B = nombre. Fila 1 = cabeceras.
4. Menú **Extensiones > Apps Script**. Borra lo que haya y pega el contenido de `Code.gs`. Guarda (icono del disquete).
5. Arriba del todo, en `CONFIG`, pega el ID de la carpeta en `CARPETA_AUDIOS_ID`.

### 2. Crea el canal y el bot de Telegram

1. En Telegram: **Nuevo canal**, tipo **privado**, por ejemplo "UCDM · Lecciones". Crea otro igual llamado "UCDM · Pruebas" (solo tú).
2. En el canal de alumnos, **Editar**:
   - **Tipo de canal > Privado** y activa la opción de restringir el guardado de contenido (en inglés, *Restrict saving content*). Así también quedan protegidos los mensajes que publiques a mano.
   - **No vincules ningún grupo de debate**: el canal queda sin comentarios.
   - En **Enlaces de invitación**, crea el enlace con la opción de que los administradores aprueben a cada nuevo miembro (en inglés, *Request admin approval*). Si alguien reenvía el enlace, no entra nadie sin que tú lo apruebes.
3. Abre el chat con **@BotFather**, escribe `/newbot` y sigue los pasos. Te dará un **token** (algo como `123456:ABC...`). No lo compartas.
4. Añade el bot como **administrador** de los dos canales, con permiso para publicar mensajes.
5. En Apps Script: **Configuración del proyecto** (engranaje) **> Propiedades del script > Añadir propiedad**: nombre `TELEGRAM_TOKEN`, valor el token.
6. Publica cualquier mensaje en cada canal. En el editor, elige la función `buscarIdDelCanal` en el desplegable de arriba y pulsa **Ejecutar**. Abajo verás los ids (empiezan por `-100`).
7. Pega el id del canal de alumnos en `TELEGRAM_CANAL` y el de pruebas en `TELEGRAM_CANAL_PRUEBAS`. Guarda.

La primera vez que ejecutes algo, Google pedirá permisos y dirá "Google no ha verificado esta aplicación". Es tu propio script: **Configuración avanzada > Ir a ... (no seguro) > Permitir**.

### 3. Preguntas por privado

Los alumnos no pueden escribir en el canal. Las preguntas te llegan a tu Telegram personal:

1. Si no tienes nombre de usuario: **Ajustes > Nombre de usuario** y crea uno (por ejemplo `@facu_ucdm`).
2. **Ajustes > Privacidad y seguridad > Número de teléfono**: "¿Quién puede ver mi número?" = **Nadie**. Así te escriben por el usuario sin ver tu número.
3. En `CONFIG`, cambia `@tu_usuario` en `PIE_MENSAJE` por el tuyo. Ponlo también en la descripción del canal.

### 4. Comprueba, prueba y activa

Ejecuta, en este orden, desde el desplegable:

1. `comprobar`: no envía nada. Te dice cuántos audios y textos reconoce, hasta qué fecha cubren, huecos, duplicados y archivos que no entiende.
2. `probar`: envía `LECCION_PRUEBA` (por defecto la 1) al canal de pruebas, y a tu email si el email está activo. Para ver una lección con texto largo, pon por ejemplo `LECCION_PRUEBA: 13` y vuelve a ejecutar. **Comprueba en el móvil** que el audio se oye, que el texto se lee bien y que no te deja reenviarlo ni guardarlo.
3. `activar`: deja el envío automático en marcha. A partir de aquí solo tienes que subir audios y pegar textos.

Para pausar: `desactivar`. Para volver: `activar`.

### Email (opcional)

Pon `EMAIL_ACTIVO: true`, rellena la pestaña `Participantes` y ejecuta `comprobar` (te dirá cuántos emails ha leído). Cada día te llegará una copia a ti con los participantes en copia oculta. El email lleva el texto completo y el audio adjunto. Límite de Gmail personal: 100 destinatarios al día, así que sirve hasta unas 90 personas. El email no se puede proteger contra el reenvío.

## Día a día

- Sube el audio a la carpeta con un nombre que contenga `lección N` y pega el texto en la pestaña `Lecciones`. Nada más.
- Si te llega un email `[UCDM envío] ... sin completar ...`, te dice qué lecciones de la próxima semana no tienen audio o texto.
- Si no quieres avisos por textos que faltan, pon `AVISAR_SI_FALTA_TEXTO: false`.
- Para cambiar hora o fecha de inicio: edita `CONFIG` y guarda. No hace falta reactivar.
- Si alguien se une tarde, el canal guarda todas las lecciones anteriores: puede empezar desde la 1 a su ritmo.

## Permiso de la Foundation for Inner Peace

*Un curso de milagros*, incluida su traducción al español, tiene los derechos registrados por la Foundation for Inner Peace (FIP). Su política pide permiso por escrito para reproducir el texto del Curso.

- Política de permisos: [acim.org/permissions-policy](https://acim.org/permissions-policy/)
- Preguntas frecuentes: [acim.org/permissions-faqs](https://acim.org/permissions-faqs/)
- Formulario de solicitud: [acim.org/permission-form-2025](https://acim.org/permission-form-2025/)

Cuando te concedan el permiso, copia en `ATRIBUCION` la línea de crédito exacta que te indiquen. Se añade al final del texto de cada lección (solo cuando hay texto).

## Por qué no WhatsApp

A fecha de octubre de 2026 no hay forma de automatizar WhatsApp que sea gratis y oficial a la vez:

- La API oficial (WhatsApp Business Platform) cobra por mensaje enviado por iniciativa del negocio (en España, unos 0,025 $ por mensaje de utilidad y 0,06 $ de marketing) y no publica en Canales.
- Los bots no oficiales que manejan WhatsApp Web incumplen sus condiciones de uso y pueden acabar con tu número bloqueado.
- WhatsApp estaba probando mensajes programados en beta en 2026; si ya te aparece la opción, sirve para programar a mano, no para automatizar 365 días.

## Pruebas

`node pruebas/simular.js` imita Drive, Gmail, Hojas y Telegram. Simula 20 días hora a hora, con cambio de hora, fallos de Telegram a mitad de una lección y audios y textos que faltan, y comprueba el troceo de textos largos. Pásalo si tocas `Code.gs`.

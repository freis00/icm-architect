# UCDM · Envío diario de lecciones y audios

Un script de Google Apps Script que, cada mañana, publica la lección del día con su audio:

- en un **canal de Telegram** (bot oficial, gratis, sin límite práctico de suscriptores), y/o
- por **email** a una lista (Gmail personal: máximo 100 destinatarios al día, unas 90 personas).

Lee los audios directamente de tu carpeta de Drive. No necesita servidor ni tener el ordenador encendido: corre en la nube de Google. Coste: 0 €.

## Cómo funciona

- Lección 1 = 17/10/2026. Cada día después, la siguiente. La víspera (16/10) envía la bienvenida si existe.
- Sale en la primera ejecución a partir de las 7:00 (hora de Madrid), es decir, entre las 7:00 y las 8:00.
- El audio de cada día es el archivo de la carpeta cuyo nombre contenga `lección N`. Valen `lección 9`, `lección 009`, `Leccion_9`. Si hay dos para la misma lección, gana el modificado más reciente.
- **Si falta el audio de hoy**, no envía nada, te avisa por email y lo reintenta cada hora: en cuanto lo subes, sale solo.
- **Cada día te avisa si falta algún audio de los próximos 7 días**, para que nunca llegues al día sin él.
- Nunca envía dos veces la misma lección por el mismo canal.
- Cada lección lleva al final la línea de `PIE_MENSAJE` (por defecto, a quién escribir las preguntas por privado).

## Instalación (todo desde el navegador, unos 20 minutos)

### 0. Ordena la carpeta de audios

1. Todos los audios dentro de la carpeta **UCDM Lecciones - Audios**. Ahora mismo las lecciones 19 a 22 están sueltas en "Mi unidad": muévelas dentro.
2. Sube también el audio de bienvenida (nombre con la palabra `bienvenida`).
3. Copia el ID de la carpeta: es lo que va después de `/folders/` en la dirección del navegador al abrirla.

### 1. Crea la hoja de cálculo y el script

1. Abre [sheets.new](https://sheets.new) y llama a la hoja `UCDM · Envío`.
2. Crea dos pestañas (opcionales, pero recomendadas):
   - `Participantes`: columna A = email, columna B = nombre. Fila 1 = cabeceras. Solo hace falta si usas email.
   - `Lecciones`: columna A = número de lección, B = título, C = nota tuya. Fila 1 = cabeceras. Lo que pongas aquí acompaña al audio. Si una lección no tiene fila, sale solo "Lección N".
3. Menú **Extensiones > Apps Script**. Borra lo que haya y pega el contenido de `Code.gs`. Guarda (icono del disquete).
4. Arriba del todo, en `CONFIG`, pega el ID de la carpeta en `CARPETA_AUDIOS_ID`.

### 2. Crea el canal y el bot de Telegram

1. En Telegram: **Nuevo canal**, privado, por ejemplo "UCDM · Lecciones". Crea otro igual llamado "UCDM · Pruebas" (solo tú). No vincules ningún grupo de debate: así el canal queda sin comentarios, que es como viene por defecto.
2. Abre el chat con **@BotFather**, escribe `/newbot` y sigue los pasos. Te dará un **token** (algo como `123456:ABC...`). No lo compartas.
3. Añade el bot como **administrador** de los dos canales, con permiso para publicar mensajes.
4. En Apps Script: **Configuración del proyecto** (engranaje) **> Propiedades del script > Añadir propiedad**: nombre `TELEGRAM_TOKEN`, valor el token.
5. Publica cualquier mensaje en cada canal. En el editor, elige la función `buscarIdDelCanal` en el desplegable de arriba y pulsa **Ejecutar**. Abajo verás los ids (empiezan por `-100`).
6. Pega el id del canal de alumnos en `TELEGRAM_CANAL` y el de pruebas en `TELEGRAM_CANAL_PRUEBAS`. Guarda.

### Preguntas por privado

Los alumnos no pueden escribir en el canal. Las preguntas te llegan a tu Telegram personal:

1. Si no tienes nombre de usuario: **Ajustes > Nombre de usuario** y crea uno (por ejemplo `@facu_ucdm`).
2. **Ajustes > Privacidad y seguridad > Número de teléfono**: "¿Quién puede ver mi número?" = **Nadie**. Así te escriben por el usuario sin ver tu número.
3. En `CONFIG`, cambia `@tu_usuario` en `PIE_MENSAJE` por el tuyo. Esa línea va al final de cada lección. Ponla también en la descripción del canal.

La primera vez que ejecutes algo, Google pedirá permisos y dirá "Google no ha verificado esta aplicación". Es tu propio script: **Configuración avanzada > Ir a ... (no seguro) > Permitir**.

### 3. Comprueba, prueba y activa

Ejecuta, en este orden, desde el desplegable:

1. `comprobar`: no envía nada. Te dice cuántos audios reconoce, hasta qué fecha cubren, huecos, duplicados y archivos que no entiende.
2. `probar`: envía la lección 1 al canal de pruebas (y a tu email si el email está activo). Revisa que el audio se oye bien y el texto es el que quieres.
3. `activar`: deja el envío automático en marcha. A partir de aquí no tienes que hacer nada más que subir audios.

Para pausar: `desactivar`. Para volver: `activar`.

### Email (opcional)

Pon `EMAIL_ACTIVO: true`, rellena la pestaña `Participantes` y ejecuta `comprobar` (te dirá cuántos emails ha leído). Cada día te llegará una copia a ti con los participantes en copia oculta. Límite de Gmail personal: 100 destinatarios al día, así que sirve hasta unas 90 personas.

## Día a día

- Sube el audio a la carpeta con un nombre que contenga `lección N`. Nada más.
- Si te llega un email `[UCDM envío] Faltan ...`, tienes al menos un audio pendiente para la próxima semana.
- Para cambiar hora o fecha de inicio: edita `CONFIG` y guarda. No hace falta reactivar.
- Si alguien quiere unirse tarde, el canal de Telegram guarda todas las lecciones anteriores: puede empezar desde la 1 a su ritmo.

## Por qué no WhatsApp

A fecha de octubre de 2026 no hay forma de automatizar WhatsApp que sea gratis y oficial a la vez:

- La API oficial (WhatsApp Business Platform) cobra por mensaje enviado por iniciativa del negocio (en España, unos 0,025 $ por mensaje de utilidad y 0,06 $ de marketing) y no publica en Canales.
- Los bots no oficiales que manejan WhatsApp Web incumplen sus condiciones de uso y pueden acabar con tu número bloqueado.
- WhatsApp estaba probando mensajes programados en beta en 2026; si ya te aparece la opción, sirve para programar a mano, no para automatizar 365 días.

Si tu grupo vive en WhatsApp, úsalo para la conversación y pon allí el enlace al canal de Telegram.

## Antes de publicar: permiso de la Foundation for Inner Peace

La Foundation for Inner Peace (titular de los derechos de *Un curso de milagros*, incluida la traducción al español) exige **permiso por escrito para grabaciones de audio y vídeo** con texto del Curso, y responde a las solicitudes en unas dos semanas. Si tus audios leen la lección literal, o si quieres poner el texto de la lección en la pestaña `Lecciones`, pide el permiso en [acim.org/permissions-policy](https://acim.org/permissions-policy/) cuanto antes. Mientras tanto, lo prudente es que el texto que acompaña al audio sea tuyo (título breve y tu nota), no el de la lección.

## Pruebas

`node pruebas/simular.js` simula 20 días hora a hora (con cambio de hora, fallos de Telegram y audios que faltan) imitando Drive, Gmail y Telegram. Pásalo si tocas `Code.gs`.

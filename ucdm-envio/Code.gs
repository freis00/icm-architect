/**
 * UCDM · Envío diario de lecciones y audios (Google Apps Script, gratis).
 * Guía de instalación y uso: README.md
 *
 * Cada día, a partir de HORA_ENVIO, envía la lección que toca (lección 1 = FECHA_INICIO)
 * con su audio, tomado de la carpeta de Drive:
 *   - a un canal de Telegram, mediante un bot (API oficial, sin coste);
 *   - y/o por email a la pestaña "Participantes" (Gmail personal: máx. 100 destinatarios al día).
 * Si falta el audio de hoy no envía nada, te avisa por email y lo reintenta cada hora.
 * Una vez al día revisa que estén subidos los audios de los próximos DIAS_COLCHON días.
 */

const CONFIG = {
  FECHA_INICIO: '2026-10-17',     // día de la lección 1 (aaaa-mm-dd)
  ZONA: 'Europe/Madrid',
  HORA_ENVIO: 7,                  // sale en la primera ejecución a partir de esta hora (0-23)
  TOTAL_LECCIONES: 365,
  BIENVENIDA_DIA_ANTERIOR: true,  // la víspera envía el audio cuyo nombre contenga "bienvenida"
  DIAS_COLCHON: 7,                // aviso si falta algún audio de los próximos N días

  CARPETA_AUDIOS_ID: 'PEGA_AQUI_EL_ID_DE_LA_CARPETA',

  TELEGRAM_ACTIVO: true,
  TELEGRAM_CANAL: '',             // '@nombre_del_canal' si es público; '-100…' si es privado
  TELEGRAM_CANAL_PRUEBAS: '',     // canal o chat para probar sin molestar a nadie

  PIE_MENSAJE: 'Tus preguntas, por privado: @tu_usuario',  // va al final de cada lección; '' = sin pie

  EMAIL_ACTIVO: false,
  NOMBRE_REMITENTE: 'Facundo · UCDM',
  ADMIN_EMAIL: '',                // dónde llegan los avisos; vacío = la cuenta que instala el script
};

const MAX_CAPTION_TELEGRAM = 1024;
const OCULTOS_POR_CORREO = 49;    // Gmail admite 50 destinatarios por mensaje (incluido el "para")

// ---------------------------------------------------------------------------
// Funciones para ejecutar a mano desde el editor (desplegable de arriba)
// ---------------------------------------------------------------------------

/** Paso 1: revisa la configuración y lista qué audios hay. No envía nada. */
function comprobar() {
  const ignorados = [];
  const indice = indexarAudios_(ignorados);
  const numeros = Object.keys(indice).map(Number).filter(k => k >= 1).sort((a, b) => a - b);
  console.log(`Carpeta OK: ${numeros.length} lecciones con audio.`);

  const huecos = [];
  const ultima = numeros.length ? numeros[numeros.length - 1] : 0;
  for (let k = 1; k <= ultima; k++) if (!indice[k]) huecos.push(k);
  const seguidas = huecos.length ? huecos[0] - 1 : ultima;
  console.log(`Audios seguidos hasta la lección ${seguidas}` +
    (seguidas ? ` (cubre hasta el ${fechaDeLeccion_(seguidas)}).` : '.') +
    (huecos.length ? ` Huecos: ${huecos.join(', ')}.` : ''));

  if (CONFIG.BIENVENIDA_DIA_ANTERIOR && !indice[0]) {
    console.warn('No hay audio de bienvenida (un archivo cuyo nombre contenga "bienvenida").');
  }
  Object.keys(indice).forEach(k => {
    if (indice[k].length > 1) {
      console.warn(`${etiqueta_(Number(k))}: ${indice[k].length} audios. Se usará "${indice[k][0].getName()}" (el modificado más reciente).`);
    }
  });
  ignorados.forEach(nombre => console.warn(`Ignorado (no se reconoce el número de lección): ${nombre}`));

  if (CONFIG.TELEGRAM_ACTIVO) {
    const bot = llamarTelegram_('getMe');
    console.log(`Bot de Telegram OK: @${bot.username}`);
    if (!CONFIG.TELEGRAM_CANAL) console.warn('Falta TELEGRAM_CANAL. Ejecuta buscarIdDelCanal().');
  }
  if (CONFIG.EMAIL_ACTIVO) {
    console.log(`Participantes por email: ${leerParticipantes_().length}. ` +
      `Cuota de Gmail restante hoy: ${MailApp.getRemainingDailyQuota()} destinatarios.`);
  }

  const hoy = hoyLocal_(new Date());
  const n = numeroDeLeccion_(hoy);
  console.log(`Hoy (${hoy}) ${tocaEnviar_(n) ? 'toca la ' + etiqueta_(n) : 'no toca enviar nada'}. ` +
    `Lección 1 = ${CONFIG.FECHA_INICIO}, a partir de las ${CONFIG.HORA_ENVIO}:00 (${CONFIG.ZONA}).`);
  const activo = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'tick');
  console.log(activo ? 'Envío automático: ACTIVO.' : 'Envío automático: desactivado (ejecuta activar()).');
}

/** Paso 2: envía una lección al canal de pruebas y a tu email. No cuenta como enviada. */
function probar(n = 1) {
  const archivo = (indexarAudios_()[n] || [])[0];
  if (!archivo) throw new Error(`No hay audio para la ${etiqueta_(n)}.`);
  const texto = textoDeLeccion_(n);
  if (CONFIG.TELEGRAM_ACTIVO) {
    if (!CONFIG.TELEGRAM_CANAL_PRUEBAS) throw new Error('Rellena TELEGRAM_CANAL_PRUEBAS para probar Telegram.');
    enviarTelegram_(CONFIG.TELEGRAM_CANAL_PRUEBAS, n, archivo, texto);
    console.log(`Enviada la ${etiqueta_(n)} al canal de pruebas.`);
  }
  if (CONFIG.EMAIL_ACTIVO) {
    mandarCorreo_(adminEmail_(), [], n, archivo, texto);
    console.log(`Enviada la ${etiqueta_(n)} a ${adminEmail_()}.`);
  }
}

/** Paso 3: activa el envío automático (una ejecución por hora; envía una sola vez al día). */
function activar() {
  desactivar();
  ScriptApp.newTrigger('tick').timeBased().everyHours(1).create();
  comprobar();
}

/** Pausa el envío automático. */
function desactivar() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'tick')
    .forEach(t => ScriptApp.deleteTrigger(t));
}

/** Muestra el id de los chats y canales donde está el bot. Publica algo en el canal antes. */
function buscarIdDelCanal() {
  const vistos = {};
  llamarTelegram_('getUpdates').forEach(u => {
    const origen = u.channel_post || u.message || u.my_chat_member || u.edited_channel_post;
    const chat = origen && origen.chat;
    if (chat) vistos[chat.id] = `${chat.title || chat.username || chat.first_name} (${chat.type})`;
  });
  const ids = Object.keys(vistos);
  if (!ids.length) {
    console.warn('No aparece ningún canal. Comprueba que el bot es administrador, publica un mensaje en el canal y vuelve a ejecutar.');
  }
  ids.forEach(id => console.log(`${id}  →  ${vistos[id]}`));
}

// ---------------------------------------------------------------------------
// Envío automático
// ---------------------------------------------------------------------------

/** Lo ejecuta el disparador cada hora. */
function tick() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;
  try {
    ejecutar_(new Date());
  } finally {
    lock.releaseLock();
  }
}

function ejecutar_(ahora) {
  if (horaLocal_(ahora) < CONFIG.HORA_ENVIO) return;
  const hoy = hoyLocal_(ahora);
  const n = numeroDeLeccion_(hoy);
  const props = PropertiesService.getScriptProperties();
  let indice = null;
  const audios = () => indice || (indice = indexarAudios_());

  if (props.getProperty('colchon') !== hoy) {
    revisarColchon_(n, audios());
    props.setProperty('colchon', hoy);
  }

  if (!tocaEnviar_(n)) return;
  const pendientes = canalesActivos_().filter(canal => props.getProperty('enviado_' + canal) !== hoy);
  if (!pendientes.length) return;

  const archivo = (audios()[n] || [])[0];
  if (!archivo) {
    avisarUnaVez_(hoy, 'falta', `HOY falta el audio de la ${etiqueta_(n)}`,
      `No se ha enviado nada. Sube a la carpeta un audio cuyo nombre contenga "lección ${n}" ` +
      `y saldrá solo en la siguiente hora en punto.`);
    return;
  }

  const texto = textoDeLeccion_(n);
  pendientes.forEach(canal => {
    try {
      if (canal === 'telegram') enviarTelegram_(CONFIG.TELEGRAM_CANAL, n, archivo, texto);
      if (canal === 'email') enviarEmail_(leerParticipantes_(), n, archivo, texto);
      props.setProperty('enviado_' + canal, hoy);
    } catch (e) {
      avisarUnaVez_(hoy, 'error_' + canal, `Error enviando la ${etiqueta_(n)} por ${canal}`,
        `${e.message}\n\nSe reintenta cada hora hasta que salga.`);
    }
  });
}

function revisarColchon_(n, indice) {
  const desde = Math.max(n + 1, CONFIG.BIENVENIDA_DIA_ANTERIOR ? 0 : 1);
  const hasta = Math.min(n + CONFIG.DIAS_COLCHON, CONFIG.TOTAL_LECCIONES);
  const faltan = [];
  for (let k = desde; k <= hasta; k++) {
    if (!indice[k]) faltan.push(`- ${etiqueta_(k)} (sale el ${fechaDeLeccion_(k)})`);
  }
  if (faltan.length) {
    const cuantos = faltan.length === 1 ? 'Falta 1 audio' : `Faltan ${faltan.length} audios`;
    avisar_(`${cuantos} de los próximos ${CONFIG.DIAS_COLCHON} días`, faltan.join('\n'));
  }
}

function tocaEnviar_(n) {
  return (n >= 1 && n <= CONFIG.TOTAL_LECCIONES) || (n === 0 && CONFIG.BIENVENIDA_DIA_ANTERIOR);
}

function canalesActivos_() {
  return [CONFIG.TELEGRAM_ACTIVO && 'telegram', CONFIG.EMAIL_ACTIVO && 'email'].filter(Boolean);
}

// ---------------------------------------------------------------------------
// Fechas y nombres
// ---------------------------------------------------------------------------

function hoyLocal_(ahora) {
  return Utilities.formatDate(ahora, CONFIG.ZONA, 'yyyy-MM-dd');
}

function horaLocal_(ahora) {
  return Number(Utilities.formatDate(ahora, CONFIG.ZONA, 'H'));
}

function utcDeFecha_(ymd) {
  const [a, m, d] = ymd.split('-').map(Number);
  return Date.UTC(a, m - 1, d);
}

/** Lección que toca un día: 1 en FECHA_INICIO, 0 la víspera, negativa antes. */
function numeroDeLeccion_(ymd) {
  return Math.round((utcDeFecha_(ymd) - utcDeFecha_(CONFIG.FECHA_INICIO)) / 86400000) + 1;
}

function fechaDeLeccion_(n) {
  const fecha = new Date(utcDeFecha_(CONFIG.FECHA_INICIO) + (n - 1) * 86400000);
  return Utilities.formatDate(fecha, 'UTC', 'dd/MM/yyyy');
}

/** "UCDM - lección 018.m4a" → 18; "UCDM - lección 9.m4a" → 9; "UCDM - bienvenida.m4a" → 0. */
function numeroEnNombre_(nombre) {
  const plano = nombre.normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/bienvenida/i.test(plano)) return 0;
  const m = plano.match(/leccion\D{0,4}(\d{1,3})(?!\d)/i);
  return m ? Number(m[1]) : null;
}

function etiqueta_(n) {
  return n === 0 ? 'bienvenida' : `lección ${n}`;
}

// ---------------------------------------------------------------------------
// Drive y hoja de cálculo
// ---------------------------------------------------------------------------

function esAudio_(archivo) {
  return /^audio\//.test(archivo.getMimeType()) || /\.(m4a|mp3|aac|ogg|oga|opus|wav)$/i.test(archivo.getName());
}

/** nº de lección → audios de la carpeta, el modificado más reciente primero. */
function indexarAudios_(ignorados) {
  const indice = {};
  const archivos = DriveApp.getFolderById(CONFIG.CARPETA_AUDIOS_ID).getFiles();
  while (archivos.hasNext()) {
    const archivo = archivos.next();
    if (archivo.isTrashed() || !esAudio_(archivo)) continue;
    const n = numeroEnNombre_(archivo.getName());
    if (n === null || n > CONFIG.TOTAL_LECCIONES) {
      if (ignorados) ignorados.push(archivo.getName());
      continue;
    }
    (indice[n] = indice[n] || []).push(archivo);
  }
  Object.keys(indice).forEach(k => indice[k].sort((a, b) => b.getLastUpdated() - a.getLastUpdated()));
  return indice;
}

function blobDeAudio_(n, archivo) {
  const extension = (archivo.getName().match(/\.\w+$/) || ['.m4a'])[0];
  const nombre = n === 0 ? 'UCDM - Bienvenida' : `UCDM - Lección ${String(n).padStart(3, '0')}`;
  return archivo.getBlob().setName(nombre + extension);
}

function pestana_(nombre) {
  const libro = SpreadsheetApp.getActiveSpreadsheet();
  return libro ? libro.getSheetByName(nombre) : null;
}

/** Texto que acompaña al audio: cabecera + título y nota de la pestaña "Lecciones" + PIE_MENSAJE. */
function textoDeLeccion_(n) {
  const hoja = pestana_('Lecciones');
  const fila = hoja ? hoja.getDataRange().getValues().find(f => Number(f[0]) === n && f[0] !== '') : null;
  const cabecera = n === 0 ? 'Bienvenida' : `Lección ${n}`;
  const partes = [cabecera].concat(fila ? [fila[1], fila[2]] : []).map(String).filter(s => s.trim());
  const pie = CONFIG.PIE_MENSAJE ? '\n\n' + CONFIG.PIE_MENSAJE : '';
  return partes.join('\n\n').slice(0, MAX_CAPTION_TELEGRAM - pie.length) + pie;
}

/** Emails de la pestaña "Participantes": columna A, desde la fila 2. */
function leerParticipantes_() {
  const hoja = pestana_('Participantes');
  if (!hoja) throw new Error('Falta la pestaña "Participantes" en la hoja de cálculo del script.');
  const emails = hoja.getDataRange().getValues().slice(1)
    .map(f => String(f[0]).trim().toLowerCase())
    .filter(e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
  return Array.from(new Set(emails));
}

// ---------------------------------------------------------------------------
// Canales
// ---------------------------------------------------------------------------

function llamarTelegram_(metodo, payload) {
  const token = PropertiesService.getScriptProperties().getProperty('TELEGRAM_TOKEN');
  if (!token) throw new Error('Falta TELEGRAM_TOKEN en Configuración del proyecto > Propiedades del script.');
  const resp = UrlFetchApp.fetch(`https://api.telegram.org/bot${token}/${metodo}`, {
    method: 'post',
    payload: payload || {},
    muteHttpExceptions: true,
  });
  const datos = JSON.parse(resp.getContentText());
  if (!datos.ok) throw new Error(`Telegram ${metodo}: ${datos.description}`);
  return datos.result;
}

function enviarTelegram_(chatId, n, archivo, texto) {
  if (!chatId) throw new Error('Falta el id del canal de Telegram.');
  llamarTelegram_('sendAudio', {
    chat_id: String(chatId),
    audio: blobDeAudio_(n, archivo),
    title: n === 0 ? 'Bienvenida' : `Lección ${n}`,
    performer: CONFIG.NOMBRE_REMITENTE,
    caption: texto,
  });
}

function enviarEmail_(destinatarios, n, archivo, texto) {
  if (!destinatarios.length) return;
  const correos = Math.ceil(destinatarios.length / OCULTOS_POR_CORREO);
  const necesarios = destinatarios.length + correos;
  const quedan = MailApp.getRemainingDailyQuota();
  if (necesarios > quedan) {
    throw new Error(`Cuota de Gmail insuficiente: hacen falta ${necesarios} destinatarios y quedan ${quedan} hoy.`);
  }
  for (let i = 0; i < destinatarios.length; i += OCULTOS_POR_CORREO) {
    mandarCorreo_(adminEmail_(), destinatarios.slice(i, i + OCULTOS_POR_CORREO), n, archivo, texto);
  }
}

function mandarCorreo_(para, ocultos, n, archivo, texto) {
  const mensaje = {
    to: para,
    subject: `UCDM · ${n === 0 ? 'Bienvenida' : 'Lección ' + n}`,
    body: texto,
    name: CONFIG.NOMBRE_REMITENTE,
    attachments: [blobDeAudio_(n, archivo)],
  };
  if (ocultos.length) mensaje.bcc = ocultos.join(',');
  MailApp.sendEmail(mensaje);
}

// ---------------------------------------------------------------------------
// Avisos al administrador
// ---------------------------------------------------------------------------

function adminEmail_() {
  return CONFIG.ADMIN_EMAIL || Session.getEffectiveUser().getEmail();
}

function avisar_(asunto, cuerpo) {
  MailApp.sendEmail(adminEmail_(), `[UCDM envío] ${asunto}`, cuerpo);
}

function avisarUnaVez_(hoy, clave, asunto, cuerpo) {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('aviso_' + clave) === hoy) return;
  avisar_(asunto, cuerpo);
  props.setProperty('aviso_' + clave, hoy);
}

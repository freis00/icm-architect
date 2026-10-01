/**
 * UCDM · Envío diario de lecciones y audios (Google Apps Script, gratis).
 * Guía de instalación y uso: README.md
 *
 * Cada día, a partir de HORA_ENVIO, publica la lección que toca (lección 1 = FECHA_INICIO):
 * el texto de la pestaña "Lecciones" (si lo hay) y el audio de la carpeta de Drive.
 *   - En un canal de Telegram, mediante un bot (API oficial, sin coste). Si el texto es largo,
 *     va antes del audio en uno o varios mensajes. Con PROTEGER_CONTENIDO se escucha y se lee,
 *     pero no se puede reenviar, copiar ni descargar.
 *   - Y/o por email a la pestaña "Participantes" (Gmail personal: máx. 100 destinatarios al día).
 * Si falta el audio de hoy no envía nada, te avisa por email y lo reintenta cada hora.
 * Una vez al día te avisa de lo que falta (audio o texto) de los próximos DIAS_COLCHON días.
 */

const CONFIG = {
  FECHA_INICIO: '2026-10-17',     // día de la lección 1 (aaaa-mm-dd)
  ZONA: 'Europe/Madrid',
  HORA_ENVIO: 7,                  // sale en la primera ejecución a partir de esta hora (0-23)
  TOTAL_LECCIONES: 365,
  BIENVENIDA_DIA_ANTERIOR: true,  // la víspera envía el audio cuyo nombre contenga "bienvenida"
  DIAS_COLCHON: 7,                // aviso si falta algo de los próximos N días
  AVISAR_SI_FALTA_TEXTO: true,    // el aviso incluye lecciones sin texto en la pestaña "Lecciones"

  CARPETA_AUDIOS_ID: 'PEGA_AQUI_EL_ID_DE_LA_CARPETA',

  TELEGRAM_ACTIVO: true,
  TELEGRAM_CANAL: '',             // id del canal privado: '-100…' (ver buscarIdDelCanal)
  TELEGRAM_CANAL_PRUEBAS: '',     // canal o chat para probar sin molestar a nadie
  LECCION_PRUEBA: 1,              // la que envía probar()
  PROTEGER_CONTENIDO: true,       // se escucha y se lee, pero no se reenvía, copia ni descarga

  PIE_MENSAJE: 'Tus preguntas, por privado: @tu_usuario',  // cierra cada lección; '' = sin pie
  ATRIBUCION: '',                 // cuando la FIP dé permiso: la línea de crédito que te indiquen

  EMAIL_ACTIVO: false,
  NOMBRE_REMITENTE: 'Facundo · UCDM',
  ADMIN_EMAIL: '',                // dónde llegan los avisos; vacío = la cuenta que instala el script
};

const MAX_CAPTION_TELEGRAM = 1024;  // texto que acompaña a un audio
const MAX_MENSAJE_TELEGRAM = 4000;  // Telegram admite 4096 por mensaje; margen por si hay emojis
const OCULTOS_POR_CORREO = 49;      // Gmail admite 50 destinatarios por mensaje (incluido el "para")

// ---------------------------------------------------------------------------
// Funciones para ejecutar a mano desde el editor (desplegable de arriba)
// ---------------------------------------------------------------------------

/** Paso 1: revisa la configuración, los audios y los textos. No envía nada. */
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

  const lecciones = leerLecciones_();
  const conTexto = Object.keys(lecciones).map(Number).filter(k => lecciones[k].texto).sort((a, b) => a - b);
  console.log(conTexto.length
    ? `Pestaña "Lecciones": ${conTexto.length} lecciones con texto (de la ${conTexto[0]} a la ${conTexto[conTexto.length - 1]}).`
    : 'Pestaña "Lecciones": ninguna lección con texto. Saldrán solo con el audio.');

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

/** Paso 2: envía LECCION_PRUEBA al canal de pruebas y a tu email. No cuenta como enviada. */
function probar(n = CONFIG.LECCION_PRUEBA) {
  const archivo = (indexarAudios_()[n] || [])[0];
  if (!archivo) throw new Error(`No hay audio para la ${etiqueta_(n)}.`);
  const contenido = contenidoDeLeccion_(n);
  if (CONFIG.TELEGRAM_ACTIVO) {
    if (!CONFIG.TELEGRAM_CANAL_PRUEBAS) throw new Error('Rellena TELEGRAM_CANAL_PRUEBAS para probar Telegram.');
    enviarTelegram_(CONFIG.TELEGRAM_CANAL_PRUEBAS, n, archivo, contenido);
    console.log(`Enviada la ${etiqueta_(n)} al canal de pruebas (${planTelegram_(contenido).textos.length + 1} mensajes).`);
  }
  if (CONFIG.EMAIL_ACTIVO) {
    mandarCorreo_(adminEmail_(), [], n, archivo, contenido);
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
  let lecciones = null;
  const audios = () => indice || (indice = indexarAudios_());
  const textos = () => lecciones || (lecciones = leerLecciones_());

  if (props.getProperty('colchon') !== hoy) {
    revisarColchon_(n, audios(), textos());
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

  const contenido = contenidoDeLeccion_(n, textos());
  pendientes.forEach(canal => {
    try {
      if (canal === 'telegram') enviarTelegram_(CONFIG.TELEGRAM_CANAL, n, archivo, contenido, progresoDeHoy_(props, hoy));
      if (canal === 'email') enviarEmail_(leerParticipantes_(), n, archivo, contenido);
      props.setProperty('enviado_' + canal, hoy);
    } catch (e) {
      avisarUnaVez_(hoy, 'error_' + canal, `Error enviando la ${etiqueta_(n)} por ${canal}`,
        `${e.message}\n\nSe reintenta cada hora, sin repetir los mensajes que ya salieron.`);
    }
  });
}

/** Cuántos mensajes de la lección de hoy han salido ya por Telegram, para no repetirlos al reintentar. */
function progresoDeHoy_(props, hoy) {
  return {
    leer: () => {
      const [dia, enviados] = (props.getProperty('telegram_partes') || '').split('|');
      return dia === hoy ? Number(enviados) : 0;
    },
    guardar: enviados => props.setProperty('telegram_partes', `${hoy}|${enviados}`),
  };
}

function revisarColchon_(n, indice, lecciones) {
  const desde = Math.max(n + 1, CONFIG.BIENVENIDA_DIA_ANTERIOR ? 0 : 1);
  const hasta = Math.min(n + CONFIG.DIAS_COLCHON, CONFIG.TOTAL_LECCIONES);
  const lineas = [];
  for (let k = desde; k <= hasta; k++) {
    const falta = [];
    if (!indice[k]) falta.push('audio');
    if (CONFIG.AVISAR_SI_FALTA_TEXTO && k >= 1 && !(lecciones[k] && lecciones[k].texto)) falta.push('texto');
    if (falta.length) lineas.push(`- ${etiqueta_(k)} (sale el ${fechaDeLeccion_(k)}): falta ${falta.join(' y ')}`);
  }
  if (lineas.length) {
    const cuantas = lineas.length === 1 ? '1 lección' : `${lineas.length} lecciones`;
    avisar_(`${cuantas} sin completar en los próximos ${CONFIG.DIAS_COLCHON} días`, lineas.join('\n'));
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

function sinAcentos_(texto) {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** "UCDM - lección 018.m4a" → 18; "UCDM - lección 9.m4a" → 9; "UCDM - bienvenida.m4a" → 0. */
function numeroEnNombre_(nombre) {
  const plano = sinAcentos_(nombre);
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

/** Pestaña "Lecciones": A = nº de lección, B = título, C = texto. Devuelve nº → {titulo, texto}. */
function leerLecciones_() {
  const lecciones = {};
  const hoja = pestana_('Lecciones');
  if (!hoja) return lecciones;
  hoja.getDataRange().getValues().forEach(fila => {
    if (fila[0] === '' || isNaN(Number(fila[0]))) return;
    lecciones[Number(fila[0])] = {
      titulo: String(fila[1]).trim(),
      texto: String(fila[2]).replace(/\r\n?/g, '\n').trim(),
    };
  });
  return lecciones;
}

/** Lo que se publica de una lección: cabecera, texto (con la atribución) y pie. */
function contenidoDeLeccion_(n, lecciones) {
  const fila = (lecciones || leerLecciones_())[n] || {};
  return {
    cabecera: cabecera_(n, fila.titulo),
    texto: fila.texto ? [fila.texto, CONFIG.ATRIBUCION].filter(Boolean).join('\n\n') : '',
    pie: CONFIG.PIE_MENSAJE || '',
  };
}

/** "Lección 13. Un mundo sin significado engendra temor." (admite el título con o sin "Lección 13."). */
function cabecera_(n, titulo) {
  if (n === 0) return titulo || 'Bienvenida';
  if (!titulo) return `Lección ${n}`;
  return /^leccion\s*\d/i.test(sinAcentos_(titulo)) ? titulo : `Lección ${n}. ${titulo}`;
}

function textoPlano_(contenido) {
  return [contenido.cabecera, contenido.texto, contenido.pie].filter(Boolean).join('\n\n');
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
// Telegram
// ---------------------------------------------------------------------------

/**
 * Mensajes de Telegram de una lección. Si todo cabe en el pie del audio, sale un solo mensaje.
 * Si no, el texto va antes en uno o varios mensajes y el audio cierra con el pie.
 */
function planTelegram_(contenido) {
  const plano = textoPlano_(contenido);
  if (plano.length <= MAX_CAPTION_TELEGRAM) {
    return { textos: [], pieAudio: conCabeceraEnNegrita_(plano, contenido.cabecera) };
  }
  const cuerpo = [contenido.cabecera, contenido.texto].filter(Boolean).join('\n\n');
  return {
    textos: trocear_(cuerpo, MAX_MENSAJE_TELEGRAM)
      .map((trozo, i) => (i === 0 ? conCabeceraEnNegrita_(trozo, contenido.cabecera) : escaparHtml_(trozo))),
    pieAudio: escaparHtml_(contenido.pie),
  };
}

/** Parte un texto en trozos de `max` caracteres como mucho: por párrafos y, si no basta, por frases. */
function trocear_(texto, max) {
  const trozos = [];
  let actual = '';
  const cerrar = () => {
    if (actual.trim()) trozos.push(actual.trim());
    actual = '';
  };
  texto.split('\n').forEach(linea => {
    while (linea.length > max) {
      const corte = puntoDeCorte_(linea, max);
      cerrar();
      trozos.push(linea.slice(0, corte).trim());
      linea = linea.slice(corte).trim();
    }
    if (actual && actual.length + 1 + linea.length > max) cerrar();
    actual = actual ? `${actual}\n${linea}` : linea;
  });
  cerrar();
  return trozos;
}

function puntoDeCorte_(linea, max) {
  const finDeFrase = linea.lastIndexOf('. ', max - 1);
  if (finDeFrase > max / 2) return finDeFrase + 1;
  const espacio = linea.lastIndexOf(' ', max);
  return espacio > 0 ? espacio : max;
}

function escaparHtml_(texto) {
  return texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function conCabeceraEnNegrita_(texto, cabecera) {
  if (!cabecera || !texto.startsWith(cabecera)) return escaparHtml_(texto);
  return `<b>${escaparHtml_(cabecera)}</b>${escaparHtml_(texto.slice(cabecera.length))}`;
}

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

/** Publica la lección: texto (si no cabe junto al audio) y audio. `progreso` evita repetir al reintentar. */
function enviarTelegram_(chatId, n, archivo, contenido, progreso) {
  if (!chatId) throw new Error('Falta el id del canal de Telegram.');
  const plan = planTelegram_(contenido);
  const comun = { chat_id: String(chatId), protect_content: String(CONFIG.PROTEGER_CONTENIDO) };

  const envios = plan.textos.map(html => () => llamarTelegram_('sendMessage', Object.assign({
    text: html,
    parse_mode: 'HTML',
    link_preview_options: JSON.stringify({ is_disabled: true }),
  }, comun)));
  envios.push(() => {
    const audio = Object.assign({
      audio: blobDeAudio_(n, archivo),
      title: n === 0 ? 'Bienvenida' : `Lección ${n}`,
      performer: CONFIG.NOMBRE_REMITENTE,
    }, comun);
    if (plan.pieAudio) Object.assign(audio, { caption: plan.pieAudio, parse_mode: 'HTML' });
    llamarTelegram_('sendAudio', audio);
  });

  for (let i = progreso ? progreso.leer() : 0; i < envios.length; i++) {
    envios[i]();
    if (progreso) progreso.guardar(i + 1);
  }
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

function enviarEmail_(destinatarios, n, archivo, contenido) {
  if (!destinatarios.length) return;
  const correos = Math.ceil(destinatarios.length / OCULTOS_POR_CORREO);
  const necesarios = destinatarios.length + correos;
  const quedan = MailApp.getRemainingDailyQuota();
  if (necesarios > quedan) {
    throw new Error(`Cuota de Gmail insuficiente: hacen falta ${necesarios} destinatarios y quedan ${quedan} hoy.`);
  }
  for (let i = 0; i < destinatarios.length; i += OCULTOS_POR_CORREO) {
    mandarCorreo_(adminEmail_(), destinatarios.slice(i, i + OCULTOS_POR_CORREO), n, archivo, contenido);
  }
}

function mandarCorreo_(para, ocultos, n, archivo, contenido) {
  const mensaje = {
    to: para,
    subject: `UCDM · ${n === 0 ? 'Bienvenida' : 'Lección ' + n}`,
    body: textoPlano_(contenido),
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

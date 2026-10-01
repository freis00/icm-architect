// Simulación de Code.gs con imitaciones de los servicios de Apps Script. Ejecutar: node pruebas/simular.js
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const codigo = fs.readFileSync(require('path').join(__dirname, '..', 'Code.gs'), 'utf8');

function crearEntorno(opciones = {}) {
  const estado = {
    ahora: new Date('2026-10-05T10:00:00Z'),
    props: {},
    archivos: [],
    telegram: [],     // {metodo, payload, ahora}
    correos: [],      // {msg, ahora}
    usadosHoy: {},    // fecha UTC → destinatarios usados
    fallosAudio: 0,   // próximos sendAudio que fallan
    triggers: [],
    hojas: opciones.hojas || {},
  };
  const fmt = (date, tz, patron) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
    }).formatToParts(date).map(x => [x.type, x.value]));
    if (patron === 'yyyy-MM-dd') return `${p.year}-${p.month}-${p.day}`;
    if (patron === 'dd/MM/yyyy') return `${p.day}/${p.month}/${p.year}`;
    if (patron === 'H') return String(Number(p.hour));
    throw new Error('patrón no soportado ' + patron);
  };
  const diaCuota = () => estado.ahora.toISOString().slice(0, 10);
  const ctx = {
    console: { log() {}, warn() {} },
    Utilities: { formatDate: fmt },
    DriveApp: {
      getFolderById(id) {
        assert.strictEqual(id, 'CARPETA');
        let i = 0;
        const lista = estado.archivos.slice();
        return { getFiles: () => ({ hasNext: () => i < lista.length, next: () => lista[i++] }) };
      },
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => (k in estado.props ? estado.props[k] : null),
        setProperty: (k, v) => { estado.props[k] = String(v); },
      }),
    },
    UrlFetchApp: {
      fetch(url, opts) {
        const metodo = url.split('/').pop();
        assert.ok(url.startsWith('https://api.telegram.org/botTOKEN/'), url);
        if (metodo === 'sendMessage') assert.ok(opts.payload.text.replace(/<\/?b>/g, '').length <= 4096, 'mensaje > 4096');
        if (metodo === 'sendAudio' && opts.payload.caption) {
          assert.ok(opts.payload.caption.replace(/<\/?b>/g, '').length <= 1024, 'pie > 1024');
        }
        if (metodo === 'sendAudio' && estado.fallosAudio > 0) {
          estado.fallosAudio--;
          return { getContentText: () => JSON.stringify({ ok: false, description: 'Too Many Requests' }) };
        }
        estado.telegram.push({ metodo, payload: opts.payload, ahora: estado.ahora });
        return { getContentText: () => JSON.stringify({ ok: true, result: { username: 'ucdm_bot' } }) };
      },
    },
    MailApp: {
      sendEmail(a, b, c) {
        const msg = typeof a === 'object' ? a : { to: a, subject: b, body: c };
        const n = 1 + (msg.bcc ? msg.bcc.split(',').length : 0);
        assert.ok(n <= 50, 'más de 50 destinatarios en un correo');
        const d = diaCuota();
        estado.usadosHoy[d] = (estado.usadosHoy[d] || 0) + n;
        assert.ok(estado.usadosHoy[d] <= 100, 'cuota diaria superada');
        estado.correos.push({ msg, ahora: estado.ahora });
      },
      getRemainingDailyQuota: () => 100 - (estado.usadosHoy[diaCuota()] || 0),
    },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'admin@example.com' }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: nombre => (estado.hojas[nombre]
          ? { getDataRange: () => ({ getValues: () => estado.hojas[nombre] }) }
          : null),
      }),
    },
    ScriptApp: {
      getProjectTriggers: () => estado.triggers,
      deleteTrigger: t => { estado.triggers = estado.triggers.filter(x => x !== t); },
      newTrigger: f => ({ timeBased: () => ({ everyHours: () => ({ create: () => estado.triggers.push({ getHandlerFunction: () => f }) }) }) }),
    },
  };
  vm.createContext(ctx);
  vm.runInContext(codigo + `
    CONFIG.CARPETA_AUDIOS_ID = 'CARPETA';
    CONFIG.TELEGRAM_CANAL = '-1001';
    CONFIG.TELEGRAM_CANAL_PRUEBAS = '-1002';
    CONFIG.EMAIL_ACTIVO = ${!!opciones.email};
    CONFIG.AVISAR_SI_FALTA_TEXTO = ${opciones.avisarTexto !== false};
    CONFIG.PIE_MENSAJE = 'Preguntas: @facu';
    this.api = { CONFIG, ejecutar_, numeroDeLeccion_, numeroEnNombre_, hoyLocal_, horaLocal_, contenidoDeLeccion_,
                 planTelegram_, trocear_, cabecera_, fechaDeLeccion_, leerParticipantes_, indexarAudios_,
                 comprobar, probar, activar, tick };
  `, ctx);
  estado.props.TELEGRAM_TOKEN = 'TOKEN';
  return { api: ctx.api, estado };
}

let modificado = 0;
function audio(nombre, extra = {}) {
  const fecha = new Date(Date.UTC(2026, 8, 1) + (modificado++) * 60000);
  return {
    getName: () => nombre,
    getMimeType: () => extra.mime || 'audio/mp4',
    isTrashed: () => !!extra.papelera,
    getLastUpdated: () => extra.fecha || fecha,
    getBlob: () => ({ nombre: null, setName(n) { this.nombre = n; return this; } }),
  };
}

// Texto inventado con la forma de una lección real: 6 párrafos numerados, ~2.700 caracteres.
const FRASE = 'Esta es una frase de prueba que ocupa sitio como lo haría el texto de una lección. ';
const LECCION_LARGA = Array.from({ length: 6 }, (_, i) => `${i + 1}. ${FRASE.repeat(5).trim()}`).join('\n');

// 1. Numeración de lecciones (incluye cambio de hora del 25/10/2026)
{
  const { api } = crearEntorno();
  const casos = { '2026-10-10': -6, '2026-10-16': 0, '2026-10-17': 1, '2026-10-25': 9, '2026-10-26': 10,
    '2027-03-28': 163, '2027-10-16': 365, '2027-10-17': 366 };
  for (const [f, n] of Object.entries(casos)) assert.strictEqual(api.numeroDeLeccion_(f), n, f);
  assert.strictEqual(api.hoyLocal_(new Date('2026-10-16T23:30:00Z')), '2026-10-17');  // 01:30 en Madrid
  assert.strictEqual(api.horaLocal_(new Date('2026-10-26T06:10:00Z')), 7);             // horario de invierno
  assert.strictEqual(api.horaLocal_(new Date('2026-10-24T05:10:00Z')), 7);             // horario de verano
  assert.strictEqual(api.fechaDeLeccion_(1), '17/10/2026');
  assert.strictEqual(api.fechaDeLeccion_(365), '16/10/2027');
  console.log('OK numeración y zona horaria');
}

// 2. Reconocer el número en el nombre del archivo
{
  const { api } = crearEntorno();
  const casos = {
    'UCDM - lección 018.m4a': 18,
    'UCDM - lección 9.m4a': 9,
    'UCDM - lecci\u006F\u0301n 21.m4a': 21,   // acento descompuesto (iPhone/Mac)
    'UCDM - LECCIÓN 365.mp3': 365,
    'Leccion_120 final.m4a': 120,
    'UCDM - bienvenida.m4a': 0,
    'lección 1234.m4a': null,
    'notas de voz.m4a': null,
  };
  for (const [nombre, n] of Object.entries(casos)) assert.strictEqual(api.numeroEnNombre_(nombre), n, nombre);
  console.log('OK nombres de archivo');
}

// 3. Cabecera, texto largo, troceo y formato
{
  const { api } = crearEntorno();
  assert.strictEqual(api.cabecera_(13, 'Un mundo sin significado engendra temor.'), 'Lección 13. Un mundo sin significado engendra temor.');
  assert.strictEqual(api.cabecera_(13, 'Lección 13. Un mundo sin significado engendra temor.'), 'Lección 13. Un mundo sin significado engendra temor.');
  assert.strictEqual(api.cabecera_(13, 'LECCION 13 - Un mundo'), 'LECCION 13 - Un mundo');
  assert.strictEqual(api.cabecera_(13, ''), 'Lección 13');
  assert.strictEqual(api.cabecera_(0, ''), 'Bienvenida');

  // Corto: un solo mensaje (el audio con todo en el pie)
  const corto = api.planTelegram_({ cabecera: 'Lección 3. Título', texto: 'Mi nota <breve> & clara', pie: 'Preguntas: @facu' });
  assert.strictEqual(corto.textos.length, 0);
  assert.strictEqual(corto.pieAudio, '<b>Lección 3. Título</b>\n\nMi nota &lt;breve&gt; &amp; clara\n\nPreguntas: @facu');

  // Como el ejemplo de la lección 13 (~2.700 caracteres): texto en un mensaje y luego el audio con el pie
  assert.ok(LECCION_LARGA.length > 2500 && LECCION_LARGA.length < 3000);
  const medio = api.planTelegram_({ cabecera: 'Lección 13. Un mundo sin significado engendra temor.', texto: LECCION_LARGA, pie: 'Preguntas: @facu' });
  assert.strictEqual(medio.textos.length, 1);
  assert.ok(medio.textos[0].startsWith('<b>Lección 13. Un mundo sin significado engendra temor.</b>\n\n1. Esta es'));
  assert.ok(medio.textos[0].endsWith(FRASE.trim()));
  assert.strictEqual(medio.pieAudio, 'Preguntas: @facu');

  // Muy largo (~9.000): varios mensajes de 4.000 como mucho, cortando por párrafos, sin perder texto
  const muyLargo = Array.from({ length: 20 }, (_, i) => `${i + 1}. ${FRASE.repeat(5).trim()}`).join('\n\n');
  const trozos = api.trocear_('Lección 99\n\n' + muyLargo, 4000);
  assert.ok(trozos.length >= 3);
  trozos.forEach(t => assert.ok(t.length <= 4000));
  assert.strictEqual(trozos.join(' ').replace(/\s+/g, ' '), ('Lección 99 ' + muyLargo).replace(/\s+/g, ' '));
  assert.ok(trozos.every(t => /^\d+\. |^Lección/.test(t)), 'cada trozo empieza en un párrafo');

  // Un párrafo gigante sin saltos de línea: corta al final de una frase
  const parrafo = FRASE.repeat(120).trim();
  const partes = api.trocear_(parrafo, 4000);
  assert.ok(partes.length >= 3);
  partes.forEach(t => assert.ok(t.length <= 4000 && t.endsWith('.')));
  assert.strictEqual(partes.join(' '), parrafo);

  // Atribución: solo si hay texto
  api.CONFIG.ATRIBUCION = 'Extractos de Un curso de milagros. Usado con permiso. https://acim.org';
  const conTexto = api.contenidoDeLeccion_(3, { 3: { titulo: 'T', texto: 'Texto' } });
  assert.strictEqual(conTexto.texto, 'Texto\n\nExtractos de Un curso de milagros. Usado con permiso. https://acim.org');
  assert.strictEqual(api.contenidoDeLeccion_(4, { 4: { titulo: 'T', texto: '' } }).texto, '');
  api.CONFIG.ATRIBUCION = '';
  console.log('OK texto largo, troceo y formato');
}

// 4. Simulación hora a hora del 9 al 28 de octubre con Telegram + email
{
  const participantes = [['email', 'nombre']];
  for (let i = 0; i < 60; i++) participantes.push([`p${i}@example.com`, `P${i}`]);
  participantes.push(['P0@EXAMPLE.com', 'duplicado'], ['no-es-email', 'x'], ['', '']);
  const { api, estado } = crearEntorno({
    email: true,
    avisarTexto: false,
    hojas: {
      Participantes: participantes,
      Lecciones: [['n', 'titulo', 'texto'], [3, 'Título de prueba', 'Nota de Facundo'], ['', '', ''],
        [5, 'Un mundo de prueba.', LECCION_LARGA]],
    },
  });
  assert.strictEqual(api.leerParticipantes_().length, 60);

  estado.archivos.push(audio('UCDM - bienvenida.m4a'));
  for (let k = 1; k <= 10; k++) estado.archivos.push(audio(`UCDM - lección ${String(k).padStart(3, '0')}.m4a`));
  const viejo9 = audio('UCDM - lección 9.m4a', { fecha: new Date(Date.UTC(2026, 0, 1)) });
  estado.archivos.push(viejo9, audio('UCDM - lección 4.m4a', { papelera: true, fecha: new Date(Date.UTC(2027, 0, 1)) }));
  estado.archivos.push(audio('portada.jpg', { mime: 'image/jpeg' }));
  assert.strictEqual(api.indexarAudios_()[9][0].getName(), 'UCDM - lección 009.m4a');
  assert.strictEqual(api.indexarAudios_()[4].length, 1);

  const inicio = Date.UTC(2026, 9, 9, 0, 7);
  const fin = Date.UTC(2026, 9, 29, 0, 7);
  for (let t = inicio; t < fin; t += 3600000) {
    estado.ahora = new Date(t);
    if (t === Date.UTC(2026, 9, 21, 5, 7)) estado.fallosAudio = 2;   // el 21/10 (lección 5, texto largo) el audio falla 2 veces
    if (t === Date.UTC(2026, 9, 27, 11, 7)) estado.archivos.push(audio('UCDM - lección 11.m4a'));  // sube tarde el 27/10
    api.ejecutar_(estado.ahora);
  }

  const audios = estado.telegram.filter(x => x.metodo === 'sendAudio');
  const dias = audios.map(x => api.hoyLocal_(x.ahora));
  assert.deepStrictEqual(dias, ['2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21',
    '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27'], 'un audio por día');
  assert.deepStrictEqual(audios.map(x => x.payload.title),
    ['Bienvenida'].concat(Array.from({ length: 11 }, (_, i) => `Lección ${i + 1}`)));
  audios.forEach(x => {
    assert.strictEqual(x.payload.chat_id, '-1001');
    assert.strictEqual(x.payload.protect_content, 'true');
  });
  assert.strictEqual(audios[1].payload.audio.nombre, 'UCDM - Lección 001.m4a');
  assert.strictEqual(audios[0].payload.audio.nombre, 'UCDM - Bienvenida.m4a');
  assert.strictEqual(audios[3].payload.caption, '<b>Lección 3. Título de prueba</b>\n\nNota de Facundo\n\nPreguntas: @facu');
  assert.strictEqual(audios[2].payload.caption, '<b>Lección 2</b>\n\nPreguntas: @facu');

  // Lección 5: un mensaje de texto antes del audio, y no se repite aunque el audio falle dos veces
  const textos = estado.telegram.filter(x => x.metodo === 'sendMessage');
  assert.strictEqual(textos.length, 1);
  assert.strictEqual(api.hoyLocal_(textos[0].ahora), '2026-10-21');
  assert.ok(textos[0].payload.text.startsWith('<b>Lección 5. Un mundo de prueba.</b>\n\n1. Esta es'));
  assert.strictEqual(textos[0].payload.protect_content, 'true');
  assert.strictEqual(textos[0].payload.parse_mode, 'HTML');
  assert.strictEqual(JSON.parse(textos[0].payload.link_preview_options).is_disabled, true);
  assert.strictEqual(audios[5].payload.caption, 'Preguntas: @facu');
  const orden = estado.telegram.filter(x => api.hoyLocal_(x.ahora) === '2026-10-21').map(x => x.metodo);
  assert.deepStrictEqual(orden, ['sendMessage', 'sendAudio']);

  // Hora de salida: 7:xx en Madrid (salvo reintentos)
  assert.deepStrictEqual(audios.map(x => api.horaLocal_(x.ahora)), [7, 7, 7, 7, 7, 9, 7, 7, 7, 7, 7, 12]);

  // Email: un envío diario a 60 personas en 2 correos (49 + 11), con el texto completo, sin duplicar el día del fallo
  const lecciones = estado.correos.filter(c => !c.msg.subject.startsWith('[UCDM envío]'));
  assert.strictEqual(lecciones.length, 12 * 2);
  assert.ok(lecciones.every(c => c.msg.to === 'admin@example.com' && c.msg.attachments.length === 1));
  assert.deepStrictEqual(lecciones.slice(0, 2).map(c => c.msg.bcc.split(',').length), [49, 11]);
  const correo5 = lecciones.find(c => c.msg.subject === 'UCDM · Lección 5');
  assert.strictEqual(correo5.msg.body, `Lección 5. Un mundo de prueba.\n\n${LECCION_LARGA}\n\nPreguntas: @facu`);

  const avisos = estado.correos.filter(c => c.msg.subject.startsWith('[UCDM envío]'));
  const resumen = avisos.map(c => `${api.hoyLocal_(c.ahora)} ${c.msg.subject}`);
  assert.strictEqual(resumen.filter(s => s.includes('Error enviando')).length, 1);
  assert.deepStrictEqual(resumen.filter(s => s.includes('HOY falta')), [
    '2026-10-27 [UCDM envío] HOY falta el audio de la lección 11',
    '2026-10-28 [UCDM envío] HOY falta el audio de la lección 12']);
  const colchon = resumen.filter(s => s.includes('sin completar'));
  assert.strictEqual(colchon[0], '2026-10-20 [UCDM envío] 1 lección sin completar en los próximos 7 días');
  assert.strictEqual(new Set(colchon.map(s => s.slice(0, 10))).size, colchon.length);
  assert.ok(!resumen.some(s => s.startsWith('2026-10-09')));
  console.log('OK simulación de 20 días');
}

// 5. Aviso de lo que falta, audio y texto
{
  const { api, estado } = crearEntorno({
    hojas: { Lecciones: [['n', 'titulo', 'texto'], [1, 'A', 'Texto 1'], [2, 'B', 'Texto 2'], [3, 'C', '']] },
  });
  estado.archivos.push(audio('UCDM - bienvenida.m4a'));
  for (let k = 1; k <= 3; k++) estado.archivos.push(audio(`UCDM - lección ${k}.m4a`));
  estado.ahora = new Date('2026-10-16T05:30:00Z');  // 7:30 del 16/10, día de la bienvenida
  api.ejecutar_(estado.ahora);
  const aviso = estado.correos.find(c => c.msg.subject.includes('sin completar'));
  assert.strictEqual(aviso.msg.subject, '[UCDM envío] 5 lecciones sin completar en los próximos 7 días');
  assert.strictEqual(aviso.msg.body, [
    '- lección 3 (sale el 19/10/2026): falta texto',
    '- lección 4 (sale el 20/10/2026): falta audio y texto',
    '- lección 5 (sale el 21/10/2026): falta audio y texto',
    '- lección 6 (sale el 22/10/2026): falta audio y texto',
    '- lección 7 (sale el 23/10/2026): falta audio y texto'].join('\n'));
  console.log('OK aviso de audios y textos pendientes');
}

// 6. Fin del ciclo: el día 366 no envía nada
{
  const { api, estado } = crearEntorno({ avisarTexto: false });
  estado.archivos.push(audio('UCDM - lección 365.m4a'));
  estado.ahora = new Date('2027-10-16T06:30:00Z'); api.ejecutar_(estado.ahora);
  estado.ahora = new Date('2027-10-17T06:30:00Z'); api.ejecutar_(estado.ahora);
  const envios = estado.telegram.filter(x => x.metodo === 'sendAudio');
  assert.strictEqual(envios.length, 1);
  assert.strictEqual(envios[0].payload.title, 'Lección 365');
  console.log('OK fin del ciclo');
}

// 7. probar() va al canal de pruebas y no marca nada como enviado; activar() deja un solo disparador
{
  const { api, estado } = crearEntorno({
    email: true,
    hojas: { Participantes: [['email']], Lecciones: [['n', 'titulo', 'texto'], [13, 'Un mundo de prueba.', LECCION_LARGA]] },
  });
  estado.archivos.push(audio('UCDM - lección 001.m4a'), audio('UCDM - lección 013.m4a'));
  api.probar();
  assert.deepStrictEqual(estado.telegram.map(x => x.metodo), ['sendAudio']);
  api.CONFIG.LECCION_PRUEBA = 13;
  api.probar();
  assert.deepStrictEqual(estado.telegram.map(x => x.metodo), ['sendAudio', 'sendMessage', 'sendAudio']);
  estado.telegram.forEach(x => assert.strictEqual(x.payload.chat_id, '-1002'));
  assert.strictEqual(estado.correos.length, 2);
  assert.ok(estado.correos.every(c => !c.msg.bcc));
  assert.ok(!Object.keys(estado.props).some(k => k.startsWith('enviado_') || k === 'telegram_partes'));
  api.activar(); api.activar();
  assert.strictEqual(estado.triggers.length, 1);
  console.log('OK probar() y activar()');
}

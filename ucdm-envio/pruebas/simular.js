// Simulación de Code.gs con imitaciones de los servicios de Apps Script. Ejecutar: node pruebas/simular.js
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const codigo = fs.readFileSync(require('path').join(__dirname, '..', 'Code.gs'), 'utf8');

function crearEntorno(opciones) {
  const estado = {
    ahora: null,
    props: {},
    archivos: [],
    telegram: [],     // {metodo, payload, ahora}
    correos: [],      // {msg, ahora}
    usadosHoy: {},    // fecha UTC → destinatarios usados
    fallosTelegram: 0,
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
        if (metodo === 'sendAudio' && estado.fallosTelegram > 0) {
          estado.fallosTelegram--;
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
    CONFIG.PIE_MENSAJE = 'Preguntas: @facu';
    this.api = { CONFIG, ejecutar_, numeroDeLeccion_, numeroEnNombre_, hoyLocal_, horaLocal_, textoDeLeccion_,
                 fechaDeLeccion_, leerParticipantes_, indexarAudios_, comprobar, probar, activar, tick };
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

// 1. Numeración de lecciones (incluye cambio de hora del 25/10/2026)
{
  const { api } = crearEntorno({});
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
  const { api } = crearEntorno({});
  const casos = {
    'UCDM - lección 018.m4a': 18,
    'UCDM - lección 9.m4a': 9,
    'UCDM - lección 21.m4a': 21,   // acento descompuesto (iPhone/Mac)
    'UCDM - LECCIÓN 365.mp3': 365,
    'Leccion_120 final.m4a': 120,
    'UCDM - bienvenida.m4a': 0,
    'lección 1234.m4a': null,
    'notas de voz.m4a': null,
  };
  for (const [nombre, n] of Object.entries(casos)) assert.strictEqual(api.numeroEnNombre_(nombre), n, nombre);
  console.log('OK nombres de archivo');
}

// 3. Simulación hora a hora del 9 al 28 de octubre con Telegram + email
{
  const participantes = [['email', 'nombre']];
  for (let i = 0; i < 60; i++) participantes.push([`p${i}@example.com`, `P${i}`]);
  participantes.push(['P0@EXAMPLE.com', 'duplicado'], ['no-es-email', 'x'], ['', '']);
  const { api, estado } = crearEntorno({
    email: true,
    hojas: {
      Participantes: participantes,
      Lecciones: [['n', 'titulo', 'nota'], [3, 'Título de prueba', 'Nota de Facundo'], ['', '', ''],
        [7, 'Larga', 'x'.repeat(2000)]],
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
  assert.strictEqual(api.textoDeLeccion_(3), 'Lección 3\n\nTítulo de prueba\n\nNota de Facundo\n\nPreguntas: @facu');
  assert.strictEqual(api.textoDeLeccion_(5), 'Lección 5\n\nPreguntas: @facu');
  assert.strictEqual(api.textoDeLeccion_(0), 'Bienvenida\n\nPreguntas: @facu');
  const larga = api.textoDeLeccion_(7);
  assert.strictEqual(larga.length, 1024);
  assert.ok(larga.endsWith('\n\nPreguntas: @facu'));
  api.CONFIG.PIE_MENSAJE = '';
  assert.strictEqual(api.textoDeLeccion_(5), 'Lección 5');
  api.CONFIG.PIE_MENSAJE = 'Preguntas: @facu';

  const inicio = Date.UTC(2026, 9, 9, 0, 7);
  const fin = Date.UTC(2026, 9, 29, 0, 7);
  for (let t = inicio; t < fin; t += 3600000) {
    estado.ahora = new Date(t);
    if (t === Date.UTC(2026, 9, 20, 5, 7)) estado.fallosTelegram = 2;   // Telegram falla 2 veces el 20/10
    if (t === Date.UTC(2026, 9, 27, 11, 7)) estado.archivos.push(audio('UCDM - lección 11.m4a'));  // sube tarde el 27/10
    api.ejecutar_(estado.ahora);
  }

  const envios = estado.telegram.filter(x => x.metodo === 'sendAudio');
  const dias = envios.map(x => api.hoyLocal_(x.ahora));
  assert.deepStrictEqual(dias, ['2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21',
    '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27'], 'un envío por día');
  assert.deepStrictEqual(envios.map(x => x.payload.title),
    ['Bienvenida'].concat(Array.from({ length: 11 }, (_, i) => `Lección ${i + 1}`)));
  envios.forEach(x => assert.strictEqual(x.payload.chat_id, '-1001'));
  assert.strictEqual(envios[1].payload.audio.nombre, 'UCDM - Lección 001.m4a');
  assert.strictEqual(envios[0].payload.audio.nombre, 'UCDM - Bienvenida.m4a');

  // Hora de salida: 7:xx en Madrid (salvo reintentos)
  const horas = envios.map(x => api.horaLocal_(x.ahora));
  assert.deepStrictEqual(horas, [7, 7, 7, 7, 9, 7, 7, 7, 7, 7, 7, 12]);

  // Email: un envío diario a 60 personas en 2 correos (49 + 11), sin duplicar el día del fallo de Telegram
  const lecciones = estado.correos.filter(c => !c.msg.subject.startsWith('[UCDM envío]'));
  assert.strictEqual(lecciones.length, 12 * 2);
  assert.ok(lecciones.every(c => c.msg.to === 'admin@example.com' && c.msg.attachments.length === 1));
  assert.deepStrictEqual(lecciones.slice(0, 2).map(c => c.msg.bcc.split(',').length), [49, 11]);

  const avisos = estado.correos.filter(c => c.msg.subject.startsWith('[UCDM envío]'));
  const resumen = avisos.map(c => `${api.hoyLocal_(c.ahora)} ${c.msg.subject}`);
  // Error de Telegram del 20/10: un solo aviso aunque falle dos veces
  assert.strictEqual(resumen.filter(s => s.includes('Error enviando')).length, 1);
  // Falta la 11 el 27/10: un solo aviso, y sale cuando aparece el audio
  assert.deepStrictEqual(resumen.filter(s => s.includes('HOY falta')), ['2026-10-27 [UCDM envío] HOY falta el audio de la lección 11',
    '2026-10-28 [UCDM envío] HOY falta el audio de la lección 12']);
  // Colchón: avisa desde que la 11 entra en la ventana de 7 días (20/10), una vez al día
  const colchon = resumen.filter(s => s.includes('de los próximos'));
  assert.strictEqual(colchon[0].slice(0, 10), '2026-10-20');
  assert.strictEqual(new Set(colchon.map(s => s.slice(0, 10))).size, colchon.length);
  // Antes del 10/10 la ventana aún no llega a la bienvenida (16/10): nada que avisar el 9/10
  assert.ok(!resumen.some(s => s.startsWith('2026-10-09')));
  console.log('OK simulación de 20 días');
  console.log(resumen.join('\n'));
}

// 4. Fin del ciclo: el día 366 no envía nada
{
  const { api, estado } = crearEntorno({});
  estado.archivos.push(audio('UCDM - lección 365.m4a'));
  estado.ahora = new Date('2027-10-16T06:30:00Z'); api.ejecutar_(estado.ahora);
  estado.ahora = new Date('2027-10-17T06:30:00Z'); api.ejecutar_(estado.ahora);
  const envios = estado.telegram.filter(x => x.metodo === 'sendAudio');
  assert.strictEqual(envios.length, 1);
  assert.strictEqual(envios[0].payload.title, 'Lección 365');
  console.log('OK fin del ciclo');
}

// 5. probar() va al canal de pruebas y no marca nada como enviado; activar() deja un solo disparador
{
  const { api, estado } = crearEntorno({ email: true, hojas: { Participantes: [['email']] } });
  estado.archivos.push(audio('UCDM - lección 001.m4a'));
  estado.ahora = new Date('2026-10-05T10:00:00Z');
  api.probar();
  const envio = estado.telegram.find(x => x.metodo === 'sendAudio');
  assert.strictEqual(envio.payload.chat_id, '-1002');
  assert.strictEqual(estado.correos.length, 1);
  assert.ok(!estado.correos[0].msg.bcc);
  assert.ok(!Object.keys(estado.props).some(k => k.startsWith('enviado_')));
  api.activar(); api.activar();
  assert.strictEqual(estado.triggers.length, 1);
  console.log('OK probar() y activar()');
}

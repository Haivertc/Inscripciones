// Línea de log por petición para el datalake (mismo contrato en todos los módulos):
//   - al terminar la respuesta: "DLK " + JSON compacto por stdout;
//   - si existe LOG_DIR, la misma línea (sin prefijo) se agrega a
//     LOG_DIR/<service>-<instance>-AAAAMMDD-HH.jsonl (hora UTC).
// La respuesta siempre lleva x-trace-id. Registrar el log nunca rompe ni demora la
// petición: todo va en try/catch y la escritura ocurre después de responder.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { ejecutarConContexto } = require('../utils/contextoPeticion');

const SERVICE = 'inscripciones';
const PREFIJO = 'DLK ';
const LIMITE_CUERPO = 16 * 1024; // bytes
const MAX_TRACE_ID = 128;

// Rutas cuyo cuerpo nunca se registra (credenciales)
const RUTAS_CUERPO_OMITIDO = new Set(['/api/auth/login', '/api/auth/registro']);

// Rutas que no se registran: salud, actuator y documentación
const esRutaExcluida = (ruta) =>
  ruta === '/health' ||
  ruta.startsWith('/health/') ||
  ruta === '/actuator' ||
  ruta.startsWith('/actuator/') ||
  ruta.startsWith('/api-docs') ||
  ruta.startsWith('/swagger') ||
  ruta.startsWith('/v3/api-docs');

const instancia = () => process.env.HOSTNAME || 'local';

const encabezado = (req, nombre) => {
  const valor = req.headers[nombre];
  if (Array.isArray(valor)) return valor[0] ?? null;
  return valor === undefined || valor === '' ? null : valor;
};

const obtenerTraceId = (req) => {
  const recibido = encabezado(req, 'x-trace-id');
  if (recibido && recibido.length <= MAX_TRACE_ID) return recibido;
  return crypto.randomBytes(8).toString('hex'); // 16 hex
};

const separarUrl = (originalUrl = '') => {
  const i = originalUrl.indexOf('?');
  if (i === -1) return { ruta: originalUrl, query: null };
  const query = originalUrl.slice(i + 1);
  return { ruta: originalUrl.slice(0, i), query: query === '' ? null : query };
};

// Para comparar rutas: sin "/" final y en minúsculas
const normalizar = (ruta) => (ruta.replace(/\/+$/, '') || '/').toLowerCase();

/**
 * Cuerpo para el log: objeto JSON | "<no-json>" | "<demasiado-grande>" | "<omitido>" | null.
 * Se toma al inicio (antes de que el controlador pueda tocar req.body) y como copia.
 * @param {Error} [errorParseo] error de express.json() (JSON inválido o demasiado grande)
 */
const cuerpoParaLog = (req, ruta, errorParseo) => {
  if (RUTAS_CUERPO_OMITIDO.has(normalizar(ruta))) return '<omitido>';

  const largo = Number(req.headers['content-length']);
  const hayCuerpo = (Number.isFinite(largo) && largo > 0) || req.headers['transfer-encoding'] !== undefined;
  if (!hayCuerpo) return null;

  if ((Number.isFinite(largo) && largo > LIMITE_CUERPO) || errorParseo?.type === 'entity.too.large') {
    return '<demasiado-grande>';
  }
  // Multipart, binario, texto... o JSON que no se pudo interpretar
  if (!req.is('application/json') || errorParseo || req.body === undefined) return '<no-json>';

  const texto = JSON.stringify(req.body);
  if (Buffer.byteLength(texto) > LIMITE_CUERPO) return '<demasiado-grande>';
  return JSON.parse(texto);
};

// ---------------------------------------------------------------------------
// Escritura (nunca lanza)
// ---------------------------------------------------------------------------

// Un error de stdout (p. ej. EPIPE si se cierra la tubería) se emite como evento y
// sin un listener tumbaría el proceso
let stdoutProtegido = false;
const protegerStdout = () => {
  if (stdoutProtegido) return;
  stdoutProtegido = true;
  if (process.stdout.listenerCount('error') === 0) process.stdout.on('error', () => {});
};

// Solo para el nombre del archivo: HOSTNAME podría traer caracteres no válidos
const seguroParaArchivo = (texto) => String(texto).replace(/[^A-Za-z0-9._-]/g, '_');

const nombreArchivo = (registro) => {
  // ts = AAAA-MM-DDTHH:mm:ss.sssZ (UTC)
  const fecha = registro.ts.slice(0, 10).replace(/-/g, '');
  const hora = registro.ts.slice(11, 13);
  return `${SERVICE}-${seguroParaArchivo(registro.instance)}-${fecha}-${hora}.jsonl`;
};

const carpetasListas = new Set();

const agregarAArchivo = (dir, archivo, linea, reintento = true) => {
  try {
    if (!carpetasListas.has(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      carpetasListas.add(dir);
    }
    fs.appendFile(path.join(dir, archivo), `${linea}\n`, (error) => {
      // Si borraron la carpeta mientras el proceso corría, se crea de nuevo una vez
      if (error && error.code === 'ENOENT' && reintento) {
        carpetasListas.delete(dir);
        agregarAArchivo(dir, archivo, linea, false);
      }
    });
  } catch {
    /* el log nunca debe afectar la petición */
  }
};

const escribir = (registro) => {
  try {
    const linea = JSON.stringify(registro);
    try {
      protegerStdout();
      process.stdout.write(`${PREFIJO}${linea}\n`);
    } catch {
      /* sin stdout, se intenta igual el archivo */
    }
    if (process.env.LOG_DIR) agregarAArchivo(process.env.LOG_DIR, nombreArchivo(registro), linea);
  } catch {
    /* el log nunca debe afectar la petición */
  }
};

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

// Prepara el registro y el contexto; devuelve null si algo falla
const preparar = (req, res, errorParseo) => {
  const inicio = process.hrtime.bigint();
  const ts = new Date().toISOString();
  const traceId = obtenerTraceId(req);
  const userId = encabezado(req, 'x-user-id');
  const role = encabezado(req, 'x-user-role');

  try {
    res.setHeader('x-trace-id', traceId);
  } catch {
    /* ya enviado o valor no válido: no se interrumpe la petición */
  }

  const { ruta, query } = separarUrl(req.originalUrl);
  const contexto = { traceId, userId, role };
  if (esRutaExcluida(ruta)) return contexto;

  const base = {
    ts,
    service: SERVICE,
    instance: instancia(),
    trace_id: traceId,
    method: req.method,
    path: ruta,
    query,
    status: null,
    latency_ms: null,
    user_id: userId,
    role,
    idempotency_key: encabezado(req, 'idempotency-key'),
    error_type: null,
    request_body: cuerpoParaLog(req, ruta, errorParseo),
  };

  res.once('finish', () => {
    try {
      escribir({
        ...base,
        status: res.statusCode,
        latency_ms: Number((process.hrtime.bigint() - inicio) / 1000000n),
        error_type: res.locals?.errorType ?? null,
      });
    } catch {
      /* el log nunca debe afectar la petición */
    }
  });

  return contexto;
};

const iniciar = (req, res, next, errorParseo) => {
  let contexto = null;
  try {
    contexto = preparar(req, res, errorParseo);
  } catch {
    contexto = null;
  }
  // El resto de la petición corre con el contexto (lo usa el cliente HTTP)
  if (contexto) return ejecutarConContexto(contexto, next);
  return next();
};

// Registrar en app.js justo después de express.json()
const datalakeLog = (req, res, next) => iniciar(req, res, next);

// Variante para cuando express.json() falla (JSON inválido o demasiado grande):
// Express salta los middlewares normales y va directo a los de error, así que sin
// esto esas peticiones no quedarían registradas ni llevarían x-trace-id.
// eslint-disable-next-line no-unused-vars
const datalakeLogTrasError = (err, req, res, next) => iniciar(req, res, () => next(err), err);

module.exports = { datalakeLog, datalakeLogTrasError, SERVICE, PREFIJO, LIMITE_CUERPO };

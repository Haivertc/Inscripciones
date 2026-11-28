// Pruebas de la línea de log del datalake (src/middlewares/datalakeLog.js) y de la
// propagación de x-trace-id / x-user-id / x-user-role hacia Estudiantes y Materias.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.NODE_ENV = 'test';

const { crearFakePrisma } = require('./helpers/fakePrisma');
const { crearEstudiantesFalso, crearMateriasFalso } = require('./helpers/fakeModulos');
const { crearCaptura, PREFIJO } = require('./helpers/capturaDlk');

const fake = crearFakePrisma();
const rutaDb = path.join(__dirname, '../src/config/db.js');
require.cache[rutaDb] = {
  id: rutaDb,
  filename: rutaDb,
  loaded: true,
  exports: { prisma: fake.prisma, dbConnect: async () => {} },
};
const app = require('../src/app');

const CAMPOS = [
  'ts', 'service', 'instance', 'trace_id', 'method', 'path', 'query', 'status', 'latency_ms',
  'user_id', 'role', 'idempotency_key', 'error_type', 'request_body',
];

const captura = crearCaptura();
const estudiantes = crearEstudiantesFalso();
const materias = crearMateriasFalso();
let servidorApp;
let baseUrl;
let urlEstudiantes;
let urlMaterias;
let tmp;
const originalConsoleError = console.error;

before(async () => {
  urlEstudiantes = await estudiantes.iniciar();
  urlMaterias = await materias.iniciar();
  await new Promise((resolve) => {
    servidorApp = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${servidorApp.address().port}`;
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dlk-'));
});

after(async () => {
  captura.restaurar();
  console.error = originalConsoleError;
  for (const s of [servidorApp, estudiantes.servidor, materias.servidor]) {
    s.closeAllConnections();
    await new Promise((r) => s.close(r));
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => {
  fake.reiniciar();
  captura.limpiar();
  captura.simularFallo(false);
  delete process.env.LOG_DIR;
  process.env.HOSTNAME = 'insc-test-1';
  process.env.ESTUDIANTES_URL = urlEstudiantes;
  process.env.MATERIAS_URL = urlMaterias;
  estudiantes.estado.estudiantes = new Map([['E1', 'ACTIVO']]);
  estudiantes.estado.recibidas = [];
  materias.estado.cursos = new Map([
    ['C1', { estado: 'ACTIVO', cupo: 10, cupoDisponible: 10 }],
    ['LLENO', { estado: 'ACTIVO', cupo: 1, cupoDisponible: 0 }],
  ]);
  materias.estado.recibidas = [];
  materias.estado.modoReservar = 'normal';
  materias.estado.modoLiberar = 'normal';
  materias.estado.modoGet = 'normal';
  console.error = () => {}; // silencia logs de error de la app
});

const pedir = async (metodo, ruta, { body, headers = {}, crudo } = {}) => {
  const res = await fetch(`${baseUrl}${ruta}`, {
    method: metodo,
    headers: { ...(body !== undefined && { 'Content-Type': 'application/json' }), ...headers },
    body: crudo ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const texto = await res.text();
  return { status: res.status, headers: res.headers, texto };
};

const BODY = { estudianteId: 'E1', cursoId: 'C1', periodo: '2026-2' };

test('una línea por petición, con todos los campos del contrato y sus tipos', async () => {
  await pedir('GET', '/api/inscripciones?pageSize=5&estudianteId=E1', {
    headers: { 'x-user-id': 'u-42', 'x-user-role': 'admin' },
  });
  await pedir('GET', '/api/inscripciones');
  const [r1, r2] = await captura.esperar(2);

  assert.equal(captura.lineas.length, 2, 'exactamente una línea por petición');
  assert.ok(captura.lineas.every((l) => l.startsWith(PREFIJO) && l.endsWith('}\n') && !l.slice(0, -1).includes('\n')));
  assert.deepEqual(Object.keys(r1), CAMPOS);

  assert.match(r1.ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(r1.service, 'inscripciones');
  assert.equal(r1.instance, 'insc-test-1');
  assert.match(r1.trace_id, /^[0-9a-f]{16}$/);
  assert.equal(r1.method, 'GET');
  assert.equal(r1.path, '/api/inscripciones');
  assert.equal(r1.query, 'pageSize=5&estudianteId=E1');
  assert.equal(r1.status, 200);
  assert.ok(Number.isInteger(r1.latency_ms) && r1.latency_ms >= 0);
  assert.equal(r1.user_id, 'u-42');
  assert.equal(r1.role, 'admin');
  assert.equal(r1.idempotency_key, null);
  assert.equal(r1.error_type, null);
  assert.equal(r1.request_body, null);

  assert.equal(r2.query, null);
  assert.equal(r2.user_id, null);
  assert.equal(r2.role, null);
  assert.notEqual(r2.trace_id, r1.trace_id);
});

test('reutiliza el x-trace-id recibido y lo devuelve en la respuesta', async () => {
  const r = await pedir('GET', '/api/inscripciones', { headers: { 'x-trace-id': 'trace-del-gateway-01' } });
  const [registro] = await captura.esperar(1);
  assert.equal(r.headers.get('x-trace-id'), 'trace-del-gateway-01');
  assert.equal(registro.trace_id, 'trace-del-gateway-01');
});

test('genera un x-trace-id de 16 hex si no llega, y es el mismo en log y respuesta', async () => {
  const r = await pedir('GET', '/api/inscripciones');
  const [registro] = await captura.esperar(1);
  assert.match(r.headers.get('x-trace-id'), /^[0-9a-f]{16}$/);
  assert.equal(registro.trace_id, r.headers.get('x-trace-id'));
});

test('/api/auth/login y /api/auth/registro nunca guardan el cuerpo', async () => {
  const secreto = { usuario: 'ana', password: 'S3cr3t0-no-debe-verse' };
  await pedir('POST', '/api/auth/login', { body: secreto });
  await pedir('POST', '/api/auth/registro/', { body: secreto }); // con "/" final
  const registros = await captura.esperar(2);

  assert.equal(registros.length, 2);
  for (const registro of registros) assert.equal(registro.request_body, '<omitido>');
  assert.ok(!captura.lineas.join('').includes('S3cr3t0'), 'la contraseña no aparece en el log');
});

test('error_type sale con el código de negocio (res.locals.errorType)', async () => {
  await pedir('POST', '/api/inscripciones', { body: { estudianteId: 'E1' } });
  await pedir('POST', '/api/inscripciones', { body: { ...BODY, estudianteId: 'NOEXISTE' } });
  await pedir('POST', '/api/inscripciones', { body: { ...BODY, cursoId: 'LLENO' }, headers: { 'Idempotency-Key': 'k-1' } });
  await pedir('GET', '/api/inscripciones');
  const [validacion, noExiste, cupo, ok] = await captura.esperar(4);

  assert.equal(validacion.status, 400);
  assert.equal(validacion.error_type, 'ValidacionFallida');
  assert.deepEqual(validacion.request_body, { estudianteId: 'E1' });
  assert.equal(noExiste.status, 422);
  assert.equal(noExiste.error_type, 'EstudianteNoExiste');
  assert.equal(cupo.status, 409);
  assert.equal(cupo.error_type, 'CupoAgotado');
  assert.equal(cupo.idempotency_key, 'k-1');
  assert.equal(ok.error_type, null);
});

test('un error al escribir el log no cambia la respuesta', async () => {
  const normal = await pedir('POST', '/api/inscripciones', { body: { estudianteId: 'E1' } });

  // stdout lanza excepción y LOG_DIR apunta a un ARCHIVO (no se puede crear la carpeta)
  const archivo = path.join(tmp, 'no-es-carpeta');
  fs.writeFileSync(archivo, 'x');
  process.env.LOG_DIR = path.join(archivo, 'logs');
  captura.simularFallo(true);

  const conFallo = await pedir('POST', '/api/inscripciones', { body: { estudianteId: 'E1' } });
  await new Promise((r) => setTimeout(r, 50)); // da tiempo a que cualquier error asíncrono salga

  assert.equal(conFallo.status, normal.status);
  assert.equal(conFallo.texto, normal.texto);
  assert.match(conFallo.headers.get('x-trace-id'), /^[0-9a-f]{16}$/);

  // La app sigue atendiendo con normalidad
  captura.simularFallo(false);
  const despues = await pedir('GET', '/api/inscripciones');
  assert.equal(despues.status, 200);
});

test('con LOG_DIR: crea la carpeta y agrega la línea sin prefijo a <service>-<instance>-AAAAMMDD-HH.jsonl', async () => {
  const dir = path.join(tmp, 'anidada', 'logs');
  process.env.LOG_DIR = dir;
  await pedir('GET', '/api/inscripciones');
  await pedir('GET', '/api/inscripciones?x=1');
  const [r1] = await captura.esperar(2);

  const esperado = `inscripciones-insc-test-1-${r1.ts.slice(0, 10).replace(/-/g, '')}-${r1.ts.slice(11, 13)}.jsonl`;
  const ruta = path.join(dir, esperado);
  const limite = Date.now() + 2000;
  while ((!fs.existsSync(ruta) || fs.readFileSync(ruta, 'utf8').split('\n').length < 3) && Date.now() < limite) {
    await new Promise((r) => setTimeout(r, 10));
  }

  const contenido = fs.readFileSync(ruta, 'utf8');
  const lineasArchivo = contenido.trim().split('\n');
  assert.equal(lineasArchivo.length, 2);
  assert.ok(!contenido.includes(PREFIJO));
  assert.deepEqual(lineasArchivo, captura.lineas.map((l) => l.slice(PREFIJO.length).trimEnd()));
});

test('request_body: <no-json> para multipart/JSON inválido y <demasiado-grande> sobre 16 KB', async () => {
  const form = new FormData();
  form.append('archivo', new Blob(['contenido binario']), 'foto.png');
  await fetch(`${baseUrl}/api/inscripciones`, { method: 'POST', body: form }).then((r) => r.text());
  const invalido = await pedir('POST', '/api/inscripciones', {
    crudo: '{"estudianteId": ',
    headers: { 'Content-Type': 'application/json' },
  });
  await pedir('POST', '/api/inscripciones', { body: { ...BODY, relleno: 'x'.repeat(17 * 1024) } });
  const [multipart, jsonInvalido, grande] = await captura.esperar(3);

  assert.equal(multipart.request_body, '<no-json>');
  // JSON inválido: express.json() falla, pero la petición se registra igual y lleva x-trace-id
  assert.equal(invalido.status, 400);
  assert.ok(invalido.headers.get('x-trace-id'));
  assert.equal(jsonInvalido.request_body, '<no-json>');
  assert.equal(jsonInvalido.status, 400);
  assert.equal(jsonInvalido.error_type, 'ValidacionFallida');
  assert.equal(jsonInvalido.trace_id, invalido.headers.get('x-trace-id'));
  assert.equal(grande.request_body, '<demasiado-grande>');
});

test('no registra /health ni la documentación, pero responde con x-trace-id', async () => {
  const salud = await pedir('GET', '/health');
  await pedir('GET', '/api-docs/');
  await pedir('GET', '/api/inscripciones'); // marca: esta sí se registra
  const registros = await captura.esperar(1);
  await new Promise((r) => setTimeout(r, 30));

  assert.equal(salud.status, 200);
  assert.match(salud.headers.get('x-trace-id'), /^[0-9a-f]{16}$/);
  assert.equal(captura.lineas.length, 1);
  assert.equal(registros[0].path, '/api/inscripciones');
});

test('un POST de inscripción reenvía el mismo x-trace-id (y usuario/rol) a Estudiantes y Materias', async () => {
  const r = await pedir('POST', '/api/inscripciones', {
    body: BODY,
    headers: { 'x-trace-id': 'traza-e2e-123', 'x-user-id': 'admin-1', 'x-user-role': 'admin' },
  });
  assert.equal(r.status, 201);

  const llamadas = [...estudiantes.estado.recibidas, ...materias.estado.recibidas];
  // GET estudiante, GET curso y POST reservar-cupo
  assert.equal(llamadas.length, 3);
  assert.ok(materias.estado.recibidas.some((l) => l.url.endsWith('/reservar-cupo')));
  for (const llamada of llamadas) {
    assert.equal(llamada.headers['x-trace-id'], 'traza-e2e-123', `${llamada.metodo} ${llamada.url}`);
    assert.equal(llamada.headers['x-user-id'], 'admin-1');
    assert.equal(llamada.headers['x-user-role'], 'admin');
  }

  const [registro] = await captura.esperar(1);
  assert.equal(registro.trace_id, 'traza-e2e-123');
});

test('sin x-trace-id entrante se reenvía el generado; también en la compensación (liberar-cupo)', async () => {
  fake.hooks.errorCreate = new Error('base caída');
  const r = await pedir('POST', '/api/inscripciones', { body: BODY });
  assert.equal(r.status, 503);
  const traza = r.headers.get('x-trace-id');

  const liberar = materias.estado.recibidas.find((l) => l.url.endsWith('/liberar-cupo'));
  assert.ok(liberar, 'hubo compensación');
  assert.equal(liberar.headers['x-trace-id'], traza);
  assert.equal(liberar.headers['x-user-id'], undefined, 'no inventa usuario si no llegó');
  for (const l of estudiantes.estado.recibidas) assert.equal(l.headers['x-trace-id'], traza);
});

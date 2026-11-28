// Pruebas del flujo de consistencia con node:test (sin base de datos real):
// - Prisma se reemplaza por uno en memoria (test/helpers/fakePrisma.js).
// - Estudiantes y Materias son servidores HTTP falsos (test/helpers/fakeModulos.js).
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { crearFakePrisma } = require('./helpers/fakePrisma');
const { crearEstudiantesFalso, crearMateriasFalso, urlSinServidor } = require('./helpers/fakeModulos');
const { crearCaptura } = require('./helpers/capturaDlk');

// Las líneas DLK del datalake se prueban en datalake.test.js; aquí solo se silencian
const capturaDlk = crearCaptura();

process.env.NODE_ENV = 'test';

// Inyectar el Prisma falso ANTES de cargar la app
const fake = crearFakePrisma();
const rutaDb = path.join(__dirname, '../src/config/db.js');
require.cache[rutaDb] = {
  id: rutaDb,
  filename: rutaDb,
  loaded: true,
  exports: { prisma: fake.prisma, dbConnect: async () => {} },
};
const app = require('../src/app');

const estudiantes = crearEstudiantesFalso();
const materias = crearMateriasFalso();
let servidorApp;
let baseUrl;
let urlEstudiantes;
let urlMaterias;
let eventos; // eventos registrados con registrarEvento (ReservaIncierta, CompensacionFallida...)

const originalConsoleError = console.error;

before(async () => {
  urlEstudiantes = await estudiantes.iniciar();
  urlMaterias = await materias.iniciar();
  await new Promise((resolve) => {
    servidorApp = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${servidorApp.address().port}`;
});

after(async () => {
  console.error = originalConsoleError;
  capturaDlk.restaurar();
  for (const s of [servidorApp, estudiantes.servidor, materias.servidor]) {
    s.closeAllConnections();
    await new Promise((r) => s.close(r));
  }
});

beforeEach(() => {
  fake.reiniciar();
  process.env.ESTUDIANTES_URL = urlEstudiantes;
  process.env.MATERIAS_URL = urlMaterias;
  process.env.HTTP_TIMEOUT_MS = '150'; // los timeouts reales son 2000 ms; aquí se acortan

  estudiantes.estado.estudiantes = new Map([
    ['E1', 'ACTIVO'],
    ['E2', 'ACTIVO'],
    ['E9', 'INACTIVO'],
  ]);
  estudiantes.estado.modo = 'normal';
  estudiantes.estado.llamadas = 0;

  materias.estado.cursos = new Map([
    ['C1', { estado: 'ACTIVO', cupo: 30, cupoDisponible: 30 }],
    ['LLENO', { estado: 'ACTIVO', cupo: 1, cupoDisponible: 0 }],
    ['CERRADO', { estado: 'INACTIVO', cupo: 10, cupoDisponible: 10 }],
  ]);
  materias.estado.modoGet = 'normal';
  materias.estado.modoReservar = 'normal';
  materias.estado.modoLiberar = 'normal';
  materias.estado.llamadas = { get: 0, reservar: 0, liberar: 0 };

  // Silencia y captura los logs
  eventos = [];
  console.error = (...args) => {
    try {
      const obj = JSON.parse(args[0]);
      if (obj && obj.evento) eventos.push(obj);
    } catch {
      /* log normal */
    }
  };
});

const pedir = async (metodo, ruta, { body, headers = {} } = {}) => {
  const res = await fetch(`${baseUrl}${ruta}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const texto = await res.text();
  return { status: res.status, headers: res.headers, body: texto ? JSON.parse(texto) : null };
};

const inscribir = (body, clave) =>
  pedir('POST', '/api/inscripciones', { body, headers: clave ? { 'Idempotency-Key': clave } : {} });

const cupo = (cursoId) => materias.estado.cursos.get(cursoId).cupoDisponible;
const BODY = { estudianteId: 'E1', cursoId: 'C1', periodo: '2026-2' };

// ---------------------------------------------------------------------------
// POST /api/inscripciones
// ---------------------------------------------------------------------------

test('caso feliz: valida, reserva cupo y crea la inscripción con su clave', async () => {
  const r = await inscribir(BODY, 'clave-1');

  assert.equal(r.status, 201);
  assert.equal(r.body.estudianteId, 'E1');
  assert.equal(r.body.estado, 'activa');
  assert.equal(r.headers.get('idempotent-replayed'), null);
  assert.equal(cupo('C1'), 29);
  assert.equal(fake.estado.inscripciones.length, 1);
  assert.equal(fake.estado.inscripciones[0].idempotencyKey, 'clave-1');
});

test('body inválido -> 400 ValidacionFallida sin llamar a otros módulos', async () => {
  const r = await inscribir({ estudianteId: 'E1' });
  assert.equal(r.status, 400);
  assert.equal(r.body.errorType, 'ValidacionFallida');
  assert.ok(r.body.message);
  assert.equal(estudiantes.estado.llamadas, 0);
});

test('cupo agotado -> 409 CupoAgotado y no se crea nada', async () => {
  const r = await inscribir({ ...BODY, cursoId: 'LLENO' }, 'clave-2');
  assert.equal(r.status, 409);
  assert.equal(r.body.errorType, 'CupoAgotado');
  assert.equal(fake.estado.inscripciones.length, 0);
  assert.equal(cupo('LLENO'), 0);
});

test('estudiante inexistente -> 422 EstudianteNoExiste sin reservar cupo', async () => {
  const r = await inscribir({ ...BODY, estudianteId: 'NOEXISTE' });
  assert.equal(r.status, 422);
  assert.equal(r.body.errorType, 'EstudianteNoExiste');
  assert.equal(materias.estado.llamadas.reservar, 0);
  assert.equal(fake.estado.inscripciones.length, 0);
});

test('estudiante INACTIVO -> 422 EstudianteInactivo', async () => {
  const r = await inscribir({ ...BODY, estudianteId: 'E9' });
  assert.equal(r.status, 422);
  assert.equal(r.body.errorType, 'EstudianteInactivo');
});

test('curso inexistente o inactivo -> 422 CursoNoExiste / CursoInactivo', async () => {
  const r1 = await inscribir({ ...BODY, cursoId: 'NOEXISTE' });
  assert.equal(r1.status, 422);
  assert.equal(r1.body.errorType, 'CursoNoExiste');

  const r2 = await inscribir({ ...BODY, cursoId: 'CERRADO' });
  assert.equal(r2.status, 422);
  assert.equal(r2.body.errorType, 'CursoInactivo');
  assert.equal(materias.estado.llamadas.reservar, 0);
});

test('módulo caído (conexión rechazada) -> 503 ServicioNoDisponible indicando cuál', async () => {
  process.env.MATERIAS_URL = await urlSinServidor();
  const r = await inscribir(BODY);
  assert.equal(r.status, 503);
  assert.equal(r.body.errorType, 'ServicioNoDisponible');
  assert.match(r.body.message, /Materias/);
  assert.equal(fake.estado.inscripciones.length, 0);
});

test('módulo que responde 5xx -> 503 (nunca 500)', async () => {
  estudiantes.estado.modo = 'error500';
  const r = await inscribir(BODY);
  assert.equal(r.status, 503);
  assert.equal(r.body.errorType, 'ServicioNoDisponible');
  assert.match(r.body.message, /Estudiantes/);
});

test('GET con timeout se reintenta 1 vez y luego -> 503', async () => {
  estudiantes.estado.modo = 'colgado';
  const r = await inscribir(BODY);
  assert.equal(r.status, 503);
  assert.match(r.body.message, /Estudiantes.*timeout/);
  assert.equal(estudiantes.estado.llamadas, 2); // intento + 1 reintento
});

test('reserva sin respuesta -> 503, SIN reintento y se registra ReservaIncierta', async () => {
  materias.estado.modoReservar = 'colgado';
  const r = await inscribir(BODY, 'clave-incierta');
  assert.equal(r.status, 503);
  assert.equal(r.body.errorType, 'ServicioNoDisponible');
  assert.equal(materias.estado.llamadas.reservar, 1);
  const evento = eventos.find((e) => e.evento === 'ReservaIncierta');
  assert.ok(evento, 'debe registrar ReservaIncierta');
  assert.equal(evento.estudianteId, 'E1');
  assert.equal(evento.cursoId, 'C1');
  assert.equal(evento.idempotencyKey, 'clave-incierta');
  assert.equal(fake.estado.inscripciones.length, 0);
});

test('réplica idempotente: misma clave -> 201 con la misma inscripción, sin tocar cupos', async () => {
  const r1 = await inscribir(BODY, 'clave-replay');
  const r2 = await inscribir(BODY, 'clave-replay');

  assert.equal(r1.status, 201);
  assert.equal(r2.status, 201);
  assert.equal(r2.headers.get('idempotent-replayed'), 'true');
  assert.equal(r2.body._id, r1.body._id);
  assert.equal(fake.estado.inscripciones.length, 1);
  assert.equal(materias.estado.llamadas.reservar, 1);
  assert.equal(cupo('C1'), 29);
});

test('misma clave con otro estudiante/curso -> 422 IdempotencyKeyReutilizada', async () => {
  await inscribir(BODY, 'clave-x');
  const r = await inscribir({ ...BODY, estudianteId: 'E2' }, 'clave-x');
  assert.equal(r.status, 422);
  assert.equal(r.body.errorType, 'IdempotencyKeyReutilizada');
  assert.equal(materias.estado.llamadas.reservar, 1);
});

test('inscripción activa existente -> 409 InscripcionDuplicada sin tocar cupos', async () => {
  await inscribir(BODY, 'a');
  const r = await inscribir(BODY, 'b');
  assert.equal(r.status, 409);
  assert.equal(r.body.errorType, 'InscripcionDuplicada');
  assert.equal(materias.estado.llamadas.reservar, 1);
  assert.equal(cupo('C1'), 29);
});

test('compensación ante P2002 por idempotency_key (petición concurrente) -> libera y replica', async () => {
  // Otra petición con la misma clave se guarda justo antes que esta
  fake.hooks.beforeCreate = async (data) => {
    fake.hooks.beforeCreate = null;
    fake.insertarDirecto({ ...data, id: 'aaaaaaaaaaaaaaaaaaaaaaaa' });
  };
  const r = await inscribir(BODY, 'clave-carrera');

  assert.equal(r.status, 201);
  assert.equal(r.headers.get('idempotent-replayed'), 'true');
  assert.equal(r.body._id, 'aaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(materias.estado.llamadas.liberar, 1, 'debe devolver el cupo reservado');
  assert.equal(cupo('C1'), 30);
  assert.equal(fake.estado.inscripciones.length, 1);
});

test('compensación ante P2002 por uq_insc -> libera y 409 InscripcionDuplicada', async () => {
  fake.hooks.beforeCreate = async (data) => {
    fake.hooks.beforeCreate = null;
    fake.insertarDirecto({ ...data, id: 'bbbbbbbbbbbbbbbbbbbbbbbb', idempotencyKey: 'otra-clave' });
  };
  const r = await inscribir(BODY, 'mi-clave');

  assert.equal(r.status, 409);
  assert.equal(r.body.errorType, 'InscripcionDuplicada');
  assert.equal(materias.estado.llamadas.liberar, 1);
  assert.equal(cupo('C1'), 30);
});

test('P2002 y liberar-cupo también falla -> se registra CompensacionFallida', async () => {
  materias.estado.modoLiberar = 'error500';
  fake.hooks.beforeCreate = async (data) => {
    fake.hooks.beforeCreate = null;
    fake.insertarDirecto({ ...data, id: 'cccccccccccccccccccccccc', idempotencyKey: null });
  };
  const r = await inscribir(BODY, 'k');

  assert.equal(r.status, 409);
  const evento = eventos.find((e) => e.evento === 'CompensacionFallida');
  assert.ok(evento, 'debe registrar CompensacionFallida');
  assert.equal(evento.cursoId, 'C1');
  assert.equal(evento.estudianteId, 'E1');
  assert.equal(evento.idempotencyKey, 'k');
});

test('fallo de la base al guardar (no P2002) -> libera el cupo y 503', async () => {
  fake.hooks.errorCreate = new Error('conexión perdida');
  const r = await inscribir(BODY);
  assert.equal(r.status, 503);
  assert.equal(r.body.errorType, 'ServicioNoDisponible');
  assert.equal(materias.estado.llamadas.liberar, 1);
  assert.equal(cupo('C1'), 30);
});

test('reinscribir una cancelada reactiva la misma fila, reserva cupo y deja historial', async () => {
  const r1 = await inscribir(BODY, 'k1');
  await pedir('DELETE', `/api/inscripciones/${r1.body._id}`);
  assert.equal(cupo('C1'), 30);

  const r2 = await inscribir({ ...BODY, periodo: '2027-1' }, 'k2');
  assert.equal(r2.status, 201);
  assert.equal(r2.body._id, r1.body._id);
  assert.equal(r2.body.estado, 'activa');
  assert.equal(r2.body.periodo, '2027-1');
  assert.equal(fake.estado.inscripciones.length, 1);
  assert.equal(cupo('C1'), 29);
  const ultimo = fake.estado.historial.at(-1);
  assert.equal(ultimo.estadoAnterior, 'cancelada');
  assert.equal(ultimo.estadoNuevo, 'activa');
});

// ---------------------------------------------------------------------------
// A1: cancelar en vez de borrar
// ---------------------------------------------------------------------------

test('DELETE cancela (no borra), crea historial y libera el cupo; repetirlo no libera de nuevo', async () => {
  const { body } = await inscribir(BODY);
  assert.equal(cupo('C1'), 29);

  const r1 = await pedir('DELETE', `/api/inscripciones/${body._id}`);
  assert.equal(r1.status, 200);
  assert.equal(r1.body.estado, 'cancelada');
  assert.equal(r1.body.cupoLiberado, true);
  assert.equal(fake.estado.inscripciones.length, 1, 'la fila se conserva');
  assert.equal(fake.estado.historial.at(-1).estadoNuevo, 'cancelada');
  assert.equal(cupo('C1'), 30);

  const r2 = await pedir('DELETE', `/api/inscripciones/${body._id}`);
  assert.equal(r2.status, 200);
  assert.equal(r2.body.yaCancelada, true);
  assert.equal(materias.estado.llamadas.liberar, 1);
});

test('DELETE con liberar-cupo caído -> 200 cupoLiberado:false y CompensacionFallida', async () => {
  const { body } = await inscribir(BODY);
  materias.estado.modoLiberar = 'colgado';

  const r = await pedir('DELETE', `/api/inscripciones/${body._id}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.cupoLiberado, false);
  assert.equal(r.body.estado, 'cancelada');
  assert.equal(materias.estado.llamadas.liberar, 1, 'liberar no se reintenta');
  assert.ok(eventos.find((e) => e.evento === 'CompensacionFallida' && e.inscripcionId === body._id));
});

test('DELETE de inexistente -> 404 InscripcionNoExiste', async () => {
  const r = await pedir('DELETE', '/api/inscripciones/aaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(r.status, 404);
  assert.equal(r.body.errorType, 'InscripcionNoExiste');
});

test('PUT no permite cambiar estudianteId ni cursoId -> 422 CambioNoPermitido', async () => {
  const { body } = await inscribir(BODY);
  const r = await pedir('PUT', `/api/inscripciones/${body._id}`, { body: { cursoId: 'OTRO' } });
  assert.equal(r.status, 422);
  assert.equal(r.body.errorType, 'CambioNoPermitido');

  // Con los mismos valores (como envía el formulario) sí se puede editar el periodo
  const ok = await pedir('PUT', `/api/inscripciones/${body._id}`, {
    body: { estudianteId: 'E1', cursoId: 'C1', periodo: '2027-1' },
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.periodo, '2027-1');
});

test('PUT estado=cancelada libera el cupo; PUT para reactivar -> 422', async () => {
  const { body } = await inscribir(BODY);
  const r = await pedir('PUT', `/api/inscripciones/${body._id}`, { body: { estado: 'cancelada' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.cupoLiberado, true);
  assert.equal(cupo('C1'), 30);

  const r2 = await pedir('PUT', `/api/inscripciones/${body._id}`, { body: { estado: 'activa' } });
  assert.equal(r2.status, 422);
  assert.equal(r2.body.errorType, 'CambioNoPermitido');
});

test("POST /:id/historial con estadoNuevo 'cancelada' libera el cupo", async () => {
  const { body } = await inscribir(BODY);
  const r = await pedir('POST', `/api/inscripciones/${body._id}/historial`, {
    body: { estadoNuevo: 'cancelada', motivo: 'Retiro voluntario' },
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.estadoNuevo, 'cancelada');
  assert.equal(r.body.cupoLiberado, true);
  assert.equal(cupo('C1'), 30);
  assert.equal(fake.estado.inscripciones[0].estado, 'cancelada');

  // Repetirlo no vuelve a liberar
  const r2 = await pedir('POST', `/api/inscripciones/${body._id}/historial`, { body: { estadoNuevo: 'cancelada' } });
  assert.equal(r2.status, 200);
  assert.equal(r2.body.yaCancelada, true);
  assert.equal(materias.estado.llamadas.liberar, 1);
});

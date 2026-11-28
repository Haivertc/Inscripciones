// Servidores HTTP falsos de Estudiantes y Materias con los contratos acordados.
const http = require('node:http');

const responder = (res, status, cuerpo) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(cuerpo));
};

const escuchar = (servidor) =>
  new Promise((resolve) => {
    servidor.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${servidor.address().port}`));
  });

// modo: 'normal' | 'colgado' (no responde nunca) | 'error500'
const crearEstudiantesFalso = () => {
  // recibidas: { metodo, url, headers } de cada petición (para verificar la propagación)
  const estado = { estudiantes: new Map(), modo: 'normal', llamadas: 0, recibidas: [] };

  const servidor = http.createServer((req, res) => {
    estado.llamadas += 1;
    estado.recibidas.push({ metodo: req.method, url: req.url, headers: req.headers });
    if (estado.modo === 'colgado') return; // deja la conexión abierta sin responder
    if (estado.modo === 'error500') return responder(res, 500, { mensaje: 'falla' });

    const m = req.url.match(/^\/api\/estudiantes\/([^/]+)$/);
    if (req.method !== 'GET' || !m) return responder(res, 404, { mensaje: 'ruta' });
    const id = decodeURIComponent(m[1]);
    const est = estado.estudiantes.get(id);
    if (!est) return responder(res, 404, { mensaje: 'Estudiante no encontrado', errorType: 'EstudianteNoExiste' });
    return responder(res, 200, { _id: id, nombre: `Estudiante ${id}`, estado: est });
  });

  return { servidor, estado, iniciar: () => escuchar(servidor) };
};

// modos por operación: 'normal' | 'colgado' | 'error500'
const crearMateriasFalso = () => {
  const estado = {
    cursos: new Map(), // id -> { estado, cupo, cupoDisponible }
    modoGet: 'normal',
    modoReservar: 'normal',
    modoLiberar: 'normal',
    llamadas: { get: 0, reservar: 0, liberar: 0 },
    recibidas: [], // { metodo, url, headers }
  };

  const servidor = http.createServer((req, res) => {
    estado.recibidas.push({ metodo: req.method, url: req.url, headers: req.headers });
    const m = req.url.match(/^\/api\/materias\/cursos\/([^/]+)(\/reservar-cupo|\/liberar-cupo)?$/);
    if (!m) return responder(res, 404, { message: 'ruta', errorType: 'RutaNoExiste' });
    const id = decodeURIComponent(m[1]);
    const curso = estado.cursos.get(id);
    const op = m[2] === '/reservar-cupo' ? 'reservar' : m[2] === '/liberar-cupo' ? 'liberar' : 'get';
    estado.llamadas[op] += 1;

    const modo = { get: estado.modoGet, reservar: estado.modoReservar, liberar: estado.modoLiberar }[op];
    if (modo === 'colgado') return;
    if (modo === 'error500') return responder(res, 500, { message: 'falla', errorType: 'ErrorInterno' });

    if (!curso) return responder(res, 404, { message: 'Curso no existe', errorType: 'CursoNoExiste' });

    if (op === 'get') return responder(res, 200, { id, ...curso });

    if (op === 'reservar') {
      if (curso.estado !== 'ACTIVO') {
        return responder(res, 422, { message: 'Curso inactivo', errorType: 'CursoInactivo' });
      }
      if (curso.cupoDisponible <= 0) {
        return responder(res, 409, { message: 'No hay cupos', errorType: 'CupoAgotado' });
      }
      curso.cupoDisponible -= 1;
      return responder(res, 200, { id, ...curso });
    }

    // liberar
    if (curso.cupoDisponible >= curso.cupo) {
      return responder(res, 409, { message: 'Cupo ya completo', errorType: 'CupoYaCompleto' });
    }
    curso.cupoDisponible += 1;
    return responder(res, 200, { id, ...curso });
  });

  return { servidor, estado, iniciar: () => escuchar(servidor) };
};

// URL a la que nadie escucha (conexión rechazada al instante)
const urlSinServidor = async () => {
  const servidor = http.createServer();
  const url = await escuchar(servidor);
  await new Promise((r) => servidor.close(r));
  return url;
};

module.exports = { crearEstudiantesFalso, crearMateriasFalso, urlSinServidor };

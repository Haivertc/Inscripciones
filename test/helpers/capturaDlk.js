// Captura las líneas "DLK ..." que el middleware del datalake escribe en stdout.
// El resto de la salida pasa intacta (node:test usa stdout para comunicarse con el proceso padre).
const PREFIJO = 'DLK ';

const crearCaptura = () => {
  const lineas = []; // textos crudos, con prefijo
  const original = process.stdout.write.bind(process.stdout);
  let fallar = false; // simula un stdout que lanza excepción

  process.stdout.write = (chunk, ...resto) => {
    if (typeof chunk === 'string' && chunk.startsWith(PREFIJO)) {
      if (fallar) throw new Error('stdout roto (simulado)');
      lineas.push(chunk);
      return true;
    }
    return original(chunk, ...resto);
  };

  const registros = () => lineas.map((l) => JSON.parse(l.slice(PREFIJO.length)));

  // Espera a que haya al menos n líneas (el log se escribe al terminar la respuesta)
  const esperar = async (n, ms = 2000) => {
    const limite = Date.now() + ms;
    while (lineas.length < n && Date.now() < limite) {
      await new Promise((r) => setTimeout(r, 5));
    }
    return registros();
  };

  return {
    lineas,
    registros,
    esperar,
    limpiar: () => {
      lineas.length = 0;
    },
    simularFallo: (valor) => {
      fallar = valor;
    },
    restaurar: () => {
      process.stdout.write = original;
    },
  };
};

module.exports = { crearCaptura, PREFIJO };

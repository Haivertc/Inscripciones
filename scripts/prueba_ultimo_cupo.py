#!/usr/bin/env python3
"""Prueba de concurrencia del control de cupos, a través del API Gateway.

Modo por defecto (último cupo):
    Lanza 20 POST /api/inscripciones simultáneos (20 estudiantes distintos, mismo curso,
    cada uno con su propia Idempotency-Key) contra un curso con cupo 1.
    Esperado: 1 x 201, 19 x 409 y cupoDisponible final = 0 (nunca negativo).

Modo --idempotencia:
    Envía 2 veces la MISMA inscripción con la MISMA Idempotency-Key y verifica que
    exista una sola fila y que el cupo se haya descontado una sola vez.

Uso:
    python scripts/prueba_ultimo_cupo.py --gateway-url http://localhost:8080 \\
        --token <JWT admin> --curso-id 7 --estudiantes estudiantes.txt --periodo 2026-2

    python scripts/prueba_ultimo_cupo.py ... --idempotencia [--simultaneo]

Requiere: pip install requests
Código de salida: 0 si se cumple lo esperado, 1 si no, 2 por error de uso o conexión.
"""

import argparse
import sys
import threading
import uuid
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

import requests

NUM_PETICIONES = 20
TIMEOUT_S = 30


def leer_estudiantes(ruta, minimo):
    """Un id por línea; se ignoran líneas vacías y las que empiezan con '#'."""
    with open(ruta, encoding="utf-8") as archivo:
        ids = [linea.strip() for linea in archivo if linea.strip() and not linea.strip().startswith("#")]
    distintos = list(dict.fromkeys(ids))  # sin duplicados, en orden
    if len(distintos) < minimo:
        sys.exit(f"ERROR: {ruta} tiene {len(distintos)} ids distintos; se necesitan {minimo}.")
    return distintos[:minimo]


class Cliente:
    def __init__(self, gateway_url, token):
        self.base = gateway_url.rstrip("/")
        self.headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    def inscribir(self, estudiante_id, curso_id, periodo, clave):
        cuerpo = {"estudianteId": estudiante_id, "cursoId": curso_id, "periodo": periodo}
        headers = {**self.headers, "Idempotency-Key": clave}
        try:
            r = requests.post(f"{self.base}/api/inscripciones", json=cuerpo, headers=headers, timeout=TIMEOUT_S)
        except requests.RequestException as error:
            return {"status": "sin respuesta", "error": str(error), "estudianteId": estudiante_id}
        return {
            "status": r.status_code,
            "body": cuerpo_json(r),
            "replayed": r.headers.get("Idempotent-Replayed"),
            "estudianteId": estudiante_id,
        }

    def cupo_disponible(self, curso_id):
        r = requests.get(f"{self.base}/api/materias/cursos/{curso_id}", headers=self.headers, timeout=TIMEOUT_S)
        if r.status_code != 200:
            sys.exit(f"ERROR: GET curso {curso_id} respondió {r.status_code}: {r.text[:300]}")
        datos = r.json()
        if "cupoDisponible" not in datos:
            sys.exit(f"ERROR: la respuesta del curso no trae cupoDisponible: {datos}")
        return datos["cupoDisponible"]

    def contar_inscripciones(self, estudiante_id, curso_id):
        params = {"estudianteId": estudiante_id, "cursoId": curso_id, "pageSize": 100}
        r = requests.get(f"{self.base}/api/inscripciones", params=params, headers=self.headers, timeout=TIMEOUT_S)
        if r.status_code != 200:
            sys.exit(f"ERROR: GET /api/inscripciones respondió {r.status_code}: {r.text[:300]}")
        return r.json()["metadata"]["total"]


def cuerpo_json(respuesta):
    try:
        return respuesta.json()
    except ValueError:
        return {"raw": respuesta.text[:300]}


def lanzar_simultaneas(tareas):
    """Ejecuta las tareas en hilos que arrancan a la vez (barrera)."""
    barrera = threading.Barrier(len(tareas))

    def ejecutar(tarea):
        barrera.wait()
        return tarea()

    with ThreadPoolExecutor(max_workers=len(tareas)) as pool:
        return list(pool.map(ejecutar, tareas))


def modo_ultimo_cupo(cliente, args):
    estudiantes = leer_estudiantes(args.estudiantes, NUM_PETICIONES)
    cupo_inicial = cliente.cupo_disponible(args.curso_id)
    print(f"Curso {args.curso_id}: cupoDisponible inicial = {cupo_inicial}")
    if cupo_inicial != 1:
        print(f"AVISO: se esperaba cupo 1 para esta prueba (hay {cupo_inicial}); los conteos esperados cambian.")

    tareas = [
        (lambda e=e: cliente.inscribir(e, args.curso_id, args.periodo, str(uuid.uuid4())))
        for e in estudiantes
    ]
    print(f"Lanzando {len(tareas)} POST /api/inscripciones simultáneos...")
    resultados = lanzar_simultaneas(tareas)

    conteo = Counter(r["status"] for r in resultados)
    print("\nConteo por código HTTP:")
    for codigo, n in sorted(conteo.items(), key=lambda kv: str(kv[0])):
        print(f"  {codigo}: {n}")

    tipos = Counter((r.get("body") or {}).get("errorType") for r in resultados if r["status"] != 201)
    if tipos:
        print("errorType de las rechazadas:", dict(tipos))
    ganadores = [r["estudianteId"] for r in resultados if r["status"] == 201]
    if ganadores:
        print("Inscrito(s):", ", ".join(ganadores))
    otros = [r for r in resultados if r["status"] not in (201, 409)]
    for r in otros[:5]:
        print("  Inesperado:", r)

    cupo_final = cliente.cupo_disponible(args.curso_id)
    print(f"\ncupoDisponible final = {cupo_final}")

    esperado_201 = min(cupo_inicial, NUM_PETICIONES) if cupo_inicial > 0 else 0
    ok = (
        conteo.get(201, 0) == esperado_201
        and conteo.get(409, 0) == NUM_PETICIONES - esperado_201
        and cupo_final == cupo_inicial - esperado_201
        and cupo_final >= 0
    )
    print(f"Esperado: {esperado_201} x 201, {NUM_PETICIONES - esperado_201} x 409, cupo final {cupo_inicial - esperado_201}")
    if cupo_final < 0:
        print("FALLO GRAVE: cupoDisponible negativo")
    print("RESULTADO:", "OK" if ok else "FALLO")
    return ok


def modo_idempotencia(cliente, args):
    estudiante = leer_estudiantes(args.estudiantes, 1)[0]
    filas_antes = cliente.contar_inscripciones(estudiante, args.curso_id)
    if filas_antes:
        print(f"AVISO: el estudiante {estudiante} ya tiene {filas_antes} fila(s) en el curso {args.curso_id}; "
              "usa un estudiante sin inscripción en ese curso para que la prueba sea concluyente.")
    cupo_inicial = cliente.cupo_disponible(args.curso_id)
    clave = str(uuid.uuid4())
    print(f"Estudiante {estudiante}, curso {args.curso_id}, Idempotency-Key {clave}, cupo inicial {cupo_inicial}")

    def enviar():
        return cliente.inscribir(estudiante, args.curso_id, args.periodo, clave)

    if args.simultaneo:
        r1, r2 = lanzar_simultaneas([enviar, enviar])
    else:
        r1, r2 = enviar(), enviar()

    for i, r in enumerate((r1, r2), start=1):
        body = r.get("body") or {}
        print(f"  Envío {i}: HTTP {r['status']}  Idempotent-Replayed={r.get('replayed')}  "
              f"_id={body.get('_id')}  errorType={body.get('errorType')}")

    filas = cliente.contar_inscripciones(estudiante, args.curso_id)
    cupo_final = cliente.cupo_disponible(args.curso_id)
    print(f"Filas del estudiante en el curso: {filas}  |  cupo final: {cupo_final}")

    ambos_201 = r1["status"] == 201 and r2["status"] == 201
    mismo_id = ambos_201 and r1["body"].get("_id") == r2["body"].get("_id")
    replica = "true" in (r1.get("replayed"), r2.get("replayed"))

    if not replica and 409 in (r1["status"], r2["status"]):
        print("AVISO: un envío recibió 409 en lugar de la réplica. Si se llama por el Gateway, revisa que "
              "reenvíe el encabezado Idempotency-Key (y devuelva Idempotent-Replayed).")
    if ambos_201 and not replica:
        print("AVISO: no llegó Idempotent-Replayed: true; el Gateway podría no reenviar ese encabezado.")

    ok = filas == 1 and cupo_final == cupo_inicial - 1 and ambos_201 and mismo_id
    print("RESULTADO:", "OK" if ok else "FALLO",
          "(1 fila, cupo descontado una vez, misma inscripción en ambas respuestas)")
    return ok


def main():
    # En Windows, al redirigir la salida (Git Bash, archivos) Python usa cp1252 y los acentos se rompen
    if not sys.stdout.isatty():
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    parser =argparse.ArgumentParser(description="Prueba de último cupo e idempotencia por el API Gateway")
    parser.add_argument("--gateway-url", required=True, help="p. ej. http://localhost:8080")
    parser.add_argument("--token", required=True, help="JWT de un usuario admin")
    parser.add_argument("--curso-id", required=True, help="id del curso en Materias")
    parser.add_argument("--estudiantes", required=True,
                        help="archivo con ids de estudiantes ACTIVOS distintos, uno por línea (20 para el modo normal)")
    parser.add_argument("--periodo", required=True, help="p. ej. 2026-2")
    parser.add_argument("--idempotencia", action="store_true",
                        help="enviar 2 veces la misma inscripción con la misma clave")
    parser.add_argument("--simultaneo", action="store_true",
                        help="con --idempotencia: enviar los 2 POST a la vez en lugar de uno tras otro")
    args = parser.parse_args()

    cliente = Cliente(args.gateway_url, args.token)
    try:
        ok = modo_idempotencia(cliente, args) if args.idempotencia else modo_ultimo_cupo(cliente, args)
    except requests.RequestException as error:
        print(f"ERROR de conexión con el Gateway: {error}")
        sys.exit(2)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()

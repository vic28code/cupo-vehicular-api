# Cupo vehicular API

Servicio serverless que lleva la cuenta corriente del cupo vehicular de cada colaborador.
El saldo aumenta cuando se acredita el cupo mensual y disminuye con dos fuentes de gasto:

- las facturas (`SGR_FACTURAS`)
- los consumos en GasClub (`SGR_GASCLUB_GASTOS`)

Tecnología y documentación:

- **Lambda:** Node.js con Serverless Framework 3 y `serverless-offline`.
- **Base de datos:** PostgreSQL 18 en Docker.
- **Modelo de datos y decisiones:** [docs/MODELO.md](docs/MODELO.md), también en [PDF](docs/MODELO.pdf).

## Requisitos

- Node.js 22 o superior.
- Docker (Docker Desktop en Windows o Mac).
- Opcional: [Bruno](https://www.usebruno.com/) para enviar las peticiones y un cliente SQL como DBeaver.

No se necesita cuenta de AWS ni de Serverless: todo corre en local.

## Puesta en marcha

```bash
git clone https://github.com/vic28code/cupo-vehicular-api.git
cd cupo-vehicular-api
cp .env.example .env      # en PowerShell: Copy-Item .env.example .env
docker compose up -d      # PostgreSQL con las tablas y los datos de ejemplo
npm install
npm start                 # la lambda queda en http://localhost:3000
```

Para comprobar que la lambda llega a la base, abre <http://localhost:3000/salud>.

Notas:

- Al arrancar aparece el aviso `Invalid configuration encountered at 'provider.runtime'`.
  Es esperado: Serverless Framework 3 no reconoce los runtimes posteriores a `nodejs20.x`.
  En local, el código se ejecuta con el Node instalado en la máquina.
- `npm install` muestra avisos `deprecated` propios de Serverless Framework 3. Se eligió
  la versión 3 porque la 4 obliga a iniciar sesión con una cuenta de Serverless.
- Los scripts de `db/` se ejecutan solo cuando la base se crea por primera vez.
  `npm run db:reset` la borra y la vuelve a crear con los datos de ejemplo.
- Si el puerto 5432 está ocupado, cambia el mapeo en `docker-compose.yml`
  (por ejemplo `"5433:5432"`) y `DB_PORT` en `.env`.

### Sin Docker

Crea una base en tu PostgreSQL, ejecuta en orden los tres scripts de `db/` y pon tus datos
de conexión en `.env`. La fecha de las facturas usa la zona horaria de la base; el
`docker-compose.yml` la fija en `America/Guayaquil`.

## Endpoints

| # | Método y ruta | Cuerpo | Respuesta |
|---|---|---|---|
| 1 | `POST /colaboradores` | `{ "cedula", "cupoMensual" }` | 201 |
| 2 | `PUT /colaboradores/{cedula}/cupo` | `{ "cupoMensual", "motivo" }` (`motivo` opcional) | 200 |
| 3 | `POST /colaboradores/{cedula}/acreditaciones` | sin cuerpo | 201 |
| 4 | `POST /facturas` | `{ "cedula", "numeroFactura", "rucProveedor", "total" }` | 201 |
| 5 | `POST /sincronizaciones/facturas` | sin cuerpo | 200 |
| 6 | `POST /sincronizaciones/gasclub` | sin cuerpo | 200 |

Los errores responden `{ "error": "mensaje" }` con uno de estos códigos:

| Código | Significado |
|---|---|
| 400 | Datos mal formados (cédula, RUC, número de factura, monto, JSON inválido) |
| 404 | El colaborador no existe |
| 409 | Duplicado: la cédula o la factura ya están registradas |
| 422 | La petición es válida pero una regla la rechaza (saldo insuficiente, cupo sin cambio, cupo en 0) |

Formatos: la cédula es un texto de 10 dígitos, el RUC de 13 dígitos, el número de factura
sigue el formato `001-001-000000123` y los montos admiten hasta 2 decimales.

## Cómo probar

La carpeta `bruno/` contiene una colección con las 6 peticiones: en Bruno, elige
*Open Collection* y selecciona esa carpeta.

Los ejemplos siguientes usan `curl` en bash (Git Bash, macOS o Linux). En Windows lo más
simple es usar la colección de Bruno. Las sentencias SQL se ejecutan en la base
(`localhost:5432`, base `cupo_vehicular`, usuario y clave `postgres`).

**1. Crear un colaborador, actualizar su cupo y acreditarlo**

```bash
curl -X POST http://localhost:3000/colaboradores -H "Content-Type: application/json" -d '{"cedula": "0912345678", "cupoMensual": 300}'
curl -X PUT http://localhost:3000/colaboradores/0912345678/cupo -H "Content-Type: application/json" -d '{"cupoMensual": 350, "motivo": "Ajuste por cambio de cargo"}'
curl -X POST http://localhost:3000/colaboradores/0912345678/acreditaciones
```

El cambio de cupo no toca el saldo. Tras acreditar, el saldo es **350.00**.

**2. Insertar consumos de GasClub a mano y sincronizar**

```sql
INSERT INTO sgr_gasclub_gastos (id, cedula, referencia, total, fecha) VALUES
(11, '0912345678', 'GC-002001', 10.00, '2026-10-01'),
(12, '0999999999', 'GC-002002', 99.00, '2026-10-01');
```

```bash
curl -X POST http://localhost:3000/sincronizaciones/gasclub
```

Responde `registrosInsertados: 3`: los dos consumos de ejemplo del colaborador y el nuevo.
El consumo de la cédula `0999999999` se ignora porque no está registrada.
El saldo queda en **284.50**.

**3. Registrar una factura, aprobarla a mano y sincronizar**

```bash
curl -X POST http://localhost:3000/facturas -H "Content-Type: application/json" -d '{"cedula": "0912345678", "numeroFactura": "001-001-000000999", "rucProveedor": "1790012345001", "total": 15.00}'
```

La factura se crea con ID 11 y estado `Pendiente` en `SGR_FACTURAS` y en `CV_MOVIMIENTOS`.
El saldo queda en **269.50**.

```sql
UPDATE sgr_facturas SET estado = 'Aprobado' WHERE id = 11;
```

```bash
curl -X POST http://localhost:3000/sincronizaciones/facturas
```

Responde `registrosActualizados: 1` (la factura 11 pasa a `Aprobado` sin descontarse otra
vez) y `registrosInsertados: 3` (las tres facturas de ejemplo del colaborador, que se
importan con su estado). El saldo queda en **44.00**.

**4. Repetir las sincronizaciones**

Ejecutar de nuevo cualquiera de las dos responde `registrosInsertados: 0` y
`registrosActualizados: 0`, y el saldo no cambia.

## Verificación en la base

`consultas/verificacion.sql` reúne las consultas para revisar el resultado:

- las tablas del esquema y sus restricciones (debe devolver 0 restricciones);
- el saldo guardado de cada colaborador contra el calculado desde sus movimientos (diferencia 0);
- el estado de cuenta de un colaborador, movimiento por movimiento;
- los consumos y facturas del origen que aún no están alineados con el libro (0 filas tras sincronizar);
- el historial de sincronizaciones.

## Estructura

```
bruno/                  colección de peticiones
consultas/              consultas de verificación
db/                     scripts SQL: tablas dadas, datos de ejemplo y tablas propias
docs/                   modelo de datos y decisiones (MODELO.md y su versión en PDF)
src/handler.js          entrada de la lambda y tabla de rutas
src/http.js             lectura del cuerpo y armado de respuestas
src/errores.js          error de negocio con su código HTTP
src/validaciones.js     validación de cédula, RUC, número de factura y montos
src/db.js               conexión y transacciones
src/servicios/          lógica de cada endpoint
docker-compose.yml      PostgreSQL 18
serverless.yml          definición de la lambda y sus rutas
```

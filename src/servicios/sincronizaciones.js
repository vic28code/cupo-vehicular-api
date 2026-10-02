const { enTransaccion } = require('../db');

/**
 * Abre el registro de una sincronización.
 * Las dos sincronizaciones comparten un candado: nunca corren dos a la vez,
 * así un mismo gasto no se importa dos veces.
 *
 * @param {import('pg').PoolClient} cliente - cliente dentro de una transacción.
 * @param {'Facturas'|'GasClub'} tipo - fuente que se sincroniza.
 * @returns {Promise<number>} - id de la sincronización.
 */
async function iniciarSincronizacion(cliente, tipo) {
    await cliente.query("SELECT pg_advisory_xact_lock(hashtext('sincronizacion'))");

    const { rows } = await cliente.query(
        `INSERT INTO cv_sincronizaciones (tipo, fecha_inicio)
         VALUES ($1, NOW())
         RETURNING id`,
        [tipo],
    );
    return rows[0].id;
}

/**
 * Cierra el registro de una sincronización con sus resultados.
 *
 * @param {import('pg').PoolClient} cliente - cliente dentro de una transacción.
 * @param {number} id - id de la sincronización.
 * @param {{ leidos: number, insertados: number, actualizados: number }} conteo - resultado de la ejecución.
 * @returns {Promise<Object>} - resumen de la sincronización.
 */
async function cerrarSincronizacion(cliente, id, { leidos, insertados, actualizados }) {
    const { rows } = await cliente.query(
        `UPDATE cv_sincronizaciones
            SET fecha_fin = clock_timestamp(),
                registros_leidos = $2,
                registros_insertados = $3,
                registros_actualizados = $4
          WHERE id = $1
         RETURNING id AS "sincronizacionId", tipo,
                   registros_leidos AS "registrosLeidos",
                   registros_insertados AS "registrosInsertados",
                   registros_actualizados AS "registrosActualizados",
                   fecha_inicio AS "fechaInicio", fecha_fin AS "fechaFin"`,
        [id, leidos, insertados, actualizados],
    );
    return rows[0];
}

/**
 * Descuenta un gasto del saldo y lo registra como débito en el libro.
 * No valida el saldo: el gasto ya ocurrió en su origen, así que puede dejarlo en negativo.
 *
 * @param {import('pg').PoolClient} cliente - cliente dentro de una transacción.
 * @param {Object} gasto - datos del gasto leídos de la tabla de origen.
 * @param {string} gasto.cedula - cédula del colaborador.
 * @param {'Facturas'|'GasClub'} gasto.origen - de dónde viene el gasto.
 * @param {string} gasto.total - monto como texto, tal como lo entrega Postgres.
 * @param {string|null} gasto.estado - 'Pendiente' | 'Aprobado' (solo facturas).
 * @param {number|null} gasto.idOrigen - id de la fila en la tabla de origen.
 * @param {string} gasto.referencia - número de factura o referencia de GasClub.
 * @param {string|null} gasto.rucProveedor - RUC del proveedor (solo facturas).
 * @param {string|null} gasto.fecha - fecha del gasto en su origen.
 * @param {number} gasto.sincronizacionId - sincronización que lo importa.
 * @returns {Promise<void>}
 */
async function registrarGasto(cliente, gasto) {
    await cliente.query(
        `WITH descontado AS (
            UPDATE cv_colaboradores
               SET saldo = saldo - $2,
                   fecha_actualizacion = NOW()
             WHERE cedula = $1
            RETURNING cedula, saldo
         )
         INSERT INTO cv_movimientos
            (cedula, tipo, origen, monto, estado, id_origen, referencia, ruc_proveedor,
             fecha_movimiento, saldo_resultante, sincronizacion_id, fecha_registro, fecha_aprobacion)
         SELECT cedula, 'Debito', $3, $2, $4::varchar, $5, $6, $7,
                $8::date, saldo, $9, NOW(),
                CASE WHEN $4::varchar = 'Aprobado' THEN NOW() END
           FROM descontado`,
        [
            gasto.cedula,
            gasto.total,
            gasto.origen,
            gasto.estado,
            gasto.idOrigen,
            gasto.referencia,
            gasto.rucProveedor,
            gasto.fecha,
            gasto.sincronizacionId,
        ],
    );
}

/**
 * Endpoint 6: importa los consumos de SGR_GASCLUB_GASTOS que aún no están en el libro.
 * Siempre se registran, aunque dejen el saldo en negativo, porque ya ocurrieron.
 *
 * @returns {Promise<Object>} - resumen de la sincronización.
 */
async function sincronizarGasClub() {
    return enTransaccion(async (cliente) => {
        const sincronizacionId = await iniciarSincronizacion(cliente, 'GasClub');

        // el JOIN deja solo los consumos de colaboradores registrados.
        // no se guarda un "último id procesado": cada consumo se compara contra el libro,
        // así los de un colaborador que se registra después entran en la siguiente ejecución.
        // un consumo sin referencia o sin total no se puede identificar ni descontar.
        const { rows: consumos } = await cliente.query(
            `SELECT g.id, g.cedula, g.referencia, g.total::text AS total, g.fecha,
                    EXISTS (
                        SELECT 1
                          FROM cv_movimientos m
                         WHERE m.origen = 'GasClub'
                           AND m.referencia = g.referencia
                    ) AS importado
               FROM sgr_gasclub_gastos g
               JOIN cv_colaboradores c ON c.cedula = g.cedula
              WHERE g.referencia IS NOT NULL
                AND g.total > 0
              ORDER BY g.fecha, g.id`,
        );

        let insertados = 0;
        const referencias = new Set();

        for (const consumo of consumos) {
            // la referencia identifica al consumo: si ya está en el libro (o se repite
            // en la misma lectura) no se vuelve a descontar.
            if (consumo.importado || referencias.has(consumo.referencia)) continue;
            referencias.add(consumo.referencia);

            await registrarGasto(cliente, {
                cedula: consumo.cedula,
                origen: 'GasClub',
                total: consumo.total,
                estado: null,
                idOrigen: consumo.id,
                referencia: consumo.referencia,
                rucProveedor: null,
                fecha: consumo.fecha,
                sincronizacionId,
            });
            insertados += 1;
        }

        return cerrarSincronizacion(cliente, sincronizacionId, {
            leidos: consumos.length,
            insertados,
            actualizados: 0,
        });
    });
}

/**
 * Endpoint 5: alinea el libro con SGR_FACTURAS.
 * Importa las facturas que faltan y actualiza el estado de las que cambiaron.
 * Una factura que ya estaba en el libro no se vuelve a descontar.
 *
 * @returns {Promise<Object>} - resumen de la sincronización.
 */
async function sincronizarFacturas() {
    return enTransaccion(async (cliente) => {
        const sincronizacionId = await iniciarSincronizacion(cliente, 'Facturas');

        // el JOIN deja solo las facturas de colaboradores registrados y el LEFT JOIN
        // trae el movimiento que ya existe para cada factura, si lo hay.
        // la aprobación se hace a mano y la tabla no tiene CHECK: el estado se normaliza.
        const { rows: facturas } = await cliente.query(
            `SELECT f.id, f.cedula, f.numero_factura AS "numeroFactura",
                    f.ruc_proveedor AS "rucProveedor", f.total::text AS total, f.fecha,
                    CASE WHEN LOWER(TRIM(f.estado)) = 'aprobado'
                         THEN 'Aprobado' ELSE 'Pendiente' END AS estado,
                    m.id AS "movimientoId", m.estado AS "estadoEnLibro"
               FROM sgr_facturas f
               JOIN cv_colaboradores c ON c.cedula = f.cedula
               LEFT JOIN cv_movimientos m
                      ON m.origen = 'Facturas'
                     AND m.referencia = f.numero_factura
                     AND m.ruc_proveedor = f.ruc_proveedor
              WHERE f.numero_factura IS NOT NULL
                AND f.ruc_proveedor IS NOT NULL
                AND f.total > 0
              ORDER BY f.fecha, f.id`,
        );

        let insertados = 0;
        let actualizados = 0;
        const importadas = new Set();

        for (const factura of facturas) {
            // una factura se identifica por el RUC del proveedor y su número.
            const clave = `${factura.rucProveedor}|${factura.numeroFactura}`;

            if (factura.movimientoId === null) {
                if (importadas.has(clave)) continue;
                importadas.add(clave);

                await registrarGasto(cliente, {
                    cedula: factura.cedula,
                    origen: 'Facturas',
                    total: factura.total,
                    estado: factura.estado,
                    idOrigen: factura.id,
                    referencia: factura.numeroFactura,
                    rucProveedor: factura.rucProveedor,
                    fecha: factura.fecha,
                    sincronizacionId,
                });
                insertados += 1;
            } else if (factura.estado !== factura.estadoEnLibro) {
                // solo cambia el estado: el total ya se descontó cuando se registró.
                await cliente.query(
                    `UPDATE cv_movimientos
                        SET estado = $2::varchar,
                            fecha_aprobacion = CASE WHEN $2::varchar = 'Aprobado' THEN NOW() END
                      WHERE id = $1`,
                    [factura.movimientoId, factura.estado],
                );
                actualizados += 1;
            }
        }

        return cerrarSincronizacion(cliente, sincronizacionId, {
            leidos: facturas.length,
            insertados,
            actualizados,
        });
    });
}

module.exports = { sincronizarFacturas, sincronizarGasClub };
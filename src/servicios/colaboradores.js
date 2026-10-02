const { enTransaccion } = require('../db');
const { ErrorNegocio } = require('../errores');
const { validarCedula, validarMonto, validarTextoOpcional } = require('../validaciones');

/**
 * Busca un colaborador y bloquea su fila hasta que termine la transacción,
 * para que otra petición no lo modifique al mismo tiempo.
 *
 * @param {import('pg').PoolClient} cliente - cliente dentro de una transacción.
 * @param {string} cedula - cédula ya validada.
 * @returns {Promise<{ cedula: string, cupoMensual: number, saldo: number }>} - el colaborador encontrado.
 * @throws {ErrorNegocio} - 404 si el colaborador no existe.
 */
async function bloquearColaborador(cliente, cedula) {
    const { rows } = await cliente.query(
        `SELECT cedula, cupo_mensual AS "cupoMensual", saldo
           FROM cv_colaboradores
          WHERE cedula = $1
            FOR UPDATE`,
        [cedula],
    );
    if (rows.length === 0) {
        throw new ErrorNegocio(404, `No existe un colaborador con la cédula ${cedula}`);
    }
    return rows[0];
}

/**
 * Endpoint 1: registra un colaborador con su cupo mensual.
 * El saldo inicia en 0; solo aumenta al acreditar el cupo (endpoint 3).
 *
 * @param {{ cedula?: unknown, cupoMensual?: unknown }} datos - cuerpo de la petición.
 * @returns {Promise<Object>} - el colaborador creado.
 * @throws {ErrorNegocio} - 400 si los datos no son válidos, 409 si la cédula ya existe.
 */
async function crearColaborador(datos) {
    const cedula = validarCedula(datos.cedula);
    const cupoMensual = validarMonto(datos.cupoMensual, 'cupoMensual', { permitirCero: true });

    return enTransaccion(async (cliente) => {
        // la tabla no tiene UNIQUE: este candado hace que dos peticiones con la misma
        // cédula se atiendan una tras otra, y la segunda ya encuentra a la primera.
        await cliente.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`colaborador:${cedula}`]);

        const existente = await cliente.query(
            'SELECT 1 FROM cv_colaboradores WHERE cedula = $1',
            [cedula],
        );
        if (existente.rowCount > 0) {
            throw new ErrorNegocio(409, `Ya existe un colaborador con la cédula ${cedula}`);
        }

        const { rows } = await cliente.query(
            `INSERT INTO cv_colaboradores (cedula, cupo_mensual, saldo, fecha_creacion, fecha_actualizacion)
             VALUES ($1, $2, 0, NOW(), NOW())
             RETURNING id, cedula, cupo_mensual AS "cupoMensual", saldo, fecha_creacion AS "fechaCreacion"`,
            [cedula, cupoMensual],
        );

        await cliente.query(
            `INSERT INTO cv_historial_cupo (cedula, cupo_anterior, cupo_nuevo, motivo, fecha)
             VALUES ($1, NULL, $2, 'Creación del colaborador', NOW())`,
            [cedula, cupoMensual],
        );

        return rows[0];
    });
}

/**
 * Endpoint 2: cambia el cupo mensual y deja el cambio en el historial.
 * No modifica el saldo: el saldo solo aumenta al acreditar (endpoint 3).
 *
 * @param {unknown} cedulaRecibida - cédula que viene en la URL.
 * @param {{ cupoMensual?: unknown, motivo?: unknown }} datos - cuerpo de la petición.
 * @returns {Promise<Object>} - el colaborador con su cupo anterior y el nuevo.
 * @throws {ErrorNegocio} - 400 si los datos no son válidos, 404 si no existe, 422 si el cupo no cambia.
 */
async function actualizarCupo(cedulaRecibida, datos) {
    const cedula = validarCedula(cedulaRecibida);
    const cupoNuevo = validarMonto(datos.cupoMensual, 'cupoMensual', { permitirCero: true });
    const motivo = validarTextoOpcional(datos.motivo, 'motivo', 200);

    return enTransaccion(async (cliente) => {
        const colaborador = await bloquearColaborador(cliente, cedula);

        // la petición es válida, pero no hay nada que cambiar: se rechaza
        // para no llenar el historial con cambios que no cambian nada.
        if (Number(cupoNuevo) === colaborador.cupoMensual) {
            throw new ErrorNegocio(422, `El cupo mensual ya es ${cupoNuevo}`);
        }

        const { rows } = await cliente.query(
            `UPDATE cv_colaboradores
                SET cupo_mensual = $2,
                    fecha_actualizacion = NOW()
              WHERE cedula = $1
             RETURNING cedula, cupo_mensual AS "cupoMensual", saldo,
                       fecha_actualizacion AS "fechaActualizacion"`,
            [cedula, cupoNuevo],
        );

        await cliente.query(
            `INSERT INTO cv_historial_cupo (cedula, cupo_anterior, cupo_nuevo, motivo, fecha)
             VALUES ($1, $2, $3, $4, NOW())`,
            [cedula, colaborador.cupoMensual, cupoNuevo, motivo],
        );

        return { ...rows[0], cupoAnterior: colaborador.cupoMensual };
    });
}

/**
 * Endpoint 3: suma el cupo mensual al saldo, como una recarga,
 * y registra el crédito en el libro de movimientos.
 *
 * @param {unknown} cedulaRecibida - cédula que viene en la URL.
 * @returns {Promise<Object>} - el movimiento creado y el saldo resultante.
 * @throws {ErrorNegocio} - 400 si la cédula no es válida, 404 si no existe,
 *   422 si el colaborador no tiene cupo asignado.
 */
async function acreditarCupo(cedulaRecibida) {
    const cedula = validarCedula(cedulaRecibida);

    return enTransaccion(async (cliente) => {
        const colaborador = await bloquearColaborador(cliente, cedula);

        if (colaborador.cupoMensual === 0) {
            throw new ErrorNegocio(422, 'El colaborador no tiene cupo mensual asignado');
        }

        // la suma la hace Postgres, y el movimiento guarda el saldo
        // resultante en la misma sentencia.
        const { rows } = await cliente.query(
            `WITH actualizado AS (
                UPDATE cv_colaboradores
                   SET saldo = saldo + cupo_mensual,
                       fecha_actualizacion = NOW()
                 WHERE cedula = $1
                RETURNING cedula, cupo_mensual, saldo
             )
             INSERT INTO cv_movimientos
                (cedula, tipo, origen, monto, fecha_movimiento, saldo_resultante, fecha_registro)
             SELECT cedula, 'Credito', 'Acreditacion', cupo_mensual, CURRENT_DATE, saldo, NOW()
               FROM actualizado
             RETURNING id AS "movimientoId", cedula, monto AS "montoAcreditado",
                       saldo_resultante AS "saldo", fecha_movimiento AS "fecha"`,
            [cedula],
        );

        return rows[0];
    });
}

module.exports = { bloquearColaborador, crearColaborador, actualizarCupo, acreditarCupo };
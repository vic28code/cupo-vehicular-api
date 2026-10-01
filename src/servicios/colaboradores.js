const { enTransaccion } = require('../db');
const { ErrorNegocio } = require('../errores');
const { validarCedula, validarMonto } = require('../validaciones');

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

module.exports = { crearColaborador };
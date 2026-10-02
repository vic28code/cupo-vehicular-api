const { enTransaccion } = require('../db');
const { ErrorNegocio } = require('../errores');
const {
    validarCedula,
    validarMonto,
    validarRuc,
    validarNumeroFactura,
} = require('../validaciones');
const { bloquearColaborador } = require('./colaboradores');

/**
 * Endpoint 4: registra una factura de un colaborador.
 * La crea como Pendiente en SGR_FACTURAS y en cv_movimientos,
 * y descuenta su total del saldo, todo en la misma transacción.
 *
 * @param {{ cedula?: unknown, numeroFactura?: unknown, rucProveedor?: unknown, total?: unknown }} datos - cuerpo de la petición.
 * @returns {Promise<Object>} - la factura registrada y el saldo resultante.
 * @throws {ErrorNegocio} - 400 si los datos no son válidos, 404 si el colaborador no existe,
 *   409 si la factura ya está registrada, 422 si el saldo no alcanza.
 */
async function registrarFactura(datos) {
    const cedula = validarCedula(datos.cedula);
    const numeroFactura = validarNumeroFactura(datos.numeroFactura);
    const rucProveedor = validarRuc(datos.rucProveedor);
    const total = validarMonto(datos.total, 'total');

    return enTransaccion(async (cliente) => {
        // SGR_FACTURAS no tiene UNIQUE ni autoincremento: este candado hace que las
        // facturas se registren de una en una, para no repetir un ID ni una factura.
        await cliente.query("SELECT pg_advisory_xact_lock(hashtext('sgr_facturas'))");

        const colaborador = await bloquearColaborador(cliente, cedula);

        // un proveedor (RUC) no emite dos facturas con el mismo número.
        const duplicada = await cliente.query(
            `SELECT 1
               FROM sgr_facturas
              WHERE ruc_proveedor = $1
                AND numero_factura = $2`,
            [rucProveedor, numeroFactura],
        );
        if (duplicada.rowCount > 0) {
            throw new ErrorNegocio(
                409,
                `La factura ${numeroFactura} del proveedor ${rucProveedor} ya está registrada`,
            );
        }

        // la factura pendiente descuenta saldo desde que se registra: no existen
        // rechazos, así que toda factura pendiente terminará aprobada.
        // el WHERE hace que solo se descuente si el saldo alcanza.
        const descuento = await cliente.query(
            `UPDATE cv_colaboradores
                SET saldo = saldo - $2,
                    fecha_actualizacion = NOW()
              WHERE cedula = $1
                AND saldo >= $2
             RETURNING saldo`,
            [cedula, total],
        );
        if (descuento.rowCount === 0) {
            throw new ErrorNegocio(
                422,
                `Saldo insuficiente: el saldo disponible es ${colaborador.saldo.toFixed(2)} `
                + `y el total de la factura es ${Number(total).toFixed(2)}`,
            );
        }

        const factura = await cliente.query(
            `INSERT INTO sgr_facturas (id, cedula, numero_factura, ruc_proveedor, total, fecha, estado)
             SELECT COALESCE(MAX(id), 0) + 1, $1, $2, $3, $4, CURRENT_DATE, 'Pendiente'
               FROM sgr_facturas
             RETURNING id AS "facturaId", cedula, numero_factura AS "numeroFactura",
                       ruc_proveedor AS "rucProveedor", total, fecha, estado`,
            [cedula, numeroFactura, rucProveedor, total],
        );

        const movimiento = await cliente.query(
            `INSERT INTO cv_movimientos
                (cedula, tipo, origen, monto, estado, id_origen, referencia, ruc_proveedor,
                 fecha_movimiento, saldo_resultante, fecha_registro)
             SELECT cedula, 'Debito', 'Facturas', $2, 'Pendiente', $3, $4, $5,
                    CURRENT_DATE, saldo, NOW()
               FROM cv_colaboradores
              WHERE cedula = $1
             RETURNING id AS "movimientoId", saldo_resultante AS "saldo"`,
            [cedula, total, factura.rows[0].facturaId, numeroFactura, rucProveedor],
        );

        return { ...factura.rows[0], ...movimiento.rows[0] };
    });
}

module.exports = { registrarFactura };
const { pool } = require('./db');

/**
 * Respuesta HTTP en el formato que exige API Gateway.
 *
 * @typedef {Object} RespuestaHttp
 * @property {number} statusCode - Código HTTP.
 * @property {Object.<string, string>} headers - Cabeceras HTTP.
 * @property {string} body - Cuerpo de la respuesta, serializado como JSON.
 */

/**
 * Punto de entrada de la lambda. Por ahora solo atiende GET /salud,
 * que verifica la conexión con la base de datos.
 *
 * @param {import('aws-lambda').APIGatewayProxyEventV2} event - Petición HTTP recibida desde API Gateway.
 * @returns {Promise<RespuestaHttp>} Respuesta HTTP con cuerpo JSON.
 */
module.exports.main = async (event) => {
    try {
        const { rows } = await pool.query(`
      SELECT current_setting('TimeZone')               AS zona_horaria,
             TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')   AS hora_servidor,
             (SELECT COUNT(*) FROM sgr_facturas)       AS facturas,
             (SELECT COUNT(*) FROM sgr_gasclub_gastos) AS consumos_gasclub
    `);

        return responder(200, {
            ruta: event.routeKey,
            baseDeDatos: 'ok',
            ...rows[0],
        });
    } catch (error) {
        console.error(error);
        return responder(500, {
            error: 'No se pudo consultar la base de datos',
            detalle: error.message,
        });
    }
};

/**
 * Arma una respuesta HTTP con cuerpo JSON.
 *
 * @param {number} statusCode - Código HTTP (200, 400, 404, etc.).
 * @param {Object} body - Objeto que se enviará como JSON.
 * @returns {RespuestaHttp} Respuesta lista para devolver desde la lambda.
 */
function responder(statusCode, body) {
    return {
        statusCode,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    };
}
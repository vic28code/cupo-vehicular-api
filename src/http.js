const { ErrorNegocio } = require('./errores');

/**
 * Respuesta HTTP en el formato que exige API Gateway.
 *
 * @typedef {Object} RespuestaHttp
 * @property {number} statusCode - código HTTP.
 * @property {Object.<string, string>} headers - Cabeceras HTTP.
 * @property {string} body - Cuerpo de la respuesta, serializado como JSON.
 */

/**
 * Arma una respuesta HTTP con cuerpo JSON.
 *
 * @param {number} statusCode - código HTTP (200, 400, 404, etc.).
 * @param {Object} body - objeto que se enviará como JSON.
 * @returns {RespuestaHttp} - respuesta lista para devolver desde la lambda.
 */
function responder(statusCode, body) {
    return {
        statusCode,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    };
}

/**
 * Lee el cuerpo JSON de la petición.
 *
 * @param {import('aws-lambda').APIGatewayProxyEventV2} event - petición recibida.
 * @returns {Object} - el cuerpo convertido a objeto ({} si viene vacío).
 * @throws {ErrorNegocio} - 400 si el cuerpo no es un objeto JSON válido.
 */
function leerCuerpo(event) {
    if (!event.body) return {};

    const texto = event.isBase64Encoded
        ? Buffer.from(event.body, 'base64').toString('utf8')
        : event.body;

    let cuerpo;
    try {
        cuerpo = JSON.parse(texto);
    } catch {
        throw new ErrorNegocio(400, 'El cuerpo de la petición no es un JSON válido');
    }

    if (cuerpo === null || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) {
        throw new ErrorNegocio(400, 'El cuerpo de la petición debe ser un objeto JSON');
    }
    return cuerpo;
}

module.exports = { responder, leerCuerpo };
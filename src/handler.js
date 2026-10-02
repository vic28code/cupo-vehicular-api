const { responder, leerCuerpo } = require('./http');
const { ErrorNegocio } = require('./errores');
const { verificarSalud } = require('./servicios/salud');
const {
    crearColaborador,
    actualizarCupo,
    acreditarCupo,
} = require('./servicios/colaboradores');
const { registrarFactura } = require('./servicios/facturas');
const { sincronizarFacturas, sincronizarGasClub } = require('./servicios/sincronizaciones');

/**
 * Tabla de rutas: cada routeKey de API Gateway apunta a la función que la atiende.
 * Cada función devuelve el código HTTP y los datos de la respuesta.
 */
const rutas = {
    'GET /salud': async () => ({
        statusCode: 200,
        datos: await verificarSalud(),
    }),
    'POST /colaboradores': async (event) => ({
        statusCode: 201,
        datos: await crearColaborador(leerCuerpo(event)),
    }),
    'PUT /colaboradores/{cedula}/cupo': async (event) => ({
        statusCode: 200,
        datos: await actualizarCupo(event.pathParameters?.cedula, leerCuerpo(event)),
    }),
    'POST /colaboradores/{cedula}/acreditaciones': async (event) => ({
        statusCode: 201,
        datos: await acreditarCupo(event.pathParameters?.cedula),
    }),
    'POST /facturas': async (event) => ({
        statusCode: 201,
        datos: await registrarFactura(leerCuerpo(event)),
    }),
    'POST /sincronizaciones/facturas': async () => ({
        statusCode: 200,
        datos: await sincronizarFacturas(),
    }),
    'POST /sincronizaciones/gasclub': async () => ({
        statusCode: 200,
        datos: await sincronizarGasClub(),
    }),
};

/**
 * Punto de entrada de la lambda: busca la ruta y convierte los errores
 * en respuestas HTTP.
 *
 * @param {import('aws-lambda').APIGatewayProxyEventV2} event - petición recibida desde API Gateway.
 * @returns {Promise<import('./http').RespuestaHttp>} - respuesta HTTP con cuerpo JSON.
 */
module.exports.main = async (event) => {
    const ruta = rutas[event.routeKey];
    if (!ruta) {
        return responder(404, { error: `Ruta no encontrada: ${event.routeKey}` });
    }

    try {
        const { statusCode, datos } = await ruta(event);
        return responder(statusCode, datos);
    } catch (error) {
        if (error instanceof ErrorNegocio) {
            return responder(error.statusCode, { error: error.message });
        }
        console.error(error);
        return responder(500, { error: 'Error interno del servidor' });
    }
};
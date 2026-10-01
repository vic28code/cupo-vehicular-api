/**
 * Error esperado de la lógica de negocio: datos inválidos, duplicados,
 * saldo insuficiente, etc. Lleva el código HTTP con el que se responde.
 */
class ErrorNegocio extends Error {
    /**
     * @param {number} statusCode - código HTTP de la respuesta.
     * @param {string} mensaje - mensaje para el cliente.
     */
    constructor(statusCode, mensaje) {
        super(mensaje);
        this.name = 'ErrorNegocio';
        this.statusCode = statusCode;
    }
}

module.exports = { ErrorNegocio };
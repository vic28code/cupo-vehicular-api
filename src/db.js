const { Pool, types } = require('pg');

// numeric en sql es exacto, ahí se hacen las cuentas con dinero.
// pero pg devuelve numeric y bigint como texto para no perder precisión, y eso es lo que se devuelve en la respuesta JSON.
// entonces la conversión es solo para la respuesta JSON, para que no sea texto sino número.

types.setTypeParser(types.builtins.NUMERIC, (valor) => parseFloat(valor));
types.setTypeParser(types.builtins.INT8, (valor) => parseInt(valor, 10));
types.setTypeParser(types.builtins.DATE, (valor) => valor);

/**
 * Pool de conexiones compartido.
 * Se crea una vez y Lambda lo reutiliza entre invocaciones.
 *
 * @type {import('pg').Pool}
 */

const pool = new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    max: 5,
});

/**
 * Ejecuta un trabajo dentro de una transacción:
 * si todo sale bien se confirma,
 * y si algo lanza un error se revierte completo.
 *
 * @template T
 * @param {(cliente: import('pg').PoolClient) => Promise<T>} trabajo - operaciones a ejecutar con el mismo cliente.
 * @returns {Promise<T>} - lo que devuelva el trabajo.
 */

async function enTransaccion(trabajo) {
    const cliente = await pool.connect();
    try {
        await cliente.query('BEGIN');
        const resultado = await trabajo(cliente);
        await cliente.query('COMMIT');
        return resultado;
    } catch (error) {
        await cliente.query('ROLLBACK');
        throw error;
    } finally {
        cliente.release();
    }
}

module.exports = { pool, enTransaccion };
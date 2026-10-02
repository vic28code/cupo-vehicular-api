const { Pool, types } = require('pg');

// numeric en sql es exacto, ahí se hacen las cuentas con dinero.
// pero pg devuelve numeric y bigint como texto para no perder precisión, y eso es lo que se devuelve en la respuesta JSON.
// entonces la conversión es solo para la respuesta JSON, para que no sea texto sino número.

types.setTypeParser(types.builtins.NUMERIC, (valor) => parseFloat(valor));
types.setTypeParser(types.builtins.INT8, (valor) => parseInt(valor, 10));
// las fechas (DATE) se dejan como texto 'YYYY-MM-DD' para que no se desfasen por la zona horaria.
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

// si la base se reinicia, las conexiones inactivas del pool emiten un error.
// sin este manejador, ese error tumba el proceso de la lambda.
pool.on('error', (error) => {
    console.error('Conexión inactiva descartada:', error.message);
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
        // si el ROLLBACK también falla (conexión caída), se conserva el error original.
        await cliente.query('ROLLBACK').catch(() => { });
        throw error;
    } finally {
        cliente.release();
    }
}

module.exports = { pool, enTransaccion };
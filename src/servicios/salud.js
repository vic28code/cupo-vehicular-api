const { pool } = require('../db');

/**
 * Verifica la conexión con la base de datos.
 *
 * @returns {Promise<Object>} - estado de la base, zona horaria y hora del servidor.
 */
async function verificarSalud() {
    const { rows } = await pool.query(`
    SELECT current_setting('TimeZone')             AS "zonaHoraria",
           TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS') AS "horaServidor"
  `);
    return { baseDeDatos: 'ok', ...rows[0] };
}

module.exports = { verificarSalud };
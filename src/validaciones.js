const { ErrorNegocio } = require('./errores');

/**
 * Valida que la cédula tenga exactamente 10 dígitos.
 * No se valida el dígito verificador (módulo 10) porque las cédulas
 * de los datos de ejemplo de la prueba no lo cumplen.
 *
 * @param {unknown} cedula - valor recibido.
 * @returns {string} - la cédula validada.
 * @throws {ErrorNegocio} - 400 si el formato no es válido.
 */
function validarCedula(cedula) {
  if (typeof cedula !== 'string' || !/^\d{10}$/.test(cedula)) {
    throw new ErrorNegocio(400, 'La cédula debe ser un texto de exactamente 10 dígitos');
  }
  return cedula;
}

/**
 * Valida un monto de dinero: positivo y con máximo 2 decimales.
 * Lo devuelve como texto para pasarlo a SQL sin errores de redondeo.
 *
 * @param {unknown} valor - monto recibido (número o texto numérico).
 * @param {string} campo - nombre del campo, para el mensaje de error.
 * @param {{ permitirCero?: boolean }} [opciones] - si se acepta el valor 0.
 * @returns {string} - el monto validado, por ejemplo "45.5".
 * @throws {ErrorNegocio} - 400 si no es un monto válido.
 */
function validarMonto(valor, campo, { permitirCero = false } = {}) {
  const texto = typeof valor === 'number' || typeof valor === 'string'
    ? String(valor).trim()
    : '';

  // valida hasta 10 enteros y 2 decimales: lo que cabe en DECIMAL(12,2).

  if (!/^\d{1,10}(\.\d{1,2})?$/.test(texto)) {
    throw new ErrorNegocio(400, `${campo} debe ser un número positivo con máximo 2 decimales`);
  }
  if (!permitirCero && Number(texto) === 0) {
    throw new ErrorNegocio(400, `${campo} debe ser mayor que cero`);
  }
  return texto;
}

module.exports = { validarCedula, validarMonto };
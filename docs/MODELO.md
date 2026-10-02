# Modelo de datos y decisiones

## Modelo

Cada colaborador tiene una cuenta corriente, llevada como un libro de movimientos.

| Tabla | Contenido |
|---|---|
| `CV_COLABORADORES` | Cédula, cupo mensual y saldo actual. |
| `CV_MOVIMIENTOS` | El libro: cada acreditación (`Credito`) y cada gasto (`Debito`), con su origen (`Acreditacion`, `Facturas` o `GasClub`), monto, estado (solo facturas), referencia al registro de origen y saldo resultante. |
| `CV_HISTORIAL_CUPO` | Cada cambio de cupo: valor anterior, valor nuevo, motivo y fecha. |
| `CV_SINCRONIZACIONES` | Cada ejecución de una sincronización: tipo, inicio, fin y registros leídos, insertados y actualizados. |

El saldo se guarda en `CV_COLABORADORES` para leerlo directamente, pero la fuente de verdad
son los movimientos: siempre se cumple `saldo = créditos − débitos`. Los dos se escriben en
la misma transacción, y `consultas/verificacion.sql` lo comprueba.

## Decisiones

1. **Sin restricciones en la base.** Los ID salen de secuencias, que no son restricciones.
   La unicidad se garantiza en el código: un candado (`pg_advisory_xact_lock`) evita que dos
   peticiones creen la misma cédula o registren la misma factura a la vez, y
   `SELECT ... FOR UPDATE` bloquea al colaborador mientras cambia su saldo. Los índices no
   son únicos.
2. **Dinero.** Columnas `DECIMAL(12,2)` y toda la aritmética en SQL, no en JavaScript.
3. **Registrar factura.** En una sola transacción se descuenta el saldo, se inserta la
   factura en `SGR_FACTURAS` y se inserta su movimiento en `CV_MOVIMIENTOS`, ambos con
   estado `Pendiente`. Si algo falla, no queda nada guardado. La factura pendiente
   descuenta desde ese momento porque no existen rechazos: toda pendiente terminará
   aprobada, y si no descontara se podrían registrar facturas por encima del saldo.
4. **Identidad de los gastos.** Una factura es su RUC más su número; un consumo de GasClub
   es su referencia. Con eso se rechazan duplicados y las sincronizaciones se pueden
   repetir sin efecto.
5. **Sincronizaciones.** Comparan cada fila del origen contra el libro, sin una marca de
   "último procesado": si un colaborador se registra después, sus gastos entran en la
   siguiente ejecución, incluidos los anteriores a su creación. Solo consideran
   colaboradores registrados. No validan saldo, que puede quedar negativo, porque el gasto
   ya ocurrió.
6. **Aprobación de facturas.** La sincronización solo cambia el estado y guarda cuándo
   detectó la aprobación; el monto no se descuenta otra vez. El estado leído se normaliza,
   porque la aprobación es manual y la tabla no tiene `CHECK`.
7. **ID en `SGR_FACTURAS`.** La tabla no tiene autoincremento: se usa `MAX(ID) + 1` bajo
   el candado de facturas.
8. **Cupo.** Acreditar funciona como una recarga y puede repetirse; se rechaza si el cupo
   es 0. Actualizar el cupo no toca el saldo y rechaza un valor igual al actual, para no
   llenar el historial de cambios vacíos.
9. **Validaciones.** Cédula de 10 dígitos, sin dígito verificador porque las cédulas de
   ejemplo no lo cumplen; RUC de 13 dígitos; número de factura con el formato del SRI;
   montos positivos con hasta 2 decimales.
10. **Trazabilidad.** Cada movimiento guarda su origen, el ID del registro de origen, el
    saldo resultante y la sincronización que lo importó.
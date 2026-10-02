-- tablas del esquema, aparecen las 4 cv_ y las 2 sgr_.

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;

-- restricciones, demuestra que devuelven 0 filas como fue indicado.

SELECT table_name, constraint_name, constraint_type
FROM information_schema.table_constraints
WHERE table_schema = 'public';

-- el saldo guardado debe ser igual al calculado desde los movimientos (diferencia = 0)

SELECT c.cedula,
       c.saldo,
       COALESCE(SUM(CASE WHEN m.tipo = 'Credito' THEN m.monto ELSE -m.monto END), 0) AS saldo_calculado,
       c.saldo - COALESCE(SUM(CASE WHEN m.tipo = 'Credito' THEN m.monto ELSE -m.monto END), 0) AS diferencia
FROM cv_colaboradores c
LEFT JOIN cv_movimientos m ON m.cedula = c.cedula
GROUP BY c.cedula, c.saldo
ORDER BY c.cedula;

-- estado de cuenta de un colaborador: cada movimiento con el saldo que dejó.

SELECT id, tipo, origen, referencia, monto, estado, fecha_movimiento, saldo_resultante
FROM cv_movimientos
WHERE cedula = '0912345678'
ORDER BY id;

-- consumos de GasClub de colaboradores registrados que faltan en el libro (0 filas después de sincronizar).

SELECT g.*
FROM sgr_gasclub_gastos g
JOIN cv_colaboradores c ON c.cedula = g.cedula
WHERE NOT EXISTS (
    SELECT 1
    FROM cv_movimientos m
    WHERE m.origen = 'GasClub'
      AND m.referencia = g.referencia
);

-- facturas de colaboradores registrados que no están alineadas con el libro (0 filas después de sincronizar).

SELECT f.id, f.cedula, f.numero_factura, f.estado AS estado_sgr, m.estado AS estado_libro
FROM sgr_facturas f
JOIN cv_colaboradores c ON c.cedula = f.cedula
LEFT JOIN cv_movimientos m
       ON m.origen = 'Facturas'
      AND m.referencia = f.numero_factura
      AND m.ruc_proveedor = f.ruc_proveedor
WHERE m.id IS NULL
   OR LOWER(m.estado) IS DISTINCT FROM LOWER(TRIM(f.estado));

-- historial de las sincronizaciones ejecutadas.

SELECT * FROM cv_sincronizaciones ORDER BY id;
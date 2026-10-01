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
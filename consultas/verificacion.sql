-- tablas del esquema, aparecen las 4 cv_ y las 2 sgr_.

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;

-- restricciones, demuestra que devuelven 0 filas como fue indicado.

SELECT table_name, constraint_name, constraint_type
FROM information_schema.table_constraints
WHERE table_schema = 'public';
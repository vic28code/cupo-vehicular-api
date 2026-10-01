-- tablas propias del servicio de cupo vehicular.
-- sin PK, UNIQUE, FK, CHECK ni NOT NULL.
-- las validaciones se hacen en la lambda.

CREATE SEQUENCE CV_COLABORADORES_SEQ;
CREATE SEQUENCE CV_HISTORIAL_CUPO_SEQ;
CREATE SEQUENCE CV_MOVIMIENTOS_SEQ;
CREATE SEQUENCE CV_SINCRONIZACIONES_SEQ;

CREATE TABLE CV_COLABORADORES (
    ID                   INT DEFAULT nextval('CV_COLABORADORES_SEQ'),
    CEDULA               VARCHAR(20),
    CUPO_MENSUAL         DECIMAL(12,2),
    SALDO                DECIMAL(12,2), -- tiene que cuadrar con cv_movimientos
    FECHA_CREACION       TIMESTAMPTZ,
    FECHA_ACTUALIZACION  TIMESTAMPTZ
);

CREATE TABLE CV_HISTORIAL_CUPO (
    ID             INT DEFAULT nextval('CV_HISTORIAL_CUPO_SEQ'),
    CEDULA         VARCHAR(20),
    CUPO_ANTERIOR  DECIMAL(12,2), -- cuando se cree el colaborador es null
    CUPO_NUEVO     DECIMAL(12,2),
    MOTIVO         VARCHAR(200),
    FECHA          TIMESTAMPTZ
);

CREATE TABLE CV_MOVIMIENTOS (
    ID                 INT DEFAULT nextval('CV_MOVIMIENTOS_SEQ'),
    CEDULA             VARCHAR(20),
    TIPO               VARCHAR(10),    -- crédito o débito
    ORIGEN             VARCHAR(15),    -- acreditación o facturas o gasclub
    MONTO              DECIMAL(12,2),  -- siempre es positivo, el TIPO le da el signo
    ESTADO             VARCHAR(15),    -- pendiente o aprobado (solo facturas)
    ID_ORIGEN          INT,
    REFERENCIA         VARCHAR(30),    -- nro. factura o referencia gasclub
    RUC_PROVEEDOR      VARCHAR(20),
    FECHA_MOVIMIENTO   DATE,
    SALDO_RESULTANTE   DECIMAL(12,2),
    SINCRONIZACION_ID  INT,            -- si vino de un endpoint será null
    FECHA_REGISTRO     TIMESTAMPTZ,
    FECHA_APROBACION   TIMESTAMPTZ
);

CREATE TABLE CV_SINCRONIZACIONES (
    ID                      INT DEFAULT nextval('CV_SINCRONIZACIONES_SEQ'),
    TIPO                    VARCHAR(15),  -- facturas o gasclub
    FECHA_INICIO            TIMESTAMPTZ,
    FECHA_FIN               TIMESTAMPTZ,
    REGISTROS_LEIDOS        INT,
    REGISTROS_INSERTADOS    INT,
    REGISTROS_ACTUALIZADOS  INT
);

-- índices normales (no únicos) para las búsquedas por cédula y referencia.

CREATE INDEX IX_CV_COLABORADORES_CEDULA   ON CV_COLABORADORES (CEDULA);
CREATE INDEX IX_CV_HISTORIAL_CUPO_CEDULA  ON CV_HISTORIAL_CUPO (CEDULA);
CREATE INDEX IX_CV_MOVIMIENTOS_CEDULA     ON CV_MOVIMIENTOS (CEDULA);
CREATE INDEX IX_CV_MOVIMIENTOS_ORIGEN_REF ON CV_MOVIMIENTOS (ORIGEN, REFERENCIA);
-- ======================================================
-- 1. TIPOS ENUM
-- ======================================================
CREATE TYPE rol_usuario_enum AS ENUM ('ARRENDADOR', 'INQUILINO');
CREATE TYPE tipo_propiedad_enum AS ENUM ('EDIFICIO', 'DEPARTAMENTO', 'CASA', 'LOCAL', 'TERRENO');
CREATE TYPE frecuencia_enum AS ENUM ('MENSUAL', 'QUINCENAL', 'SEMANAL');
CREATE TYPE estado_contrato_enum AS ENUM ('PENDIENTE', 'RECHAZADO', 'ACTIVO', 'FINALIZADO', 'TERMINADO');
CREATE TYPE estado_pago_enum AS ENUM ('PENDIENTE', 'PAGADO', 'VENCIDO');
CREATE TYPE categoria_incidencia_enum AS ENUM ('PLOMERIA', 'ELECTRICIDAD', 'ESTRUCTURA', 'LIMPIEZA', 'SEGURIDAD', 'OTRO');
CREATE TYPE estado_incidencia_enum AS ENUM ('ABIERTA', 'EN_PROCESO', 'RESUELTA');
CREATE TYPE tipo_notificacion_enum AS ENUM ('PAGO_PROXIMO', 'PAGO_VENCIDO', 'INCIDENCIA_ACTUALIZADA', 'CONTRATO_TERMINADO', 'RECORDATORIO');
CREATE TYPE metodo_pago_enum AS ENUM ('TRANSFERENCIA', 'EFECTIVO', 'CHEQUE', 'DEPOSITO', 'TARJETA', 'OTRO');

-- ======================================================
-- 2. TABLAS (con integración a auth.users)
-- ======================================================

-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

-- Tabla usuarios (vinculada a auth.users mediante auth_user_id)
CREATE TABLE public.usuarios (
  usuario_id bigint NOT NULL DEFAULT nextval('usuarios_usuario_id_seq'::regclass),
  auth_user_id uuid UNIQUE,
  correo character varying NOT NULL,
  rol USER-DEFINED NOT NULL DEFAULT 'INQUILINO'::rol_usuario_enum,
  nombre_completo character varying NOT NULL,
  telefono character varying,
  creado_en timestamp with time zone NOT NULL DEFAULT now(),
  actualizado_en timestamp with time zone NOT NULL DEFAULT now(),
  ultimo_acceso timestamp with time zone,
  activo boolean NOT NULL DEFAULT true,
  CONSTRAINT usuarios_pkey PRIMARY KEY (usuario_id),
  CONSTRAINT usuarios_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES auth.users(id)
);

-- Tabla propiedades
CREATE TABLE public.propiedades (
  propiedad_id bigint NOT NULL DEFAULT nextval('propiedades_propiedad_id_seq'::regclass),
  duenio_id bigint NOT NULL,
  nombre character varying NOT NULL,
  direccion text NOT NULL,
  tipo_propiedad USER-DEFINED NOT NULL,
  propiedad_padre_id bigint,
  creado_en timestamp with time zone NOT NULL DEFAULT now(),
  actualizado_en timestamp with time zone NOT NULL DEFAULT now(),
  activa boolean NOT NULL DEFAULT true,
  descripcion text,
  CONSTRAINT propiedades_pkey PRIMARY KEY (propiedad_id),
  CONSTRAINT propiedades_duenio_id_fkey FOREIGN KEY (duenio_id) REFERENCES public.usuarios(usuario_id),
  CONSTRAINT propiedades_propiedad_padre_id_fkey FOREIGN KEY (propiedad_padre_id) REFERENCES public.propiedades(propiedad_id)
);

-- Tabla inquilinos
CREATE TABLE public.inquilinos (
  inquilino_id bigint NOT NULL DEFAULT nextval('inquilinos_inquilino_id_seq'::regclass),
  usuario_id bigint NOT NULL UNIQUE,
  contacto_emergencia character varying,
  telefono_emergencia character varying,
  notas text,
  CONSTRAINT inquilinos_pkey PRIMARY KEY (inquilino_id),
  CONSTRAINT inquilinos_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(usuario_id)
);

-- Tabla contratos
CREATE TABLE public.contratos (
  contrato_id bigint NOT NULL DEFAULT nextval('contratos_contrato_id_seq'::regclass),
  propiedad_id bigint NOT NULL,
  inquilino_id bigint NOT NULL,
  fecha_inicio date NOT NULL,
  fecha_fin date NOT NULL,
  monto_renta numeric NOT NULL CHECK (monto_renta > 0::numeric),
  frecuencia_pago USER-DEFINED NOT NULL DEFAULT 'MENSUAL'::frecuencia_enum,
  estado USER-DEFINED NOT NULL DEFAULT 'PENDIENTE'::estado_contrato_enum,
  creado_en timestamp with time zone NOT NULL DEFAULT now(),
  actualizado_en timestamp with time zone NOT NULL DEFAULT now(),
  fecha_terminacion date,
  observaciones text,
  motivo_terminacion text,
  beneficios text,
  aceptado_en timestamp with time zone,
  rechazado_en timestamp with time zone,
  CONSTRAINT contratos_pkey PRIMARY KEY (contrato_id),
  CONSTRAINT contratos_propiedad_id_fkey FOREIGN KEY (propiedad_id) REFERENCES public.propiedades(propiedad_id),
  CONSTRAINT contratos_inquilino_id_fkey FOREIGN KEY (inquilino_id) REFERENCES public.inquilinos(inquilino_id)
);
CREATE UNIQUE INDEX idx_unico_activo_por_propiedad ON contratos (propiedad_id) WHERE estado = 'ACTIVO';

-- Tabla calendario_pagos
CREATE TABLE public.calendario_pagos (
  calendario_id bigint NOT NULL DEFAULT nextval('calendario_pagos_calendario_id_seq'::regclass),
  contrato_id bigint NOT NULL,
  fecha_limite date NOT NULL,
  monto_esperado numeric NOT NULL CHECK (monto_esperado > 0::numeric),
  anio smallint NOT NULL,
  mes smallint NOT NULL CHECK (mes >= 1 AND mes <= 12),
  estado USER-DEFINED NOT NULL DEFAULT 'PENDIENTE'::estado_pago_enum,
  fecha_pagado date,
  actualizado_en timestamp with time zone NOT NULL DEFAULT now(),
  periodo_inicio date,
  periodo_fin date,
  reportado_en timestamp with time zone,
  validado_en timestamp with time zone,
  CONSTRAINT calendario_pagos_pkey PRIMARY KEY (calendario_id),
  CONSTRAINT calendario_pagos_contrato_id_fkey FOREIGN KEY (contrato_id) REFERENCES public.contratos(contrato_id)
);
CREATE UNIQUE INDEX idx_unico_periodo_por_contrato ON calendario_pagos (contrato_id, anio, mes);

-- Tabla registros_pago
CREATE TABLE public.registros_pago (
  pago_id bigint NOT NULL DEFAULT nextval('registros_pago_pago_id_seq'::regclass),
  calendario_id bigint NOT NULL UNIQUE,
  registrado_por_id bigint NOT NULL,
  fecha_recibido date NOT NULL,
  monto_recibido numeric NOT NULL,
  notas text,
  creado_en timestamp with time zone NOT NULL DEFAULT now(),
  metodo_pago USER-DEFINED NOT NULL DEFAULT 'TRANSFERENCIA'::metodo_pago_enum,
  referencia character varying,
  comprobante_url text,
  validado boolean NOT NULL DEFAULT false,
  validado_por_id bigint,
  CONSTRAINT registros_pago_pkey PRIMARY KEY (pago_id),
  CONSTRAINT registros_pago_calendario_id_fkey FOREIGN KEY (calendario_id) REFERENCES public.calendario_pagos(calendario_id),
  CONSTRAINT registros_pago_registrado_por_id_fkey FOREIGN KEY (registrado_por_id) REFERENCES public.usuarios(usuario_id),
  CONSTRAINT registros_pago_validado_por_id_fkey FOREIGN KEY (validado_por_id) REFERENCES public.usuarios(usuario_id)
);

-- Tabla incidencias
CREATE TABLE public.incidencias (
  incidencia_id bigint NOT NULL DEFAULT nextval('incidencias_incidencia_id_seq'::regclass),
  propiedad_id bigint NOT NULL,
  reportado_por_id bigint NOT NULL,
  titulo character varying NOT NULL,
  descripcion text NOT NULL,
  categoria USER-DEFINED NOT NULL,
  estado USER-DEFINED NOT NULL DEFAULT 'ABIERTA'::estado_incidencia_enum,
  creado_en timestamp with time zone NOT NULL DEFAULT now(),
  actualizado_en timestamp with time zone NOT NULL DEFAULT now(),
  resuelto_en timestamp with time zone,
  resolucion_notas text,
  CONSTRAINT incidencias_pkey PRIMARY KEY (incidencia_id),
  CONSTRAINT incidencias_propiedad_id_fkey FOREIGN KEY (propiedad_id) REFERENCES public.propiedades(propiedad_id),
  CONSTRAINT incidencias_reportado_por_id_fkey FOREIGN KEY (reportado_por_id) REFERENCES public.inquilinos(inquilino_id)
);

-- Tabla notificaciones
CREATE TABLE public.notificaciones (
  notificacion_id bigint NOT NULL DEFAULT nextval('notificaciones_notificacion_id_seq'::regclass),
  usuario_id bigint NOT NULL,
  titulo character varying NOT NULL,
  mensaje text NOT NULL,
  tipo USER-DEFINED NOT NULL,
  leida boolean NOT NULL DEFAULT false,
  creado_en timestamp with time zone NOT NULL DEFAULT now(),
  leida_en timestamp with time zone,
  metadatos jsonb,
  CONSTRAINT notificaciones_pkey PRIMARY KEY (notificacion_id),
  CONSTRAINT notificaciones_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(usuario_id)
);

-- ======================================================
-- 3. FUNCIONES Y TRIGGERS
-- ======================================================

-- Actualizar timestamp automáticamente
CREATE OR REPLACE FUNCTION actualizar_timestamp_columna()
RETURNS TRIGGER AS $$
BEGIN
    NEW.actualizado_en = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_usuarios_actualizado BEFORE UPDATE ON usuarios FOR EACH ROW EXECUTE FUNCTION actualizar_timestamp_columna();
CREATE TRIGGER trigger_propiedades_actualizado BEFORE UPDATE ON propiedades FOR EACH ROW EXECUTE FUNCTION actualizar_timestamp_columna();
CREATE TRIGGER trigger_contratos_actualizado BEFORE UPDATE ON contratos FOR EACH ROW EXECUTE FUNCTION actualizar_timestamp_columna();
CREATE TRIGGER trigger_calendario_actualizado BEFORE UPDATE ON calendario_pagos FOR EACH ROW EXECUTE FUNCTION actualizar_timestamp_columna();
CREATE TRIGGER trigger_incidencias_actualizado BEFORE UPDATE ON incidencias FOR EACH ROW EXECUTE FUNCTION actualizar_timestamp_columna();

-- Función para marcar pagos vencidos (ejecutar manual o con cron)
CREATE OR REPLACE FUNCTION actualizar_pagos_vencidos()
RETURNS void AS $$
BEGIN
    UPDATE calendario_pagos
    SET estado = 'VENCIDO',
        actualizado_en = NOW()
    WHERE estado = 'PENDIENTE'
      AND fecha_limite < CURRENT_DATE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ======================================================
-- 4. TRIGGER PARA SINCRONIZAR auth.users CON TABLA usuarios
-- ======================================================

-- Función que se ejecuta cuando se crea un nuevo usuario en auth.users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    INSERT INTO public.usuarios (auth_user_id, correo, rol, nombre_completo, activo)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE((NEW.raw_user_meta_data->>'rol')::rol_usuario_enum, 'INQUILINO'),
        COALESCE(NEW.raw_user_meta_data->>'nombre_completo', split_part(NEW.email, '@', 1)),
        true
    );
    RETURN NEW;
END;
$$;

-- Trigger que se activa después de cada inserción en auth.users
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

-- Dar permisos de uso del esquema public al rol anon
GRANT USAGE ON SCHEMA public TO anon;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon;

-- Dar permisos para tablas futuras
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;


-- Desactivar RLS en todas las tablas (ya lo hicimos, pero por si acaso)
ALTER TABLE usuarios DISABLE ROW LEVEL SECURITY;
ALTER TABLE propiedades DISABLE ROW LEVEL SECURITY;
ALTER TABLE inquilinos DISABLE ROW LEVEL SECURITY;
ALTER TABLE contratos DISABLE ROW LEVEL SECURITY;
ALTER TABLE calendario_pagos DISABLE ROW LEVEL SECURITY;
ALTER TABLE registros_pago DISABLE ROW LEVEL SECURITY;
ALTER TABLE incidencias DISABLE ROW LEVEL SECURITY;
ALTER TABLE notificaciones DISABLE ROW LEVEL SECURITY;

-- Conceder todos los privilegios al rol anon (como en la solución 1)
GRANT USAGE ON SCHEMA public TO anon;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon;

CREATE POLICY "anon puede todo" ON usuarios FOR ALL USING (true) WITH CHECK (true);
-- repite para cada tabla, o simplemente asegúrate de que RLS esté desactivado.
-- ============================================================================
-- MIGRACIÓN: Tablas estructuradas para datos PJUD
-- ============================================================================
-- Refactorización completa del modelo de datos. Cada tabla del DOM de PJUD
-- se mapea a una tabla relacional con todas sus columnas y filas exactas.
--
-- Estructura jerárquica:
--   cases (global)
--     ├── case_cuadernos (T10a) — 1 por cuaderno
--     │   ├── case_folios (T10b) — 1 por fila de Historia
--     │   │   └── case_folio_anexos (T11) — anexos de solicitud por folio
--     │   ├── case_litigantes (T10c)
--     │   ├── case_notificaciones (T10d)
--     │   ├── case_escritos (T10e)
--     │   └── case_piezas_exhorto (T12, solo tipo E)
--     ├── case_anexos_causa (T3)
--     ├── case_receptor_retiros (T4)
--     ├── case_exhortos (T6, deduplicados)
--     │   └── case_exhorto_docs (T7)
--     └── case_remisiones (T5+T8a+T8b+T8g)
--         ├── case_remision_movimientos (T8c)
--         │   └── case_remision_mov_anexos (T9)
--         ├── case_remision_litigantes (T8d)
--         ├── case_remision_exhortos (T8e)
--         └── case_remision_incompetencias (T8f)
--
-- Dependencias: 20260209120000_create_legal_tables.sql
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- 1. MODIFICAR CASES — agregar campos globales para causa tipo E y metadata
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS causa_origen text,
  ADD COLUMN IF NOT EXISTS tribunal_origen text;

COMMENT ON COLUMN public.cases.causa_origen IS
  'Causa origen para causas tipo E (exhorto). Ej: C-21162-2023. Extraído del bloque Piezas Exhorto.';
COMMENT ON COLUMN public.cases.tribunal_origen IS
  'Tribunal origen para causas tipo E. Ej: 7º Juzgado Civil de Santiago.';


-- ════════════════════════════════════════════════════════════════════════════
-- 2. CASE_CUADERNOS — T10a: un cuaderno por cada opción del select
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.case_cuadernos (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id uuid REFERENCES public.cases(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  nombre text NOT NULL,
  procedimiento text,
  etapa text,
  posicion int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT timezone('utc', now()) NOT NULL,
  updated_at timestamptz DEFAULT timezone('utc', now()) NOT NULL
);

COMMENT ON TABLE public.case_cuadernos IS
  'Cuadernos de una causa. Cada cuaderno tiene su propio procedimiento, etapa, folios, litigantes, notificaciones y escritos.';

CREATE INDEX IF NOT EXISTS case_cuadernos_case_id_idx ON public.case_cuadernos(case_id);
CREATE UNIQUE INDEX IF NOT EXISTS case_cuadernos_unique_idx ON public.case_cuadernos(case_id, nombre);

ALTER TABLE public.case_cuadernos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "case_cuadernos_select_own" ON public.case_cuadernos FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "case_cuadernos_insert_own" ON public.case_cuadernos FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "case_cuadernos_update_own" ON public.case_cuadernos FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "case_cuadernos_delete_own" ON public.case_cuadernos FOR DELETE USING (auth.uid() = user_id);


-- ════════════════════════════════════════════════════════════════════════════
-- 3. CASE_FOLIOS — T10b: cada fila de la tabla Historia del cuaderno
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.case_folios (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id uuid REFERENCES public.cases(id) ON DELETE CASCADE NOT NULL,
  cuaderno_id uuid REFERENCES public.case_cuadernos(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  numero_folio int NOT NULL,
  etapa text,
  tramite text,
  desc_tramite text,
  fecha_tramite text,
  foja int DEFAULT 0,
  tiene_doc_principal boolean DEFAULT false,
  tiene_certificado_escrito boolean DEFAULT false,
  tiene_anexo_solicitud boolean DEFAULT false,
  created_at timestamptz DEFAULT timezone('utc', now()) NOT NULL
);

COMMENT ON TABLE public.case_folios IS
  'Folios de la tabla Historia de un cuaderno. Cada fila se registra aunque no tenga PDF.';

CREATE INDEX IF NOT EXISTS case_folios_case_id_idx ON public.case_folios(case_id);
CREATE INDEX IF NOT EXISTS case_folios_cuaderno_id_idx ON public.case_folios(cuaderno_id);
CREATE UNIQUE INDEX IF NOT EXISTS case_folios_unique_idx ON public.case_folios(cuaderno_id, numero_folio);

ALTER TABLE public.case_folios ENABLE ROW LEVEL SECURITY;
CREATE POLICY "case_folios_select_own" ON public.case_folios FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "case_folios_insert_own" ON public.case_folios FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "case_folios_update_own" ON public.case_folios FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "case_folios_delete_own" ON public.case_folios FOR DELETE USING (auth.uid() = user_id);


-- ════════════════════════════════════════════════════════════════════════════
-- 4. CASE_FOLIO_ANEXOS — T11: anexos de solicitud por folio
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.case_folio_anexos (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id uuid REFERENCES public.cases(id) ON DELETE CASCADE NOT NULL,
  folio_id uuid REFERENCES public.case_folios(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  fecha text,
  referencia text,
  created_at timestamptz DEFAULT timezone('utc', now()) NOT NULL
);

COMMENT ON TABLE public.case_folio_anexos IS
  'Anexos de solicitud asociados a un folio específico (#modalAnexoSolicitudCivil). Columnas: Doc, Fecha, Referencia.';

CREATE INDEX IF NOT EXISTS case_folio_anexos_folio_id_idx ON public.case_folio_anexos(folio_id);
CREATE INDEX IF NOT EXISTS case_folio_anexos_case_id_idx ON public.case_folio_anexos(case_id);

ALTER TABLE public.case_folio_anexos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "case_folio_anexos_select_own" ON public.case_folio_anexos FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "case_folio_anexos_insert_own" ON public.case_folio_anexos FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "case_folio_anexos_update_own" ON public.case_folio_anexos FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "case_folio_anexos_delete_own" ON public.case_folio_anexos FOR DELETE USING (auth.uid() = user_id);


-- ════════════════════════════════════════════════════════════════════════════
-- 5. CASE_LITIGANTES — T10c: litigantes por cuaderno
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.case_litigantes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id uuid REFERENCES public.cases(id) ON DELETE CASCADE NOT NULL,
  cuaderno_id uuid REFERENCES public.case_cuadernos(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  participante text,
  rut text,
  persona text,
  nombre_razon_social text,
  created_at timestamptz DEFAULT timezone('utc', now()) NOT NULL
);

COMMENT ON TABLE public.case_litigantes IS
  'Litigantes por cuaderno. Columnas PJUD: Participante, Rut, Persona, Nombre o Razón Social.';

CREATE INDEX IF NOT EXISTS case_litigantes_case_id_idx ON public.case_litigantes(case_id);
CREATE INDEX IF NOT EXISTS case_litigantes_cuaderno_id_idx ON public.case_litigantes(cuaderno_id);
CREATE INDEX IF NOT EXISTS case_litigantes_rut_idx ON public.case_litigantes(rut) WHERE rut IS NOT NULL;

ALTER TABLE public.case_litigantes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "case_litigantes_select_own" ON public.case_litigantes FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "case_litigantes_insert_own" ON public.case_litigantes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "case_litigantes_update_own" ON public.case_litigantes FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "case_litigantes_delete_own" ON public.case_litigantes FOR DELETE USING (auth.uid() = user_id);


-- ════════════════════════════════════════════════════════════════════════════
-- 6. CASE_NOTIFICACIONES — T10d: notificaciones por cuaderno
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.case_notificaciones (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id uuid REFERENCES public.cases(id) ON DELETE CASCADE NOT NULL,
  cuaderno_id uuid REFERENCES public.case_cuadernos(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  rol text,
  estado_notif text,
  tipo_notif text,
  fecha_tramite text,
  tipo_participante text,
  nombre text,
  tramite text,
  obs_fallida text,
  created_at timestamptz DEFAULT timezone('utc', now()) NOT NULL
);

COMMENT ON TABLE public.case_notificaciones IS
  'Notificaciones por cuaderno. Columnas PJUD: ROL, Est.Notif, Tipo Notif, Fecha Trámite, Tipo Part, Nombre, Trámite, Obs.Fallida.';

CREATE INDEX IF NOT EXISTS case_notificaciones_case_id_idx ON public.case_notificaciones(case_id);
CREATE INDEX IF NOT EXISTS case_notificaciones_cuaderno_id_idx ON public.case_notificaciones(cuaderno_id);

ALTER TABLE public.case_notificaciones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "case_notificaciones_select_own" ON public.case_notificaciones FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "case_notificaciones_insert_own" ON public.case_notificaciones FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "case_notificaciones_update_own" ON public.case_notificaciones FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "case_notificaciones_delete_own" ON public.case_notificaciones FOR DELETE USING (auth.uid() = user_id);


-- ════════════════════════════════════════════════════════════════════════════
-- 7. CASE_ESCRITOS — T10e: escritos por resolver por cuaderno
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.case_escritos (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id uuid REFERENCES public.cases(id) ON DELETE CASCADE NOT NULL,
  cuaderno_id uuid REFERENCES public.case_cuadernos(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  fecha_ingreso text,
  tipo_escrito text,
  solicitante text,
  tiene_doc boolean DEFAULT false,
  tiene_anexo boolean DEFAULT false,
  created_at timestamptz DEFAULT timezone('utc', now()) NOT NULL
);

COMMENT ON TABLE public.case_escritos IS
  'Escritos por resolver por cuaderno. Columnas PJUD: Doc, Anexo, Fecha de Ingreso, Tipo Escrito, Solicitante.';

CREATE INDEX IF NOT EXISTS case_escritos_case_id_idx ON public.case_escritos(case_id);
CREATE INDEX IF NOT EXISTS case_escritos_cuaderno_id_idx ON public.case_escritos(cuaderno_id);

ALTER TABLE public.case_escritos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "case_escritos_select_own" ON public.case_escritos FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "case_escritos_insert_own" ON public.case_escritos FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "case_escritos_update_own" ON public.case_escritos FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "case_escritos_delete_own" ON public.case_escritos FOR DELETE USING (auth.uid() = user_id);


-- ════════════════════════════════════════════════════════════════════════════
-- 8. CASE_ANEXOS_CAUSA — T3: anexos de la causa (global)
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.case_anexos_causa (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id uuid REFERENCES public.cases(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  fecha text,
  referencia text,
  created_at timestamptz DEFAULT timezone('utc', now()) NOT NULL
);

COMMENT ON TABLE public.case_anexos_causa IS
  'Anexos de la causa (#modalAnexoCausaCivil). Global, no depende del cuaderno. Columnas PJUD: Doc, Fecha, Referencia.';

CREATE INDEX IF NOT EXISTS case_anexos_causa_case_id_idx ON public.case_anexos_causa(case_id);

ALTER TABLE public.case_anexos_causa ENABLE ROW LEVEL SECURITY;
CREATE POLICY "case_anexos_causa_select_own" ON public.case_anexos_causa FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "case_anexos_causa_insert_own" ON public.case_anexos_causa FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "case_anexos_causa_update_own" ON public.case_anexos_causa FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "case_anexos_causa_delete_own" ON public.case_anexos_causa FOR DELETE USING (auth.uid() = user_id);


-- ════════════════════════════════════════════════════════════════════════════
-- 9. CASE_RECEPTOR_RETIROS — T4: retiros del receptor (global)
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.case_receptor_retiros (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id uuid REFERENCES public.cases(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  cuaderno text,
  datos_retiro text,
  fecha_retiro text,
  estado text,
  created_at timestamptz DEFAULT timezone('utc', now()) NOT NULL
);

COMMENT ON TABLE public.case_receptor_retiros IS
  'Retiros del receptor (#modalReceptorCivil). Columnas PJUD: Cuaderno, Datos del Retiro, Fecha Retiro, Estado. datos_retiro contiene el nombre del receptor.';

CREATE INDEX IF NOT EXISTS case_receptor_retiros_case_id_idx ON public.case_receptor_retiros(case_id);

ALTER TABLE public.case_receptor_retiros ENABLE ROW LEVEL SECURITY;
CREATE POLICY "case_receptor_retiros_select_own" ON public.case_receptor_retiros FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "case_receptor_retiros_insert_own" ON public.case_receptor_retiros FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "case_receptor_retiros_update_own" ON public.case_receptor_retiros FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "case_receptor_retiros_delete_own" ON public.case_receptor_retiros FOR DELETE USING (auth.uid() = user_id);


-- ════════════════════════════════════════════════════════════════════════════
-- 10. CASE_EXHORTOS — T6: exhortos de la causa (global, deduplicados)
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.case_exhortos (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id uuid REFERENCES public.cases(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  rol_origen text,
  tipo_exhorto text,
  rol_destino text,
  fecha_ordena text,
  fecha_ingreso text,
  tribunal_destino text,
  estado_exhorto text,
  created_at timestamptz DEFAULT timezone('utc', now()) NOT NULL
);

COMMENT ON TABLE public.case_exhortos IS
  'Exhortos de la causa (tab Exhortos, deduplicados). Columnas PJUD: Rol Origen, Tipo Exhorto, Rol Destino, Fecha Ordena Exhorto, Fecha Ingreso Exhorto, Tribunal Destino, Estado Exhorto.';

CREATE INDEX IF NOT EXISTS case_exhortos_case_id_idx ON public.case_exhortos(case_id);
CREATE UNIQUE INDEX IF NOT EXISTS case_exhortos_unique_idx ON public.case_exhortos(case_id, rol_destino);

ALTER TABLE public.case_exhortos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "case_exhortos_select_own" ON public.case_exhortos FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "case_exhortos_insert_own" ON public.case_exhortos FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "case_exhortos_update_own" ON public.case_exhortos FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "case_exhortos_delete_own" ON public.case_exhortos FOR DELETE USING (auth.uid() = user_id);


-- ════════════════════════════════════════════════════════════════════════════
-- 11. CASE_EXHORTO_DOCS — T7: documentos del detalle de un exhorto
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.case_exhorto_docs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id uuid REFERENCES public.cases(id) ON DELETE CASCADE NOT NULL,
  exhorto_id uuid REFERENCES public.case_exhortos(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  fecha text,
  referencia text,
  tramite text,
  created_at timestamptz DEFAULT timezone('utc', now()) NOT NULL
);

COMMENT ON TABLE public.case_exhorto_docs IS
  'Documentos del detalle de un exhorto (#modalExhortoCivil). Columnas PJUD: Doc, Fecha, Referencia, Trámite.';

CREATE INDEX IF NOT EXISTS case_exhorto_docs_exhorto_id_idx ON public.case_exhorto_docs(exhorto_id);
CREATE INDEX IF NOT EXISTS case_exhorto_docs_case_id_idx ON public.case_exhorto_docs(case_id);

ALTER TABLE public.case_exhorto_docs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "case_exhorto_docs_select_own" ON public.case_exhorto_docs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "case_exhorto_docs_insert_own" ON public.case_exhorto_docs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "case_exhorto_docs_update_own" ON public.case_exhorto_docs FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "case_exhorto_docs_delete_own" ON public.case_exhorto_docs FOR DELETE USING (auth.uid() = user_id);


-- ════════════════════════════════════════════════════════════════════════════
-- 12. CASE_REMISIONES — T5+T8a+T8b+T8g: remisiones en la Corte
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.case_remisiones (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id uuid REFERENCES public.cases(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  -- T5: tabla de remisiones del DOM principal
  descripcion_tramite text,
  fecha_tramite text,
  -- T8a: metadata de la apelación
  libro text,
  fecha text,
  estado_recurso text,
  estado_procesal text,
  ubicacion text,
  recurso text,
  corte text,
  -- T8b: docs directos (flags de disponibilidad)
  tiene_certificado boolean DEFAULT false,
  tiene_ebook boolean DEFAULT false,
  tiene_texto boolean DEFAULT false,
  tiene_anexo boolean DEFAULT false,
  -- T8g: expediente primera instancia
  exp_causa_origen text,
  exp_tribunal text,
  exp_caratulado text,
  exp_materia text,
  exp_ruc text,
  exp_fecha_ingreso text,
  created_at timestamptz DEFAULT timezone('utc', now()) NOT NULL
);

COMMENT ON TABLE public.case_remisiones IS
  'Remisiones en la Corte. Combina T5 (panel remisiones), T8a (metadata apelación), T8b (docs directos), T8g (expediente 1ª instancia).';

CREATE INDEX IF NOT EXISTS case_remisiones_case_id_idx ON public.case_remisiones(case_id);

ALTER TABLE public.case_remisiones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "case_remisiones_select_own" ON public.case_remisiones FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "case_remisiones_insert_own" ON public.case_remisiones FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "case_remisiones_update_own" ON public.case_remisiones FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "case_remisiones_delete_own" ON public.case_remisiones FOR DELETE USING (auth.uid() = user_id);


-- ════════════════════════════════════════════════════════════════════════════
-- 13. CASE_REMISION_MOVIMIENTOS — T8c: movimientos (folios) de una remisión
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.case_remision_movimientos (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id uuid REFERENCES public.cases(id) ON DELETE CASCADE NOT NULL,
  remision_id uuid REFERENCES public.case_remisiones(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  numero_folio int NOT NULL,
  tramite text,
  descripcion text,
  nomenclaturas text,
  fecha text,
  sala text,
  estado text,
  tiene_doc boolean DEFAULT false,
  tiene_certificado_escrito boolean DEFAULT false,
  tiene_anexo_escrito boolean DEFAULT false,
  created_at timestamptz DEFAULT timezone('utc', now()) NOT NULL
);

COMMENT ON TABLE public.case_remision_movimientos IS
  'Movimientos (folios) de una remisión/apelación. Columnas PJUD: Folio, Doc, Anexo, Trámite, Descripción, Fecha, Sala, Estado. nomenclaturas se extrae del title del span.topToolNom.';

CREATE INDEX IF NOT EXISTS case_remision_mov_remision_id_idx ON public.case_remision_movimientos(remision_id);
CREATE INDEX IF NOT EXISTS case_remision_mov_case_id_idx ON public.case_remision_movimientos(case_id);

ALTER TABLE public.case_remision_movimientos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "case_remision_mov_select_own" ON public.case_remision_movimientos FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "case_remision_mov_insert_own" ON public.case_remision_movimientos FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "case_remision_mov_update_own" ON public.case_remision_movimientos FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "case_remision_mov_delete_own" ON public.case_remision_movimientos FOR DELETE USING (auth.uid() = user_id);


-- ════════════════════════════════════════════════════════════════════════════
-- 14. CASE_REMISION_MOV_ANEXOS — T9: anexos de escrito de apelación
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.case_remision_mov_anexos (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id uuid REFERENCES public.cases(id) ON DELETE CASCADE NOT NULL,
  movimiento_id uuid REFERENCES public.case_remision_movimientos(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  codigo text,
  tipo_documento text,
  cantidad text,
  observacion text,
  created_at timestamptz DEFAULT timezone('utc', now()) NOT NULL
);

COMMENT ON TABLE public.case_remision_mov_anexos IS
  'Anexos de escritos de apelación (#modalAnexoEscritoApelaciones). Columnas PJUD: Doc, Código, Tipo Documento, Cantidad, Observación del Documento.';

CREATE INDEX IF NOT EXISTS case_remision_mov_anexos_mov_id_idx ON public.case_remision_mov_anexos(movimiento_id);
CREATE INDEX IF NOT EXISTS case_remision_mov_anexos_case_id_idx ON public.case_remision_mov_anexos(case_id);

ALTER TABLE public.case_remision_mov_anexos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "case_remision_mov_anexos_select_own" ON public.case_remision_mov_anexos FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "case_remision_mov_anexos_insert_own" ON public.case_remision_mov_anexos FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "case_remision_mov_anexos_update_own" ON public.case_remision_mov_anexos FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "case_remision_mov_anexos_delete_own" ON public.case_remision_mov_anexos FOR DELETE USING (auth.uid() = user_id);


-- ════════════════════════════════════════════════════════════════════════════
-- 15. CASE_REMISION_LITIGANTES — T8d: litigantes de una remisión
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.case_remision_litigantes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id uuid REFERENCES public.cases(id) ON DELETE CASCADE NOT NULL,
  remision_id uuid REFERENCES public.case_remisiones(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  sujeto text,
  rut text,
  persona text,
  nombre_razon_social text,
  created_at timestamptz DEFAULT timezone('utc', now()) NOT NULL
);

COMMENT ON TABLE public.case_remision_litigantes IS
  'Litigantes de una remisión/apelación. Columnas PJUD: Sujeto, Rut, Persona, Nombre o Razón Social.';

CREATE INDEX IF NOT EXISTS case_remision_lit_remision_id_idx ON public.case_remision_litigantes(remision_id);
CREATE INDEX IF NOT EXISTS case_remision_lit_case_id_idx ON public.case_remision_litigantes(case_id);

ALTER TABLE public.case_remision_litigantes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "case_remision_lit_select_own" ON public.case_remision_litigantes FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "case_remision_lit_insert_own" ON public.case_remision_litigantes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "case_remision_lit_update_own" ON public.case_remision_litigantes FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "case_remision_lit_delete_own" ON public.case_remision_litigantes FOR DELETE USING (auth.uid() = user_id);


-- ════════════════════════════════════════════════════════════════════════════
-- 16. CASE_REMISION_EXHORTOS — T8e: exhortos de una remisión
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.case_remision_exhortos (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id uuid REFERENCES public.cases(id) ON DELETE CASCADE NOT NULL,
  remision_id uuid REFERENCES public.case_remisiones(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  exhorto text,
  created_at timestamptz DEFAULT timezone('utc', now()) NOT NULL
);

COMMENT ON TABLE public.case_remision_exhortos IS
  'Exhortos de una remisión/apelación (tab Exhortos dentro del detalle). Columna PJUD: Exhorto.';

CREATE INDEX IF NOT EXISTS case_remision_exh_remision_id_idx ON public.case_remision_exhortos(remision_id);

ALTER TABLE public.case_remision_exhortos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "case_remision_exh_select_own" ON public.case_remision_exhortos FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "case_remision_exh_insert_own" ON public.case_remision_exhortos FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "case_remision_exh_update_own" ON public.case_remision_exhortos FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "case_remision_exh_delete_own" ON public.case_remision_exhortos FOR DELETE USING (auth.uid() = user_id);


-- ════════════════════════════════════════════════════════════════════════════
-- 17. CASE_REMISION_INCOMPETENCIAS — T8f: incompetencias de una remisión
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.case_remision_incompetencias (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id uuid REFERENCES public.cases(id) ON DELETE CASCADE NOT NULL,
  remision_id uuid REFERENCES public.case_remisiones(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  incompetencia text,
  created_at timestamptz DEFAULT timezone('utc', now()) NOT NULL
);

COMMENT ON TABLE public.case_remision_incompetencias IS
  'Incompetencias de una remisión/apelación (tab Incompetencia dentro del detalle). Columna PJUD: Incompetencia.';

CREATE INDEX IF NOT EXISTS case_remision_inc_remision_id_idx ON public.case_remision_incompetencias(remision_id);

ALTER TABLE public.case_remision_incompetencias ENABLE ROW LEVEL SECURITY;
CREATE POLICY "case_remision_inc_select_own" ON public.case_remision_incompetencias FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "case_remision_inc_insert_own" ON public.case_remision_incompetencias FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "case_remision_inc_update_own" ON public.case_remision_incompetencias FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "case_remision_inc_delete_own" ON public.case_remision_incompetencias FOR DELETE USING (auth.uid() = user_id);


-- ════════════════════════════════════════════════════════════════════════════
-- 18. CASE_PIEZAS_EXHORTO — T12: piezas de exhorto (solo causas tipo E)
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.case_piezas_exhorto (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id uuid REFERENCES public.cases(id) ON DELETE CASCADE NOT NULL,
  cuaderno_id uuid REFERENCES public.case_cuadernos(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  numero_folio int NOT NULL,
  cuaderno_pieza text,
  etapa text,
  tramite text,
  desc_tramite text,
  fecha_tramite text,
  foja int DEFAULT 0,
  tiene_doc boolean DEFAULT false,
  tiene_anexo boolean DEFAULT false,
  created_at timestamptz DEFAULT timezone('utc', now()) NOT NULL
);

COMMENT ON TABLE public.case_piezas_exhorto IS
  'Piezas de exhorto (tab Piezas Exhorto, solo causas tipo E). Columnas PJUD: Folio, Doc, Cuaderno, Anexo, Etapa, Trámite, Desc.Trámite, Fec.Trámite, Foja.';

CREATE INDEX IF NOT EXISTS case_piezas_exhorto_case_id_idx ON public.case_piezas_exhorto(case_id);
CREATE INDEX IF NOT EXISTS case_piezas_exhorto_cuaderno_id_idx ON public.case_piezas_exhorto(cuaderno_id);

ALTER TABLE public.case_piezas_exhorto ENABLE ROW LEVEL SECURITY;
CREATE POLICY "case_piezas_exhorto_select_own" ON public.case_piezas_exhorto FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "case_piezas_exhorto_insert_own" ON public.case_piezas_exhorto FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "case_piezas_exhorto_update_own" ON public.case_piezas_exhorto FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "case_piezas_exhorto_delete_own" ON public.case_piezas_exhorto FOR DELETE USING (auth.uid() = user_id);


-- ════════════════════════════════════════════════════════════════════════════
-- 19. ENRIQUECER DOCUMENTS — asociar cada PDF a su contexto exacto
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS cuaderno_id uuid REFERENCES public.case_cuadernos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS folio_id uuid REFERENCES public.case_folios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS folio_anexo_id uuid REFERENCES public.case_folio_anexos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS anexo_causa_id uuid REFERENCES public.case_anexos_causa(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS exhorto_doc_id uuid REFERENCES public.case_exhorto_docs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS remision_id uuid REFERENCES public.case_remisiones(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS remision_mov_id uuid REFERENCES public.case_remision_movimientos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS remision_mov_anexo_id uuid REFERENCES public.case_remision_mov_anexos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pieza_exhorto_id uuid REFERENCES public.case_piezas_exhorto(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS escrito_id uuid REFERENCES public.case_escritos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS origen text,
  ADD COLUMN IF NOT EXISTS tramite_pjud text;

COMMENT ON COLUMN public.documents.origen IS
  'Origen del documento: directo, folio, folio_certificado, anexo_causa, anexo_solicitud, exhorto, remision_directo, remision_movimiento, remision_mov_anexo, escrito, pieza_exhorto.';
COMMENT ON COLUMN public.documents.tramite_pjud IS
  'Trámite original tal cual viene de PJUD (Resolución, Escrito, Actuación Receptor, etc.). No se transforma.';

CREATE INDEX IF NOT EXISTS documents_cuaderno_id_idx ON public.documents(cuaderno_id) WHERE cuaderno_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS documents_folio_id_idx ON public.documents(folio_id) WHERE folio_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS documents_remision_id_idx ON public.documents(remision_id) WHERE remision_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS documents_origen_idx ON public.documents(origen) WHERE origen IS NOT NULL;
CREATE INDEX IF NOT EXISTS documents_tramite_pjud_idx ON public.documents(tramite_pjud) WHERE tramite_pjud IS NOT NULL;

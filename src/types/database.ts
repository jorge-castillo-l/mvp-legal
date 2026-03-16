/**
 * Tipos de inserción para las tablas de la base de datos.
 * Corresponden 1:1 con las tablas SQL.
 * Generados manualmente a partir de la migración 20260315120000.
 */

// ════════════════════════════════════════════════════════
// Tablas existentes (aliases para el sync pipeline)
// ════════════════════════════════════════════════════════

export interface CaseInsert {
  user_id: string
  rol: string
  tribunal?: string | null
  caratula?: string | null
  materia?: string | null
  estado?: string | null
  etapa?: string | null
  ubicacion?: string | null
  fecha_ingreso?: string | null
  estado_procesal?: string | null
  procedimiento?: string | null
  libro_tipo?: string | null
  fuente_sync?: string | null
  causa_origen?: string | null
  tribunal_origen?: string | null
  last_synced_at?: string | null
}

export interface DocumentInsert {
  case_id: string
  user_id: string
  filename: string
  original_filename?: string | null
  storage_path: string
  document_type?: string
  file_size: number
  file_hash?: string | null
  source?: string
  source_url?: string | null
  captured_at?: string | null
  metadata?: Record<string, unknown>
  cuaderno_id?: string | null
  folio_id?: string | null
  folio_anexo_id?: string | null
  anexo_causa_id?: string | null
  exhorto_doc_id?: string | null
  remision_id?: string | null
  remision_mov_id?: string | null
  remision_mov_anexo_id?: string | null
  pieza_exhorto_id?: string | null
  escrito_id?: string | null
  origen?: string | null
  tramite_pjud?: string | null
}

export interface DocumentHashInsert {
  user_id: string
  rol: string
  hash: string
  case_id?: string | null
  filename?: string | null
  document_type?: string | null
  tribunal?: string | null
  caratula?: string | null
}

export interface ExtractedTextInsert {
  document_id: string
  case_id: string
  user_id: string
  full_text?: string
  extraction_method?: string | null
  page_count?: number
  status?: string
}

// ════════════════════════════════════════════════════════
// Tablas nuevas — Nivel Cuaderno
// ════════════════════════════════════════════════════════

export interface CaseCuadernoInsert {
  case_id: string
  user_id: string
  nombre: string
  procedimiento?: string | null
  etapa?: string | null
  posicion?: number
}

export interface CaseFolioInsert {
  case_id: string
  cuaderno_id: string
  user_id: string
  numero_folio: number
  etapa?: string | null
  tramite?: string | null
  desc_tramite?: string | null
  fecha_tramite?: string | null
  foja?: number
  tiene_doc_principal?: boolean
  tiene_certificado_escrito?: boolean
  tiene_anexo_solicitud?: boolean
}

export interface CaseFolioAnexoInsert {
  case_id: string
  folio_id: string
  user_id: string
  fecha?: string | null
  referencia?: string | null
}

export interface CaseLitiganteInsert {
  case_id: string
  cuaderno_id: string
  user_id: string
  participante?: string | null
  rut?: string | null
  persona?: string | null
  nombre_razon_social?: string | null
}

export interface CaseNotificacionInsert {
  case_id: string
  cuaderno_id: string
  user_id: string
  rol?: string | null
  estado_notif?: string | null
  tipo_notif?: string | null
  fecha_tramite?: string | null
  tipo_participante?: string | null
  nombre?: string | null
  tramite?: string | null
  obs_fallida?: string | null
}

export interface CaseEscritoInsert {
  case_id: string
  cuaderno_id: string
  user_id: string
  fecha_ingreso?: string | null
  tipo_escrito?: string | null
  solicitante?: string | null
  tiene_doc?: boolean
  tiene_anexo?: boolean
}

// ════════════════════════════════════════════════════════
// Tablas nuevas — Nivel Causa (globales)
// ════════════════════════════════════════════════════════

export interface CaseAnexoCausaInsert {
  case_id: string
  user_id: string
  fecha?: string | null
  referencia?: string | null
}

export interface CaseReceptorRetiroInsert {
  case_id: string
  user_id: string
  cuaderno?: string | null
  datos_retiro?: string | null
  fecha_retiro?: string | null
  estado?: string | null
}

export interface CaseExhortoInsert {
  case_id: string
  user_id: string
  rol_origen?: string | null
  tipo_exhorto?: string | null
  rol_destino?: string | null
  fecha_ordena?: string | null
  fecha_ingreso?: string | null
  tribunal_destino?: string | null
  estado_exhorto?: string | null
}

export interface CaseExhortoDocInsert {
  case_id: string
  exhorto_id: string
  user_id: string
  fecha?: string | null
  referencia?: string | null
  tramite?: string | null
}

// ════════════════════════════════════════════════════════
// Tablas nuevas — Remisiones
// ════════════════════════════════════════════════════════

export interface CaseRemisionInsert {
  case_id: string
  user_id: string
  descripcion_tramite?: string | null
  fecha_tramite?: string | null
  libro?: string | null
  fecha?: string | null
  estado_recurso?: string | null
  estado_procesal?: string | null
  ubicacion?: string | null
  recurso?: string | null
  corte?: string | null
  tiene_certificado?: boolean
  tiene_ebook?: boolean
  tiene_texto?: boolean
  tiene_anexo?: boolean
  exp_causa_origen?: string | null
  exp_tribunal?: string | null
  exp_caratulado?: string | null
  exp_materia?: string | null
  exp_ruc?: string | null
  exp_fecha_ingreso?: string | null
}

export interface CaseRemisionMovimientoInsert {
  case_id: string
  remision_id: string
  user_id: string
  numero_folio: number
  tramite?: string | null
  descripcion?: string | null
  nomenclaturas?: string | null
  fecha?: string | null
  sala?: string | null
  estado?: string | null
  tiene_doc?: boolean
  tiene_certificado_escrito?: boolean
  tiene_anexo_escrito?: boolean
}

export interface CaseRemisionMovAnexoInsert {
  case_id: string
  movimiento_id: string
  user_id: string
  codigo?: string | null
  tipo_documento?: string | null
  cantidad?: string | null
  observacion?: string | null
}

export interface CaseRemisionLitiganteInsert {
  case_id: string
  remision_id: string
  user_id: string
  sujeto?: string | null
  rut?: string | null
  persona?: string | null
  nombre_razon_social?: string | null
}

export interface CaseRemisionExhortoInsert {
  case_id: string
  remision_id: string
  user_id: string
  exhorto?: string | null
}

export interface CaseRemisionIncompetenciaInsert {
  case_id: string
  remision_id: string
  user_id: string
  incompetencia?: string | null
}

// ════════════════════════════════════════════════════════
// Tabla nueva — Piezas Exhorto (solo causas tipo E)
// ════════════════════════════════════════════════════════

export interface CasePiezaExhortoInsert {
  case_id: string
  cuaderno_id: string
  user_id: string
  numero_folio: number
  cuaderno_pieza?: string | null
  etapa?: string | null
  tramite?: string | null
  desc_tramite?: string | null
  fecha_tramite?: string | null
  foja?: number
  tiene_doc?: boolean
  tiene_anexo?: boolean
}

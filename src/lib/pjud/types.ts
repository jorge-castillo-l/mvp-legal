/**
 * Tipos para el pipeline de sincronización PJUD.
 *
 * Estructura de 2 niveles:
 *   - Nivel CAUSA (global): metadata, docs directos, anexos, receptor, exhortos, remisiones
 *   - Nivel CUADERNO: proc, etapa, folios, litigantes, notificaciones, escritos
 *
 * CausaPackage es el paquete JSON que la extensión envía al API route /api/scraper/sync.
 */

// ════════════════════════════════════════════════════════
// Primitivas reutilizables
// ════════════════════════════════════════════════════════

export interface JwtRef {
  jwt: string
  action: string
  param: string
}

export interface PjudCookies {
  PHPSESSID: string
  TS01262d1d?: string
}

export type LibroTipo = 'c' | 'v' | 'e' | 'a' | 'f' | 'i'
export type FuenteSync = 'consulta_unificada' | 'mis_causas'

// ════════════════════════════════════════════════════════
// T10b — Folio de la tabla Historia (por cuaderno)
// ════════════════════════════════════════════════════════

export interface Folio {
  numero: number
  etapa: string
  tramite: string
  desc_tramite: string
  fecha_tramite: string
  foja: number
  tiene_doc_principal: boolean
  tiene_certificado_escrito: boolean
  tiene_anexo_solicitud: boolean
  jwt_doc_principal: JwtRef | null
  jwt_certificado_escrito: JwtRef | null
  jwt_anexo_solicitud: string | null
}

// ════════════════════════════════════════════════════════
// T10c — Litigante (por cuaderno)
// ════════════════════════════════════════════════════════

export interface Litigante {
  participante: string
  rut: string
  persona: string
  nombre_razon_social: string
}

// ════════════════════════════════════════════════════════
// T10d — Notificación (por cuaderno)
// ════════════════════════════════════════════════════════

export interface Notificacion {
  rol: string
  estado_notif: string
  tipo_notif: string
  fecha_tramite: string
  tipo_participante: string
  nombre: string
  tramite: string
  obs_fallida: string
}

// ════════════════════════════════════════════════════════
// T10e — Escrito por resolver (por cuaderno)
// ════════════════════════════════════════════════════════

export interface Escrito {
  fecha_ingreso: string
  tipo_escrito: string
  solicitante: string
  tiene_doc: boolean
  tiene_anexo: boolean
  jwt_doc: JwtRef | null
}

// ════════════════════════════════════════════════════════
// T12 — Pieza de exhorto (solo causas tipo E, por cuaderno)
// ════════════════════════════════════════════════════════

export interface PiezaExhorto {
  numero_folio: number
  cuaderno_pieza: string
  etapa: string
  tramite: string
  desc_tramite: string
  fecha_tramite: string
  foja: number
  tiene_doc: boolean
  tiene_anexo: boolean
  jwt_doc: JwtRef | null
}

// ════════════════════════════════════════════════════════
// Datos del cuaderno visible (T10a + tabs)
// ════════════════════════════════════════════════════════

export interface CuadernoData {
  nombre: string
  procedimiento: string | null
  etapa: string | null
  folios: Folio[]
  litigantes: Litigante[]
  notificaciones: Notificacion[]
  escritos: Escrito[]
  piezas_exhorto: PiezaExhorto[]
}

// ════════════════════════════════════════════════════════
// Cuaderno no-visible (solo JWT para fetch server-side)
// ════════════════════════════════════════════════════════

export interface CuadernoRef {
  nombre: string
  jwt: string
}

// ════════════════════════════════════════════════════════
// T6 — Exhorto (global, deduplicado)
// ════════════════════════════════════════════════════════

export interface ExhortoEntry {
  rol_origen: string
  tipo_exhorto: string
  rol_destino: string
  fecha_ordena: string
  fecha_ingreso: string
  tribunal_destino: string
  estado_exhorto: string
  jwt_detalle: string | null
}

// ════════════════════════════════════════════════════════
// T3 — Anexo de la causa (referencia, del modal AJAX)
// ════════════════════════════════════════════════════════

export interface AnexoFile {
  jwt: JwtRef
  fecha: string
  referencia: string
}

// ════════════════════════════════════════════════════════
// T7 — Documento del detalle de exhorto (del modal AJAX)
// ════════════════════════════════════════════════════════

export interface ExhortoDetalleDoc {
  jwt: JwtRef
  fecha: string
  referencia: string
  tramite: string
}

// ════════════════════════════════════════════════════════
// T5 — Remisión en la Corte (entrada del panel DOM)
// ════════════════════════════════════════════════════════

export interface RemisionEntry {
  jwt: string
  descripcion_tramite: string
  fecha_tramite: string
}

// ════════════════════════════════════════════════════════
// T6-E — Causa Origen (solo causas tipo E)
// ════════════════════════════════════════════════════════

export interface ExhortoData {
  causa_origen: string | null
  tribunal_origen: string | null
  jwt_causa_origen: string | null
}

// ════════════════════════════════════════════════════════
// CausaPackage — paquete enviado por la extensión
// ════════════════════════════════════════════════════════

export interface CausaPackage {
  // T1: Metadata global de la causa
  rol: string
  libro_tipo: string | null
  tribunal: string | null
  caratula: string | null
  materia: string | null
  estado_adm: string | null
  ubicacion: string | null
  estado_procesal: string | null
  fecha_ingreso: string | null
  fuente: FuenteSync
  cookies: PjudCookies | null
  csrf_token: string | null

  // T2: JWTs de docs directos (globales)
  jwt_texto_demanda: JwtRef | null
  jwt_certificado_envio: JwtRef | null
  jwt_ebook: JwtRef | null

  // JWTs globales para fetch server-side
  jwt_anexos: string | null
  jwt_receptor: string | null

  // Cuaderno visible (completo con folios + tabs)
  cuaderno_visible: CuadernoData

  // Cuadernos no-visibles (JWTs para fetch server-side)
  otros_cuadernos: CuadernoRef[]

  // T6: Exhortos (extraídos una sola vez, deduplicados)
  exhortos: ExhortoEntry[]

  // T6-E: Causa origen (solo causas tipo E)
  exhorto_data: ExhortoData | null

  // T5: Remisiones (JWTs para fetch server-side)
  remisiones: RemisionEntry[]

  // Meta
  extracted_at: string
  page_url: string

  // Resume
  resume_case_id?: string
}

// ════════════════════════════════════════════════════════
// Apelaciones — datos parseados del modal detalle (T8)
// ════════════════════════════════════════════════════════

export interface ApelacionMetadata {
  libro: string | null
  fecha: string | null
  estado_recurso: string | null
  estado_procesal: string | null
  ubicacion: string | null
  recurso: string | null
  corte: string | null
}

export interface ApelacionFolio {
  numero: number
  jwt_doc: JwtRef | null
  jwt_certificado_escrito: JwtRef | null
  jwt_anexo_escrito: string | null
  tramite: string
  descripcion: string
  nomenclaturas: string | null
  fecha: string
  sala: string
  estado: string
}

export interface ApelacionLitigante {
  sujeto: string
  rut: string
  persona: string
  nombre_razon_social: string
}

export interface ApelacionTabsData {
  litigantes: ApelacionLitigante[]
  exhortos: Array<{ exhorto: string }>
  incompetencia: Array<{ incompetencia: string }>
}

export interface ApelacionExpediente {
  causa_origen: string | null
  tribunal: string | null
  caratulado: string | null
  materia: string | null
  ruc: string | null
  fecha_ingreso: string | null
  jwt_detalle_civil: string | null
}

export interface ApelacionDirectJwts {
  certificado_envio: JwtRef | null
  ebook: JwtRef | null
  texto: JwtRef | null
  anexo_recurso: string | null
}

export interface ApelacionDetail {
  metadata: ApelacionMetadata
  direct_jwts: ApelacionDirectJwts
  folios: ApelacionFolio[]
  tabs: ApelacionTabsData
  expediente: ApelacionExpediente | null
}

// ════════════════════════════════════════════════════════
// T9 — Anexo de escrito de apelación (del modal AJAX)
// ════════════════════════════════════════════════════════

export interface AnexoEscritoApelacion {
  jwt: JwtRef
  codigo: string
  tipo_documento: string
  cantidad: string
  observacion: string
}

// ════════════════════════════════════════════════════════
// Receptor — datos parseados del modal AJAX (T4)
// ════════════════════════════════════════════════════════

export interface ReceptorRetiro {
  cuaderno: string
  datos_retiro: string
  fecha_retiro: string
  estado: string
}

// ════════════════════════════════════════════════════════
// Resultado de sync — retornado al sidepanel
// ════════════════════════════════════════════════════════

export interface SyncedDocument {
  document_id: string
  filename: string
  document_type: string
  folio: number | null
  cuaderno: string | null
  fecha: string | null
  storage_path: string
  is_new: boolean
}

export type SyncChangeCategory =
  | 'metadata' | 'cuaderno' | 'folio' | 'folio_anexo'
  | 'litigante' | 'notificacion' | 'escrito' | 'pieza_exhorto'
  | 'anexo_causa' | 'receptor' | 'exhorto' | 'exhorto_doc'
  | 'remision' | 'remision_movimiento' | 'remision_mov_anexo'
  | 'remision_litigante' | 'remision_exhorto' | 'remision_incompetencia'

export interface SyncChange {
  category: SyncChangeCategory
  type: 'added' | 'changed' | 'removed'
  cuaderno: string | null
  entity_key: string
  field: string | null
  old_value: string | null
  new_value: string | null
  description: string
}

export interface SyncResult {
  success: boolean
  case_id: string
  rol: string
  tribunal: string | null
  documents_new: SyncedDocument[]
  documents_existing: number
  documents_failed: number
  total_downloaded: number
  errors: string[]
  duration_ms: number
  changes: SyncChange[]
  is_first_sync: boolean
  has_pending: boolean
  pending_count: number
  /** True when failed tasks were persisted for automatic retry via /api/scraper/retry-failed */
  failed_saved_for_retry: boolean
}

// ════════════════════════════════════════════════════════
// Tipos internos del pipeline
// ════════════════════════════════════════════════════════

export type DocumentOrigen =
  | 'directo'
  | 'folio'
  | 'folio_certificado'
  | 'anexo_causa'
  | 'anexo_solicitud'
  | 'exhorto'
  | 'remision_directo'
  | 'remision_movimiento'
  | 'remision_mov_anexo'
  | 'escrito'
  | 'pieza_exhorto'

export interface PdfDownloadTask {
  jwt: string
  endpoint: string
  param: string
  filename: string
  origen: DocumentOrigen
  tramite_pjud: string | null
  folio: number | null
  cuaderno: string | null
  fecha: string | null
  source_url: string
  referencia?: string
  retry_count?: number
  skip_reason?: 'unsupported_format' | 'max_retries'
}

// ════════════════════════════════════════════════════════
// SyncSnapshot — espejo 1:1 del árbol relacional de tablas PJUD
// Persistido en cases.sync_snapshot (JSONB) para diff entre syncs
// ════════════════════════════════════════════════════════

export interface SyncSnapshot {
  metadata: SnapMetadata
  cuadernos: SnapCuaderno[]
  anexos_causa: SnapAnexoCausa[]
  receptor_retiros: SnapReceptorRetiro[]
  exhortos: SnapExhorto[]
  remisiones: SnapRemision[]
  snapshot_at: string
}

export interface SnapMetadata {
  estado_adm: string | null
  ubicacion: string | null
  estado_procesal: string | null
  caratula: string | null
  materia: string | null
  causa_origen: string | null
  tribunal_origen: string | null
}

export interface SnapCuaderno {
  nombre: string
  procedimiento: string | null
  etapa: string | null
  folios: SnapFolio[]
  litigantes: SnapLitigante[]
  notificaciones: SnapNotificacion[]
  escritos: SnapEscrito[]
  piezas_exhorto: SnapPiezaExhorto[]
}

export interface SnapFolio {
  numero_folio: number
  etapa: string | null
  tramite: string | null
  desc_tramite: string | null
  fecha_tramite: string | null
  foja: number
  tiene_doc_principal: boolean
  tiene_certificado_escrito: boolean
  tiene_anexo_solicitud: boolean
  anexos: SnapFolioAnexo[]
}

export interface SnapFolioAnexo {
  fecha: string | null
  referencia: string | null
}

export interface SnapLitigante {
  participante: string | null
  rut: string | null
  persona: string | null
  nombre_razon_social: string | null
}

export interface SnapNotificacion {
  rol: string | null
  estado_notif: string | null
  tipo_notif: string | null
  fecha_tramite: string | null
  tipo_participante: string | null
  nombre: string | null
  tramite: string | null
  obs_fallida: string | null
}

export interface SnapEscrito {
  fecha_ingreso: string | null
  tipo_escrito: string | null
  solicitante: string | null
  tiene_doc: boolean
  tiene_anexo: boolean
}

export interface SnapPiezaExhorto {
  numero_folio: number
  cuaderno_pieza: string | null
  etapa: string | null
  tramite: string | null
  desc_tramite: string | null
  fecha_tramite: string | null
  foja: number
  tiene_doc: boolean
  tiene_anexo: boolean
}

export interface SnapAnexoCausa {
  fecha: string | null
  referencia: string | null
}

export interface SnapReceptorRetiro {
  cuaderno: string | null
  datos_retiro: string | null
  fecha_retiro: string | null
  estado: string | null
}

export interface SnapExhortoDoc {
  fecha: string | null
  referencia: string | null
  tramite: string | null
}

export interface SnapExhorto {
  rol_origen: string | null
  tipo_exhorto: string | null
  rol_destino: string | null
  fecha_ordena: string | null
  fecha_ingreso: string | null
  tribunal_destino: string | null
  estado_exhorto: string | null
  docs: SnapExhortoDoc[]
}

export interface SnapRemisionMovAnexo {
  codigo: string | null
  tipo_documento: string | null
  cantidad: string | null
  observacion: string | null
}

export interface SnapRemisionMovimiento {
  numero_folio: number
  tramite: string | null
  descripcion: string | null
  nomenclaturas: string | null
  fecha: string | null
  sala: string | null
  estado: string | null
  tiene_doc: boolean
  tiene_certificado_escrito: boolean
  tiene_anexo_escrito: boolean
  anexos: SnapRemisionMovAnexo[]
}

export interface SnapRemisionLitigante {
  sujeto: string | null
  rut: string | null
  persona: string | null
  nombre_razon_social: string | null
}

export interface SnapRemision {
  descripcion_tramite: string | null
  fecha_tramite: string | null
  libro: string | null
  fecha: string | null
  estado_recurso: string | null
  estado_procesal: string | null
  ubicacion: string | null
  recurso: string | null
  corte: string | null
  tiene_certificado: boolean
  tiene_ebook: boolean
  tiene_texto: boolean
  tiene_anexo: boolean
  exp_causa_origen: string | null
  exp_tribunal: string | null
  exp_caratulado: string | null
  exp_materia: string | null
  exp_ruc: string | null
  exp_fecha_ingreso: string | null
  movimientos: SnapRemisionMovimiento[]
  litigantes: SnapRemisionLitigante[]
  exhortos: Array<{ exhorto: string | null }>
  incompetencias: Array<{ incompetencia: string | null }>
}

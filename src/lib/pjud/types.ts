/**
 * Tipos para el pipeline de sincronización PJUD (Tarea 4.17).
 *
 * CausaPackage es la interfaz del paquete JSON que la extensión
 * (JWT Extractor, tarea 4.16) envía al API route /api/scraper/sync.
 */

// ════════════════════════════════════════════════════════
// CausaPackage — paquete enviado por la extensión
// ════════════════════════════════════════════════════════

export interface JwtRef {
  jwt: string
  action: string
  param: string
}

export interface Cuaderno {
  nombre: string
  jwt: string
  selected: boolean
}

export interface Folio {
  numero: number
  etapa: string
  tramite: string
  desc_tramite: string
  fecha_tramite: string
  foja: number
  jwt_doc_principal: JwtRef | null
  jwt_certificado_escrito: JwtRef | null
  jwt_georef: string | null
  jwt_anexo_solicitud: string | null
  _source?: string
}

export interface TabsData {
  litigantes: Array<{
    participante: string
    rut: string
    persona: string
    nombre: string
  }>
  notificaciones: Array<{
    rol: string
    estado_notif: string
    tipo_notif: string
    fecha_tramite: string
    tipo_participante: string
    nombre: string
    tramite: string
    obs_fallida: string
  }>
  escritos_por_resolver: Array<{
    doc: string
    anexo: string
    fecha_ingreso: string
    tipo_escrito: string
    solicitante: string
    jwt_doc: JwtRef | null
  }>
  exhortos: Array<{
    rol_origen: string
    tipo_exhorto: string
    rol_destino: string
    fecha_ordena: string
    fecha_ingreso: string
    tribunal_destino: string
    estado_exhorto: string
    jwt_detalle: string | null
  }>
}

export interface AnexoFile {
  jwt: JwtRef
  fecha: string
  referencia: string
}

export interface ExhortoData {
  causa_origen: string | null
  tribunal_origen: string | null
  jwt_causa_origen: string | null
}

export interface ExhortoDetalleDoc {
  jwt: JwtRef
  fecha: string
  referencia: string
  tramite: string
}

// ════════════════════════════════════════════════════════
// Remisiones en la Corte — extraídas del DOM por JwtExtractor
// ════════════════════════════════════════════════════════

export interface RemisionEntry {
  jwt: string
  descripcion_tramite: string
  fecha_tramite: string
}

// ════════════════════════════════════════════════════════
// Apelaciones — datos parseados del modal detalle
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
  tramite: string
  descripcion: string
  nomenclaturas: string | null
  fecha: string
  sala: string
  estado: string
}

export interface ApelacionTabsData {
  litigantes: Array<{
    sujeto: string
    rut: string
    persona: string
    nombre: string
  }>
  exhortos: Array<{ descripcion: string }>
  incompetencia: Array<{ descripcion: string }>
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

export interface PjudCookies {
  PHPSESSID: string
  TS01262d1d?: string
}

export interface CausaPackage {
  rol: string
  libro_tipo: string | null
  tribunal: string | null
  estado_adm: string | null
  procedimiento: string | null
  procedimiento_raw: string | null
  etapa: string | null
  ubicacion: string | null
  fecha_ingreso: string | null
  estado_procesal: string | null

  caratula: string | null
  materia: string | null
  fuente: 'consulta_unificada' | 'mis_causas'
  cookies: PjudCookies | null

  jwt_texto_demanda: JwtRef | null
  jwt_certificado_envio: JwtRef | null
  jwt_ebook: JwtRef | null
  jwt_anexos: string | null
  jwt_receptor: string | null
  csrf_token: string | null

  cuadernos: Cuaderno[]
  folios: Folio[]
  tabs: TabsData | null
  exhorto: ExhortoData | null
  remisiones: RemisionEntry[]

  extracted_at: string
  page_url: string
}

// ════════════════════════════════════════════════════════
// Tarea 4.20 — Secciones adicionales PJUD
// ════════════════════════════════════════════════════════

/**
 * Datos del Modal Receptor (#modalReceptorCivil).
 * Obtenidos llamando a receptorCivil.php con jwt_receptor.
 *
 * HTML real PJUD: tabla con columnas
 *   Cuaderno | Datos del Retiro | Fecha Retiro | Estado
 */
export interface ReceptorRetiro {
  cuaderno: string
  datos_retiro: string
  fecha_retiro: string
  estado: string
}

export interface ReceptorData {
  receptor_nombre: string | null
  retiros: ReceptorRetiro[]
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

export interface SyncChange {
  category: 'folio' | 'cuaderno' | 'anexo' | 'exhorto' | 'receptor' | 'metadata' | 'tab' | 'remision'
  description: string
}

export interface SyncSnapshot {
  cuadernos: Array<{
    nombre: string
    folio_count: number
    folio_numeros: number[]
  }>
  anexos: Array<{
    fecha: string
    referencia: string
  }>
  exhortos: Array<{
    rol_destino: string
    estado: string
    doc_count: number
  }>
  receptor_retiros: Array<{
    cuaderno: string
    fecha_retiro: string
    estado: string
  }>
  remisiones: Array<{
    descripcion_tramite: string
    fecha_tramite: string
    libro: string | null
    folio_count: number
  }>
  metadata: {
    estado: string
    estado_procesal: string
    etapa: string
    ubicacion: string
    procedimiento: string
  }
  tabs_counts: {
    litigantes: number
    notificaciones: number
    escritos_por_resolver: number
    exhortos: number
  }
  snapshot_at: string
}

export interface SyncResult {
  success: boolean
  case_id: string
  rol: string
  tribunal: string | null
  procedimiento: string | null
  documents_new: SyncedDocument[]
  documents_existing: number
  documents_failed: number
  total_downloaded: number
  errors: string[]
  duration_ms: number
  tabs_stored: boolean
  receptor_stored: boolean
  causa_origen_stored: boolean
  exhortos_count: number
  exhortos_docs_downloaded: number
  remisiones_count: number
  remisiones_docs_downloaded: number
  remisiones_stored: boolean
  changes: SyncChange[]
  is_first_sync: boolean
}

// ════════════════════════════════════════════════════════
// Tipos internos del pipeline
// ════════════════════════════════════════════════════════

export interface FolioMetadata {
  folio_numero: number | null
  etapa: string | null
  tramite: string | null
  desc_tramite: string | null
  fecha_tramite: string | null
  foja: number | null
  cuaderno: string | null
  source_tab?: 'historia' | 'piezas_exhorto'
}

export interface PdfDownloadTask {
  jwt: string
  endpoint: string
  param: string
  filename: string
  document_type: string
  folio: number | null
  cuaderno: string | null
  fecha: string | null
  source_url: string
  folio_metadata?: FolioMetadata
  referencia?: string
}

export type Procedimiento = 'ordinario' | 'ejecutivo' | 'sumario' | 'monitorio' | 'voluntario'
export type LibroTipo = 'c' | 'v' | 'e' | 'a' | 'f' | 'i'
export type FuenteSync = 'consulta_unificada' | 'mis_causas'

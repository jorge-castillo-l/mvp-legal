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
  }>
  exhortos: Array<{
    rol_origen: string
    tipo_exhorto: string
    rol_destino: string
    fecha_ordena: string
    fecha_ingreso: string
    tribunal_destino: string
    estado_exhorto: string
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

  extracted_at: string
  page_url: string
}

// ════════════════════════════════════════════════════════
// Tarea 4.20 — Secciones adicionales PJUD
// ════════════════════════════════════════════════════════

/**
 * Datos del Modal Receptor (#modalReceptorCivil).
 * Obtenidos llamando a receptorCivil.php con jwt_receptor.
 * La estructura exacta se confirmará al validar contra HTML real de PJUD.
 */
export interface ReceptorCertificacion {
  fecha: string
  tipo: string
  resultado: string
  obs: string
}

export interface ReceptorDiligencia {
  fecha: string
  tipo: string
  descripcion: string
}

export interface ReceptorData {
  receptor_nombre: string | null
  tipo_receptor: string | null
  certificaciones: ReceptorCertificacion[]
  diligencias: ReceptorDiligencia[]
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
  // 4.20: datos adicionales almacenados
  tabs_stored: boolean
  receptor_stored: boolean
}

// ════════════════════════════════════════════════════════
// Tipos internos del pipeline
// ════════════════════════════════════════════════════════

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
}

export type Procedimiento = 'ordinario' | 'ejecutivo' | 'sumario' | 'monitorio' | 'voluntario'
export type LibroTipo = 'c' | 'v' | 'e' | 'a' | 'f' | 'i'
export type FuenteSync = 'consulta_unificada' | 'mis_causas'

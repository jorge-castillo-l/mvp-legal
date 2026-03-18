/**
 * Módulo de comparación (diff) entre sincronizaciones PJUD.
 *
 * Compara un snapshot anterior (JSONB en cases.sync_snapshot) contra
 * el estado actual de las 19 tablas estructuradas. Genera SyncChange[]
 * con detalle celda-por-celda para cada tabla del schema.
 *
 * Cobertura: 19 tablas, 72 campos, 3 niveles de anidamiento.
 */

import type {
  SyncChange,
  SyncChangeCategory,
  SyncSnapshot,
  SnapMetadata,
  SnapCuaderno,
  SnapFolio,
  SnapFolioAnexo,
  SnapLitigante,
  SnapNotificacion,
  SnapEscrito,
  SnapPiezaExhorto,
  SnapAnexoCausa,
  SnapReceptorRetiro,
  SnapExhorto,
  SnapExhortoDoc,
  SnapRemision,
  SnapRemisionMovimiento,
  SnapRemisionMovAnexo,
  SnapRemisionLitigante,
} from './types'

type SupabaseAdmin = { from: (table: string) => any; storage: any }

// ════════════════════════════════════════════════════════
// Etiquetas en español para campos
// ════════════════════════════════════════════════════════

const FL: Record<string, string> = {
  estado_adm: 'Estado administrativo',
  ubicacion: 'Ubicación',
  estado_procesal: 'Estado procesal',
  caratula: 'Carátula',
  materia: 'Materia',
  causa_origen: 'Causa origen',
  tribunal_origen: 'Tribunal origen',
  procedimiento: 'Procedimiento',
  etapa: 'Etapa',
  tramite: 'Trámite',
  desc_tramite: 'Desc. trámite',
  fecha_tramite: 'Fecha trámite',
  foja: 'Foja',
  tiene_doc_principal: 'Doc. principal',
  tiene_certificado_escrito: 'Certificado escrito',
  tiene_anexo_solicitud: 'Anexo solicitud',
  participante: 'Participante',
  rut: 'RUT',
  persona: 'Persona',
  nombre_razon_social: 'Nombre/Razón social',
  rol: 'ROL',
  estado_notif: 'Estado notificación',
  tipo_notif: 'Tipo notificación',
  tipo_participante: 'Tipo participante',
  nombre: 'Nombre',
  obs_fallida: 'Obs. fallida',
  fecha_ingreso: 'Fecha ingreso',
  tipo_escrito: 'Tipo escrito',
  solicitante: 'Solicitante',
  tiene_doc: 'Doc. disponible',
  tiene_anexo: 'Anexo disponible',
  tiene_anexo_escrito: 'Anexo escrito',
  fecha: 'Fecha',
  referencia: 'Referencia',
  cuaderno_pieza: 'Cuaderno pieza',
  cuaderno: 'Cuaderno',
  datos_retiro: 'Datos retiro',
  fecha_retiro: 'Fecha retiro',
  estado: 'Estado',
  rol_origen: 'ROL origen',
  tipo_exhorto: 'Tipo exhorto',
  rol_destino: 'ROL destino',
  fecha_ordena: 'Fecha ordena',
  tribunal_destino: 'Tribunal destino',
  estado_exhorto: 'Estado exhorto',
  libro: 'Libro',
  estado_recurso: 'Estado recurso',
  recurso: 'Recurso',
  corte: 'Corte',
  tiene_certificado: 'Certificado',
  tiene_ebook: 'Ebook',
  tiene_texto: 'Texto',
  descripcion_tramite: 'Desc. trámite',
  descripcion: 'Descripción',
  nomenclaturas: 'Nomenclaturas',
  sala: 'Sala',
  codigo: 'Código',
  tipo_documento: 'Tipo documento',
  cantidad: 'Cantidad',
  observacion: 'Observación',
  sujeto: 'Sujeto',
  exhorto: 'Exhorto',
  incompetencia: 'Incompetencia',
  exp_causa_origen: 'Exp. causa origen',
  exp_tribunal: 'Exp. tribunal',
  exp_caratulado: 'Exp. caratulado',
  exp_materia: 'Exp. materia',
  exp_ruc: 'Exp. RUC',
  exp_fecha_ingreso: 'Exp. fecha ingreso',
}

function fieldLabel(name: string): string {
  return FL[name] ?? name
}

// ════════════════════════════════════════════════════════
// Normalización de valores para comparación
// ════════════════════════════════════════════════════════

function str(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'boolean') return v ? 'sí' : 'no'
  return String(v).trim().replace(/\s+/g, ' ')
}

function isTruncationVariant(a: string, b: string): boolean {
  if (!a || !b) return false
  return a.startsWith(b) || b.startsWith(a)
}

// ════════════════════════════════════════════════════════
// DIFF GENÉRICO — compara dos arrays entidad por entidad, campo por campo
// ════════════════════════════════════════════════════════

interface FieldSpec<T> {
  name: string
  get: (item: T) => unknown
}

function diffEntities<T>(
  oldArr: T[],
  newArr: T[],
  keyFn: (item: T) => string,
  fields: FieldSpec<T>[],
  category: SyncChangeCategory,
  cuadernoCtx: string | null,
  labelFn: (item: T) => string,
): SyncChange[] {
  const changes: SyncChange[] = []
  const oldMap = new Map(oldArr.map(item => [keyFn(item), item]))
  const newMap = new Map(newArr.map(item => [keyFn(item), item]))

  for (const [key, item] of newMap) {
    if (!oldMap.has(key)) {
      changes.push({
        category, type: 'added', cuaderno: cuadernoCtx,
        entity_key: key, field: null, old_value: null, new_value: null,
        description: `Nuevo: ${labelFn(item)}`,
      })
    }
  }

  for (const [key, item] of oldMap) {
    if (!newMap.has(key)) {
      changes.push({
        category, type: 'removed', cuaderno: cuadernoCtx,
        entity_key: key, field: null, old_value: null, new_value: null,
        description: `Removido: ${labelFn(item)}`,
      })
    }
  }

  for (const [key, newItem] of newMap) {
    const oldItem = oldMap.get(key)
    if (!oldItem) continue
    for (const f of fields) {
      const ov = str(f.get(oldItem))
      const nv = str(f.get(newItem))
      if (ov !== nv) {
        changes.push({
          category, type: 'changed', cuaderno: cuadernoCtx,
          entity_key: key, field: f.name,
          old_value: ov || null, new_value: nv || null,
          description: `${labelFn(newItem)}: ${fieldLabel(f.name)} «${ov || '(vacío)'}» → «${nv || '(vacío)'}»`,
        })
      }
    }
  }

  return changes
}

// ════════════════════════════════════════════════════════
// BUILD SNAPSHOT FROM DB
// ════════════════════════════════════════════════════════

export async function buildSnapshotFromDb(db: SupabaseAdmin, caseId: string): Promise<SyncSnapshot> {
  // Las tablas estructuradas (case_cuadernos, case_folios, etc.) y columnas nuevas (causa_origen, etc.)
  // pueden no estar en los tipos generados de Supabase. Usamos 'as any' para las queries porque
  // el schema real en la DB tiene estas tablas/columnas — los tipos generados están desactualizados.

  const { data: c } = await (db as any)
    .from('cases')
    .select('estado, ubicacion, estado_procesal, caratula, materia, causa_origen, tribunal_origen')
    .eq('id', caseId)
    .single() as { data: Record<string, string | null> | null }

  const metadata: SnapMetadata = {
    estado_adm: c?.estado ?? null,
    ubicacion: c?.ubicacion ?? null,
    estado_procesal: c?.estado_procesal ?? null,
    caratula: c?.caratula ?? null,
    materia: c?.materia ?? null,
    causa_origen: c?.causa_origen ?? null,
    tribunal_origen: c?.tribunal_origen ?? null,
  }

  type R = Record<string, any>
  const q = (table: string, cols: string) =>
    (db as any).from(table).select(cols).eq('case_id', caseId).then((r: { data: R[] | null }) => r.data ?? []) as Promise<R[]>

  const dbCuadernos = await (db as any).from('case_cuadernos').select('id, nombre, procedimiento, etapa').eq('case_id', caseId).order('posicion').then((r: { data: R[] | null }) => r.data ?? []) as R[]
  const dbFolios = await q('case_folios', 'id, cuaderno_id, numero_folio, etapa, tramite, desc_tramite, fecha_tramite, foja, tiene_doc_principal, tiene_certificado_escrito, tiene_anexo_solicitud')
  const dbFolioAnexos = await q('case_folio_anexos', 'folio_id, fecha, referencia')
  const dbLitigantes = await q('case_litigantes', 'cuaderno_id, participante, rut, persona, nombre_razon_social')
  const dbNotificaciones = await q('case_notificaciones', 'cuaderno_id, rol, estado_notif, tipo_notif, fecha_tramite, tipo_participante, nombre, tramite, obs_fallida')
  const dbEscritos = await q('case_escritos', 'cuaderno_id, fecha_ingreso, tipo_escrito, solicitante, tiene_doc, tiene_anexo')
  const dbPiezas = await q('case_piezas_exhorto', 'cuaderno_id, numero_folio, cuaderno_pieza, etapa, tramite, desc_tramite, fecha_tramite, foja, tiene_doc, tiene_anexo')
  const dbAnexosCausa = await q('case_anexos_causa', 'fecha, referencia')
  const dbReceptor = await q('case_receptor_retiros', 'cuaderno, datos_retiro, fecha_retiro, estado')
  const dbExhortos = await q('case_exhortos', 'id, rol_origen, tipo_exhorto, rol_destino, fecha_ordena, fecha_ingreso, tribunal_destino, estado_exhorto')
  const dbExhortoDocs = await q('case_exhorto_docs', 'exhorto_id, fecha, referencia, tramite')
  const dbRemisiones = await q('case_remisiones', 'id, descripcion_tramite, fecha_tramite, libro, fecha, estado_recurso, estado_procesal, ubicacion, recurso, corte, tiene_certificado, tiene_ebook, tiene_texto, tiene_anexo, exp_causa_origen, exp_tribunal, exp_caratulado, exp_materia, exp_ruc, exp_fecha_ingreso')
  const dbRemMov = await q('case_remision_movimientos', 'id, remision_id, numero_folio, tramite, descripcion, nomenclaturas, fecha, sala, estado, tiene_doc, tiene_certificado_escrito, tiene_anexo_escrito')
  const dbRemMovAnexos = await q('case_remision_mov_anexos', 'movimiento_id, codigo, tipo_documento, cantidad, observacion')
  const dbRemLit = await q('case_remision_litigantes', 'remision_id, sujeto, rut, persona, nombre_razon_social')
  const dbRemExh = await q('case_remision_exhortos', 'remision_id, exhorto')
  const dbRemInc = await q('case_remision_incompetencias', 'remision_id, incompetencia')

  // ── Agrupar por IDs ──

  const foliosByFolioId = new Map<string, R[]>()
  for (const fa of dbFolioAnexos) {
    const arr = foliosByFolioId.get(fa.folio_id) ?? []
    arr.push(fa)
    foliosByFolioId.set(fa.folio_id, arr)
  }

  const exhortoDocsMap = new Map<string, R[]>()
  for (const ed of dbExhortoDocs) {
    const arr = exhortoDocsMap.get(ed.exhorto_id) ?? []
    arr.push(ed)
    exhortoDocsMap.set(ed.exhorto_id, arr)
  }

  const remMovMap = new Map<string, R[]>()
  for (const m of dbRemMov) {
    const arr = remMovMap.get(m.remision_id) ?? []
    arr.push(m)
    remMovMap.set(m.remision_id, arr)
  }

  const remMovAnexosMap = new Map<string, R[]>()
  for (const a of dbRemMovAnexos) {
    const arr = remMovAnexosMap.get(a.movimiento_id) ?? []
    arr.push(a)
    remMovAnexosMap.set(a.movimiento_id, arr)
  }

  const remLitMap = new Map<string, R[]>()
  for (const l of dbRemLit) {
    const arr = remLitMap.get(l.remision_id) ?? []
    arr.push(l)
    remLitMap.set(l.remision_id, arr)
  }

  const remExhMap = new Map<string, R[]>()
  for (const e of dbRemExh) {
    const arr = remExhMap.get(e.remision_id) ?? []
    arr.push(e)
    remExhMap.set(e.remision_id, arr)
  }

  const remIncMap = new Map<string, R[]>()
  for (const i of dbRemInc) {
    const arr = remIncMap.get(i.remision_id) ?? []
    arr.push(i)
    remIncMap.set(i.remision_id, arr)
  }

  // ── Construir cuadernos ──

  const cuadernos: SnapCuaderno[] = dbCuadernos.map(cq => {
    const cqFolios = dbFolios.filter(f => f.cuaderno_id === cq.id)

    const folios: SnapFolio[] = cqFolios.map(f => ({
      numero_folio: f.numero_folio,
      etapa: f.etapa, tramite: f.tramite,
      desc_tramite: f.desc_tramite, fecha_tramite: f.fecha_tramite,
      foja: f.foja ?? 0,
      tiene_doc_principal: !!f.tiene_doc_principal,
      tiene_certificado_escrito: !!f.tiene_certificado_escrito,
      tiene_anexo_solicitud: !!f.tiene_anexo_solicitud,
      anexos: (foliosByFolioId.get(f.id) ?? []).map(a => ({
        fecha: a.fecha ?? null, referencia: a.referencia ?? null,
      })),
    }))

    return {
      nombre: cq.nombre,
      procedimiento: cq.procedimiento, etapa: cq.etapa,
      folios,
      litigantes: dbLitigantes.filter(l => l.cuaderno_id === cq.id).map(l => ({
        participante: l.participante, rut: l.rut,
        persona: l.persona, nombre_razon_social: l.nombre_razon_social,
      })),
      notificaciones: dbNotificaciones.filter(n => n.cuaderno_id === cq.id).map(n => ({
        rol: n.rol, estado_notif: n.estado_notif, tipo_notif: n.tipo_notif,
        fecha_tramite: n.fecha_tramite, tipo_participante: n.tipo_participante,
        nombre: n.nombre, tramite: n.tramite, obs_fallida: n.obs_fallida,
      })),
      escritos: dbEscritos.filter(e => e.cuaderno_id === cq.id).map(e => ({
        fecha_ingreso: e.fecha_ingreso, tipo_escrito: e.tipo_escrito,
        solicitante: e.solicitante, tiene_doc: !!e.tiene_doc, tiene_anexo: !!e.tiene_anexo,
      })),
      piezas_exhorto: dbPiezas.filter(p => p.cuaderno_id === cq.id).map(p => ({
        numero_folio: p.numero_folio, cuaderno_pieza: p.cuaderno_pieza,
        etapa: p.etapa, tramite: p.tramite, desc_tramite: p.desc_tramite,
        fecha_tramite: p.fecha_tramite, foja: p.foja ?? 0,
        tiene_doc: !!p.tiene_doc, tiene_anexo: !!p.tiene_anexo,
      })),
    }
  })

  // ── Exhortos con docs ──

  const exhortos: SnapExhorto[] = dbExhortos.map(e => ({
    rol_origen: e.rol_origen, tipo_exhorto: e.tipo_exhorto,
    rol_destino: e.rol_destino, fecha_ordena: e.fecha_ordena,
    fecha_ingreso: e.fecha_ingreso, tribunal_destino: e.tribunal_destino,
    estado_exhorto: e.estado_exhorto,
    docs: (exhortoDocsMap.get(e.id) ?? []).map(d => ({
      fecha: d.fecha ?? null, referencia: d.referencia ?? null, tramite: d.tramite ?? null,
    })),
  }))

  // ── Remisiones con sub-tablas ──

  const remisiones: SnapRemision[] = dbRemisiones.map(r => {
    const movs = remMovMap.get(r.id) ?? []

    const movimientos: SnapRemisionMovimiento[] = movs.map(m => ({
      numero_folio: m.numero_folio, tramite: m.tramite,
      descripcion: m.descripcion, nomenclaturas: m.nomenclaturas,
      fecha: m.fecha, sala: m.sala, estado: m.estado,
      tiene_doc: !!m.tiene_doc, tiene_certificado_escrito: !!m.tiene_certificado_escrito,
      tiene_anexo_escrito: !!m.tiene_anexo_escrito,
      anexos: (remMovAnexosMap.get(m.id) ?? []).map(a => ({
        codigo: a.codigo, tipo_documento: a.tipo_documento,
        cantidad: a.cantidad, observacion: a.observacion,
      })),
    }))

    return {
      descripcion_tramite: r.descripcion_tramite, fecha_tramite: r.fecha_tramite,
      libro: r.libro, fecha: r.fecha,
      estado_recurso: r.estado_recurso, estado_procesal: r.estado_procesal,
      ubicacion: r.ubicacion, recurso: r.recurso, corte: r.corte,
      tiene_certificado: !!r.tiene_certificado, tiene_ebook: !!r.tiene_ebook,
      tiene_texto: !!r.tiene_texto, tiene_anexo: !!r.tiene_anexo,
      exp_causa_origen: r.exp_causa_origen, exp_tribunal: r.exp_tribunal,
      exp_caratulado: r.exp_caratulado, exp_materia: r.exp_materia,
      exp_ruc: r.exp_ruc, exp_fecha_ingreso: r.exp_fecha_ingreso,
      movimientos,
      litigantes: (remLitMap.get(r.id) ?? []).map(l => ({
        sujeto: l.sujeto, rut: l.rut, persona: l.persona,
        nombre_razon_social: l.nombre_razon_social,
      })),
      exhortos: (remExhMap.get(r.id) ?? []).map(e => ({ exhorto: e.exhorto })),
      incompetencias: (remIncMap.get(r.id) ?? []).map(i => ({ incompetencia: i.incompetencia })),
    }
  })

  return {
    metadata,
    cuadernos,
    anexos_causa: dbAnexosCausa.map(a => ({ fecha: a.fecha ?? null, referencia: a.referencia ?? null })),
    receptor_retiros: dbReceptor.map(r => ({
      cuaderno: r.cuaderno, datos_retiro: r.datos_retiro,
      fecha_retiro: r.fecha_retiro, estado: r.estado,
    })),
    exhortos,
    remisiones,
    snapshot_at: new Date().toISOString(),
  }
}

// ════════════════════════════════════════════════════════
// GENERATE DIFF — compara dos snapshots celda por celda
// ════════════════════════════════════════════════════════

export function generateDiff(prev: SyncSnapshot, curr: SyncSnapshot): SyncChange[] {
  const changes: SyncChange[] = []

  // ── 1. Metadata (7 campos) ──
  const metaFields: Array<keyof SnapMetadata> = [
    'estado_adm', 'ubicacion', 'estado_procesal', 'caratula', 'materia', 'causa_origen', 'tribunal_origen',
  ]
  for (const f of metaFields) {
    const ov = str(prev.metadata[f])
    const nv = str(curr.metadata[f])
    if (ov !== nv && !isTruncationVariant(ov, nv)) {
      changes.push({
        category: 'metadata', type: 'changed', cuaderno: null,
        entity_key: 'causa', field: f,
        old_value: ov || null, new_value: nv || null,
        description: `${fieldLabel(f)}: «${ov || '(vacío)'}» → «${nv || '(vacío)'}»`,
      })
    }
  }

  // ── 2. Cuadernos (2 campos + sub-tablas) ──
  const prevCuadMap = new Map(prev.cuadernos.map(c => [c.nombre, c]))
  const currCuadMap = new Map(curr.cuadernos.map(c => [c.nombre, c]))

  for (const [nombre, cq] of currCuadMap) {
    if (!prevCuadMap.has(nombre)) {
      changes.push({
        category: 'cuaderno', type: 'added', cuaderno: nombre,
        entity_key: nombre, field: null, old_value: null, new_value: null,
        description: `Nuevo cuaderno: ${nombre}`,
      })
    }
  }
  for (const [nombre] of prevCuadMap) {
    if (!currCuadMap.has(nombre)) {
      changes.push({
        category: 'cuaderno', type: 'removed', cuaderno: nombre,
        entity_key: nombre, field: null, old_value: null, new_value: null,
        description: `Cuaderno removido: ${nombre}`,
      })
    }
  }

  for (const [nombre, currCq] of currCuadMap) {
    const prevCq = prevCuadMap.get(nombre)
    if (!prevCq) continue

    for (const f of ['procedimiento', 'etapa'] as const) {
      const ov = str(prevCq[f])
      const nv = str(currCq[f])
      if (ov !== nv) {
        changes.push({
          category: 'cuaderno', type: 'changed', cuaderno: nombre,
          entity_key: nombre, field: f,
          old_value: ov || null, new_value: nv || null,
          description: `Cuaderno ${nombre}: ${fieldLabel(f)} «${ov || '(vacío)'}» → «${nv || '(vacío)'}»`,
        })
      }
    }

    // ── 3. Folios (8 campos) ──
    changes.push(...diffFolios(prevCq.folios, currCq.folios, nombre))

    // ── 5. Litigantes (2 campos) ──
    changes.push(...diffEntities<SnapLitigante>(
      prevCq.litigantes, currCq.litigantes,
      l => `${str(l.rut)}|${str(l.participante)}`,
      [
        { name: 'persona', get: l => l.persona },
        { name: 'nombre_razon_social', get: l => l.nombre_razon_social },
      ],
      'litigante', nombre,
      l => `Litigante ${l.nombre_razon_social || l.rut || '?'} [${nombre}]`,
    ))

    // ── 6. Notificaciones (5 campos) ──
    changes.push(...diffEntities<SnapNotificacion>(
      prevCq.notificaciones, currCq.notificaciones,
      n => `${str(n.fecha_tramite)}|${str(n.nombre)}|${str(n.tramite)}`,
      [
        { name: 'rol', get: n => n.rol },
        { name: 'estado_notif', get: n => n.estado_notif },
        { name: 'tipo_notif', get: n => n.tipo_notif },
        { name: 'tipo_participante', get: n => n.tipo_participante },
        { name: 'obs_fallida', get: n => n.obs_fallida },
      ],
      'notificacion', nombre,
      n => `Notificación ${n.nombre || '?'} ${n.fecha_tramite || ''} [${nombre}]`,
    ))

    // ── 7. Escritos (2 campos) ──
    changes.push(...diffEntities<SnapEscrito>(
      prevCq.escritos, currCq.escritos,
      e => `${str(e.fecha_ingreso)}|${str(e.tipo_escrito)}|${str(e.solicitante)}`,
      [
        { name: 'tiene_doc', get: e => e.tiene_doc },
        { name: 'tiene_anexo', get: e => e.tiene_anexo },
      ],
      'escrito', nombre,
      e => `Escrito ${e.tipo_escrito || '?'} ${e.fecha_ingreso || ''} [${nombre}]`,
    ))

    // ── 8. Piezas exhorto (8 campos) ──
    changes.push(...diffEntities<SnapPiezaExhorto>(
      prevCq.piezas_exhorto, currCq.piezas_exhorto,
      p => String(p.numero_folio),
      [
        { name: 'cuaderno_pieza', get: p => p.cuaderno_pieza },
        { name: 'etapa', get: p => p.etapa },
        { name: 'tramite', get: p => p.tramite },
        { name: 'desc_tramite', get: p => p.desc_tramite },
        { name: 'fecha_tramite', get: p => p.fecha_tramite },
        { name: 'foja', get: p => p.foja },
        { name: 'tiene_doc', get: p => p.tiene_doc },
        { name: 'tiene_anexo', get: p => p.tiene_anexo },
      ],
      'pieza_exhorto', nombre,
      p => `Pieza exhorto folio ${p.numero_folio} [${nombre}]`,
    ))
  }

  // ── 9. Anexos causa (add/remove only — todos los campos son clave) ──
  changes.push(...diffEntities<SnapAnexoCausa>(
    prev.anexos_causa, curr.anexos_causa,
    a => `${str(a.fecha)}|${str(a.referencia)}`,
    [],
    'anexo_causa', null,
    a => `Anexo causa ${a.referencia || a.fecha || '?'}`,
  ))

  // ── 10. Receptor retiros (2 campos) ──
  changes.push(...diffEntities<SnapReceptorRetiro>(
    prev.receptor_retiros, curr.receptor_retiros,
    r => `${str(r.fecha_retiro)}|${str(r.datos_retiro)}`,
    [
      { name: 'cuaderno', get: r => r.cuaderno },
      { name: 'estado', get: r => r.estado },
    ],
    'receptor', null,
    r => `Retiro receptor ${r.datos_retiro || '?'} ${r.fecha_retiro || ''}`,
  ))

  // ── 11. Exhortos (6 campos + sub-tabla docs) ──
  changes.push(...diffExhortos(prev.exhortos, curr.exhortos))

  // ── 13. Remisiones (17 campos + sub-tablas) ──
  changes.push(...diffRemisiones(prev.remisiones, curr.remisiones))

  return changes
}

// ════════════════════════════════════════════════════════
// DIFF ESPECIALIZADO — Folios con sus anexos anidados
// ════════════════════════════════════════════════════════

function diffFolios(prev: SnapFolio[], curr: SnapFolio[], cuaderno: string): SyncChange[] {
  const changes: SyncChange[] = []
  const prevMap = new Map(prev.map(f => [f.numero_folio, f]))
  const currMap = new Map(curr.map(f => [f.numero_folio, f]))

  for (const [num, f] of currMap) {
    if (!prevMap.has(num)) {
      changes.push({
        category: 'folio', type: 'added', cuaderno,
        entity_key: String(num), field: null, old_value: null, new_value: null,
        description: `Nuevo folio ${num} en ${cuaderno}: ${f.tramite || ''} ${f.desc_tramite || ''} ${f.fecha_tramite || ''}`.trim(),
      })
    }
  }
  for (const [num] of prevMap) {
    if (!currMap.has(num)) {
      changes.push({
        category: 'folio', type: 'removed', cuaderno,
        entity_key: String(num), field: null, old_value: null, new_value: null,
        description: `Folio ${num} removido de ${cuaderno}`,
      })
    }
  }

  const folioFields: FieldSpec<SnapFolio>[] = [
    { name: 'etapa', get: f => f.etapa },
    { name: 'tramite', get: f => f.tramite },
    { name: 'desc_tramite', get: f => f.desc_tramite },
    { name: 'fecha_tramite', get: f => f.fecha_tramite },
    { name: 'foja', get: f => f.foja },
    { name: 'tiene_doc_principal', get: f => f.tiene_doc_principal },
    { name: 'tiene_certificado_escrito', get: f => f.tiene_certificado_escrito },
    { name: 'tiene_anexo_solicitud', get: f => f.tiene_anexo_solicitud },
  ]

  for (const [num, currF] of currMap) {
    const prevF = prevMap.get(num)
    if (!prevF) continue

    for (const field of folioFields) {
      const ov = str(field.get(prevF))
      const nv = str(field.get(currF))
      if (ov !== nv) {
        changes.push({
          category: 'folio', type: 'changed', cuaderno,
          entity_key: String(num), field: field.name,
          old_value: ov || null, new_value: nv || null,
          description: `Folio ${num} [${cuaderno}]: ${fieldLabel(field.name)} «${ov || '(vacío)'}» → «${nv || '(vacío)'}»`,
        })
      }
    }

    // ── 4. Folio anexos (add/remove only) ──
    changes.push(...diffEntities<SnapFolioAnexo>(
      prevF.anexos, currF.anexos,
      a => `${str(a.fecha)}|${str(a.referencia)}`,
      [],
      'folio_anexo', cuaderno,
      a => `Anexo solicitud folio ${num} [${cuaderno}]: ${a.referencia || a.fecha || '?'}`,
    ))
  }

  return changes
}

// ════════════════════════════════════════════════════════
// DIFF ESPECIALIZADO — Exhortos con docs anidados
// ════════════════════════════════════════════════════════

function diffExhortos(prev: SnapExhorto[], curr: SnapExhorto[]): SyncChange[] {
  const changes: SyncChange[] = []
  const prevMap = new Map(prev.map(e => [str(e.rol_destino), e]))
  const currMap = new Map(curr.map(e => [str(e.rol_destino), e]))

  for (const [key, e] of currMap) {
    if (!prevMap.has(key)) {
      changes.push({
        category: 'exhorto', type: 'added', cuaderno: null,
        entity_key: key, field: null, old_value: null, new_value: null,
        description: `Nuevo exhorto: ${e.rol_destino || '?'} → ${e.tribunal_destino || '?'}`,
      })
    }
  }
  for (const [key] of prevMap) {
    if (!currMap.has(key)) {
      changes.push({
        category: 'exhorto', type: 'removed', cuaderno: null,
        entity_key: key, field: null, old_value: null, new_value: null,
        description: `Exhorto removido: ${key}`,
      })
    }
  }

  const exhortoFields: FieldSpec<SnapExhorto>[] = [
    { name: 'rol_origen', get: e => e.rol_origen },
    { name: 'tipo_exhorto', get: e => e.tipo_exhorto },
    { name: 'fecha_ordena', get: e => e.fecha_ordena },
    { name: 'fecha_ingreso', get: e => e.fecha_ingreso },
    { name: 'tribunal_destino', get: e => e.tribunal_destino },
    { name: 'estado_exhorto', get: e => e.estado_exhorto },
  ]

  for (const [key, currE] of currMap) {
    const prevE = prevMap.get(key)
    if (!prevE) continue

    for (const field of exhortoFields) {
      const ov = str(field.get(prevE))
      const nv = str(field.get(currE))
      if (ov !== nv) {
        changes.push({
          category: 'exhorto', type: 'changed', cuaderno: null,
          entity_key: key, field: field.name,
          old_value: ov || null, new_value: nv || null,
          description: `Exhorto ${key}: ${fieldLabel(field.name)} «${ov || '(vacío)'}» → «${nv || '(vacío)'}»`,
        })
      }
    }

    // ── 12. Exhorto docs (add/remove only) ──
    changes.push(...diffEntities<SnapExhortoDoc>(
      prevE.docs, currE.docs,
      d => `${str(d.fecha)}|${str(d.referencia)}|${str(d.tramite)}`,
      [],
      'exhorto_doc', null,
      d => `Doc. exhorto ${key}: ${d.referencia || d.tramite || d.fecha || '?'}`,
    ))
  }

  return changes
}

// ════════════════════════════════════════════════════════
// DIFF ESPECIALIZADO — Remisiones con todas sus sub-tablas
// ════════════════════════════════════════════════════════

function diffRemisiones(prev: SnapRemision[], curr: SnapRemision[]): SyncChange[] {
  const changes: SyncChange[] = []
  const keyFn = (r: SnapRemision) => `${str(r.descripcion_tramite)}|${str(r.fecha_tramite)}`
  const prevMap = new Map(prev.map(r => [keyFn(r), r]))
  const currMap = new Map(curr.map(r => [keyFn(r), r]))

  for (const [key, r] of currMap) {
    if (!prevMap.has(key)) {
      changes.push({
        category: 'remision', type: 'added', cuaderno: null,
        entity_key: key, field: null, old_value: null, new_value: null,
        description: `Nueva remisión: ${r.descripcion_tramite || '?'} ${r.fecha_tramite || ''}`,
      })
    }
  }
  for (const [key, r] of prevMap) {
    if (!currMap.has(key)) {
      changes.push({
        category: 'remision', type: 'removed', cuaderno: null,
        entity_key: key, field: null, old_value: null, new_value: null,
        description: `Remisión removida: ${r.descripcion_tramite || '?'} ${r.fecha_tramite || ''}`,
      })
    }
  }

  const remFields: FieldSpec<SnapRemision>[] = [
    { name: 'libro', get: r => r.libro },
    { name: 'fecha', get: r => r.fecha },
    { name: 'estado_recurso', get: r => r.estado_recurso },
    { name: 'estado_procesal', get: r => r.estado_procesal },
    { name: 'ubicacion', get: r => r.ubicacion },
    { name: 'recurso', get: r => r.recurso },
    { name: 'corte', get: r => r.corte },
    { name: 'tiene_certificado', get: r => r.tiene_certificado },
    { name: 'tiene_ebook', get: r => r.tiene_ebook },
    { name: 'tiene_texto', get: r => r.tiene_texto },
    { name: 'tiene_anexo', get: r => r.tiene_anexo },
    { name: 'exp_causa_origen', get: r => r.exp_causa_origen },
    { name: 'exp_tribunal', get: r => r.exp_tribunal },
    { name: 'exp_caratulado', get: r => r.exp_caratulado },
    { name: 'exp_materia', get: r => r.exp_materia },
    { name: 'exp_ruc', get: r => r.exp_ruc },
    { name: 'exp_fecha_ingreso', get: r => r.exp_fecha_ingreso },
  ]

  for (const [key, currR] of currMap) {
    const prevR = prevMap.get(key)
    if (!prevR) continue
    const label = currR.descripcion_tramite || currR.libro || '?'

    for (const field of remFields) {
      const ov = str(field.get(prevR))
      const nv = str(field.get(currR))
      if (ov !== nv) {
        changes.push({
          category: 'remision', type: 'changed', cuaderno: null,
          entity_key: key, field: field.name,
          old_value: ov || null, new_value: nv || null,
          description: `Remisión ${label}: ${fieldLabel(field.name)} «${ov || '(vacío)'}» → «${nv || '(vacío)'}»`,
        })
      }
    }

    // ── 14. Movimientos (9 campos + anexos anidados) ──
    changes.push(...diffRemMovimientos(prevR.movimientos, currR.movimientos, label))

    // ── 16. Litigantes remisión (2 campos) ──
    changes.push(...diffEntities<SnapRemisionLitigante>(
      prevR.litigantes, currR.litigantes,
      l => `${str(l.rut)}|${str(l.sujeto)}`,
      [
        { name: 'persona', get: l => l.persona },
        { name: 'nombre_razon_social', get: l => l.nombre_razon_social },
      ],
      'remision_litigante', null,
      l => `Litigante apelación ${l.nombre_razon_social || l.rut || '?'} [${label}]`,
    ))

    // ── 17. Exhortos remisión (add/remove only) ──
    changes.push(...diffEntities<{ exhorto: string | null }>(
      prevR.exhortos, currR.exhortos,
      e => str(e.exhorto),
      [],
      'remision_exhorto', null,
      e => `Exhorto apelación [${label}]: ${e.exhorto || '?'}`,
    ))

    // ── 18. Incompetencias remisión (add/remove only) ──
    changes.push(...diffEntities<{ incompetencia: string | null }>(
      prevR.incompetencias, currR.incompetencias,
      i => str(i.incompetencia),
      [],
      'remision_incompetencia', null,
      i => `Incompetencia apelación [${label}]: ${i.incompetencia || '?'}`,
    ))
  }

  return changes
}

function diffRemMovimientos(
  prev: SnapRemisionMovimiento[],
  curr: SnapRemisionMovimiento[],
  remLabel: string,
): SyncChange[] {
  const changes: SyncChange[] = []
  const prevMap = new Map(prev.map(m => [m.numero_folio, m]))
  const currMap = new Map(curr.map(m => [m.numero_folio, m]))

  for (const [num, m] of currMap) {
    if (!prevMap.has(num)) {
      changes.push({
        category: 'remision_movimiento', type: 'added', cuaderno: null,
        entity_key: `${remLabel}|f${num}`, field: null, old_value: null, new_value: null,
        description: `Nuevo movimiento folio ${num} [${remLabel}]: ${m.tramite || ''} ${m.descripcion || ''}`.trim(),
      })
    }
  }
  for (const [num] of prevMap) {
    if (!currMap.has(num)) {
      changes.push({
        category: 'remision_movimiento', type: 'removed', cuaderno: null,
        entity_key: `${remLabel}|f${num}`, field: null, old_value: null, new_value: null,
        description: `Movimiento folio ${num} removido [${remLabel}]`,
      })
    }
  }

  const movFields: FieldSpec<SnapRemisionMovimiento>[] = [
    { name: 'tramite', get: m => m.tramite },
    { name: 'descripcion', get: m => m.descripcion },
    { name: 'nomenclaturas', get: m => m.nomenclaturas },
    { name: 'fecha', get: m => m.fecha },
    { name: 'sala', get: m => m.sala },
    { name: 'estado', get: m => m.estado },
    { name: 'tiene_doc', get: m => m.tiene_doc },
    { name: 'tiene_certificado_escrito', get: m => m.tiene_certificado_escrito },
    { name: 'tiene_anexo_escrito', get: m => m.tiene_anexo_escrito },
  ]

  for (const [num, currM] of currMap) {
    const prevM = prevMap.get(num)
    if (!prevM) continue

    for (const field of movFields) {
      const ov = str(field.get(prevM))
      const nv = str(field.get(currM))
      if (ov !== nv) {
        changes.push({
          category: 'remision_movimiento', type: 'changed', cuaderno: null,
          entity_key: `${remLabel}|f${num}`, field: field.name,
          old_value: ov || null, new_value: nv || null,
          description: `Movimiento folio ${num} [${remLabel}]: ${fieldLabel(field.name)} «${ov || '(vacío)'}» → «${nv || '(vacío)'}»`,
        })
      }
    }

    // ── 15. Anexos movimiento (2 campos) ──
    changes.push(...diffEntities<SnapRemisionMovAnexo>(
      prevM.anexos, currM.anexos,
      a => `${str(a.codigo)}|${str(a.tipo_documento)}`,
      [
        { name: 'cantidad', get: a => a.cantidad },
        { name: 'observacion', get: a => a.observacion },
      ],
      'remision_mov_anexo', null,
      a => `Anexo mov. folio ${num} [${remLabel}]: ${a.tipo_documento || a.codigo || '?'}`,
    ))
  }

  return changes
}

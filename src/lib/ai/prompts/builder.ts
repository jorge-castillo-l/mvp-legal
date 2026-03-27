/**
 * ============================================================
 * Prompt Builder — Tarea 3.04
 * ============================================================
 * Ensambla el system prompt final a partir de:
 *   1. Base legal común (terminología, reglas, formato)
 *   2. Procedimiento específico (estructura, plazos, artículos)
 *   3. Instrucciones de proveedor (Gemini vs Claude)
 *   4. Contexto de la causa (ROL, tribunal)
 *
 * Uso:
 *   const prompt = buildSystemPrompt({
 *     procedimiento: 'ejecutivo',
 *     mode: 'fast_chat',
 *     rol: 'C-1234-2025',
 *     tribunal: '1er Juzgado Civil de Santiago',
 *   })
 * ============================================================
 */

import type { AIMode } from '../types'
import {
  BASE_ROLE,
  BASE_RULES,
  TERMINOLOGY,
  DEADLINE_RULES,
  CITATION_FORMAT,
} from './base'
import { getProviderInstructions, MANDATORY_WEB_SEARCH_INSTRUCTION } from './provider-instructions'
import { ORDINARIO_PROMPT } from './procedures/ordinario'
import { EJECUTIVO_PROMPT } from './procedures/ejecutivo'
import { SUMARIO_PROMPT } from './procedures/sumario'
import { MONITORIO_PROMPT } from './procedures/monitorio'
import { VOLUNTARIO_PROMPT } from './procedures/voluntario'
import { GENERICO_PROMPT } from './procedures/generico'

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export type Procedimiento =
  | 'ordinario'
  | 'ejecutivo'
  | 'sumario'
  | 'monitorio'
  | 'voluntario'

export interface BuildSystemPromptOptions {
  procedimiento?: Procedimiento | string | null
  mode: AIMode
  rol?: string | null
  tribunal?: string | null
  isExplicitWebSearch?: boolean
  /** Extra prompt injected after procedure block (e.g. deadline analysis 3.13) */
  specializedPrompt?: string
}

// ─────────────────────────────────────────────────────────────
// Procedure resolution
// ─────────────────────────────────────────────────────────────

const PROCEDURE_PROMPTS: Record<string, string> = {
  ordinario: ORDINARIO_PROMPT,
  ejecutivo: EJECUTIVO_PROMPT,
  sumario: SUMARIO_PROMPT,
  monitorio: MONITORIO_PROMPT,
  voluntario: VOLUNTARIO_PROMPT,
}

function getProcedurePrompt(procedimiento?: string | null): string {
  if (!procedimiento) return GENERICO_PROMPT
  return PROCEDURE_PROMPTS[procedimiento] ?? GENERICO_PROMPT
}

// ─────────────────────────────────────────────────────────────
// Context block
// ─────────────────────────────────────────────────────────────

function buildCaseContext(options: BuildSystemPromptOptions): string {
  const parts: string[] = []
  if (options.rol) parts.push(`ROL: ${options.rol}`)
  if (options.tribunal) parts.push(`Tribunal: ${options.tribunal}`)
  if (options.procedimiento) {
    parts.push(`Procedimiento: ${options.procedimiento}`)
  }

  if (parts.length === 0) return ''
  return `\nCONTEXTO DE LA CAUSA:\n${parts.join('\n')}\n`
}

// ─────────────────────────────────────────────────────────────
// Main builder
// ─────────────────────────────────────────────────────────────

/**
 * Builds the complete system prompt by composing:
 *   base (role + rules + terminology + deadlines + citation format)
 * + procedure-specific block
 * + provider-specific instructions
 * + case context
 *
 * The resulting string is passed directly to AIRequestOptions.systemPrompt.
 */
export function buildSystemPrompt(options: BuildSystemPromptOptions): string {
  const sections = [
    BASE_ROLE,
    options.isExplicitWebSearch ? MANDATORY_WEB_SEARCH_INSTRUCTION : '',
    buildCaseContext(options),
    BASE_RULES,
    TERMINOLOGY,
    DEADLINE_RULES,
    CITATION_FORMAT,
    getProcedurePrompt(options.procedimiento),
    options.specializedPrompt ?? '',
    getProviderInstructions(options.mode),
  ]

  return sections.filter(Boolean).join('\n')
}

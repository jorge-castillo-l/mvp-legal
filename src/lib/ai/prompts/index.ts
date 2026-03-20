/**
 * ============================================================
 * Prompts Module — Public API (Tarea 3.04)
 * ============================================================
 * Barrel export. Uso:
 *
 *   import { buildSystemPrompt } from '@/lib/ai/prompts'
 *
 *   const prompt = buildSystemPrompt({
 *     procedimiento: cases.procedimiento,
 *     mode: 'fast_chat',
 *     rol: cases.rol,
 *     tribunal: cases.tribunal,
 *   })
 * ============================================================
 */

export { buildSystemPrompt } from './builder'
export type { Procedimiento, BuildSystemPromptOptions } from './builder'

export { ORDINARIO_PROMPT } from './procedures/ordinario'
export { EJECUTIVO_PROMPT } from './procedures/ejecutivo'
export { SUMARIO_PROMPT } from './procedures/sumario'
export { MONITORIO_PROMPT } from './procedures/monitorio'
export { VOLUNTARIO_PROMPT } from './procedures/voluntario'
export { GENERICO_PROMPT } from './procedures/generico'

export {
  BASE_ROLE,
  BASE_RULES,
  TERMINOLOGY,
  DEADLINE_RULES,
  CITATION_FORMAT,
} from './base'

export { getProviderInstructions } from './provider-instructions'

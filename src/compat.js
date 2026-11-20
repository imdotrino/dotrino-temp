/**
 * QUÉ VERSIÓN SOY Y SI PODEMOS HABLAR (CONVENCIONES §14).
 *
 * Cada mensaje lleva la declaración de quien lo manda, y quien lo recibe la juzga. No
 * bloquea: si alguien habla otra versión, se avisa en el canal y el mensaje se enseña
 * igual.
 *
 * Protocolo 1: `{ t: 'tmp', v, id, text }` (un mensaje) y `{ t: 'tmp-who', v, nick, proof }`
 * (presentarse: apodo y firma de la cuenta), los dos sellados por el transporte.
 */
import { declare, check } from '@dotrino/compat'

/* global __APP_VERSION__ */
export const MINE = declare({
  product: 'temp',
  version: __APP_VERSION__,
  protocol: 1,
  speaks: [1],
})

/**
 * Versiones publicadas que se saben rotas. Solo versiones exactas, nunca rangos.
 * @type {import('@dotrino/compat').BrokenEntry[]}
 */
const BROKEN = []

/**
 * @param {unknown} theirs
 * @returns {boolean} true si podemos hablar
 */
export function compatible (theirs) {
  if (!theirs) return false
  try {
    return check({ mine: MINE, theirs, broken: BROKEN }).compatible
  } catch (e) {
    console.warn('[temp] unreadable version declaration:', /** @type {Error} */ (e).message)
    return false
  }
}

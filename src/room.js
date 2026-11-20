/**
 * Un canal de Temp sobre el pilar de transporte (@dotrino/proxy-client).
 *
 * SIN CUENTA Y SIN NADA GUARDADO. Cada pestaña inventa al abrir dos llaves que viven solo
 * en memoria: una de firma (el proxio la pide para publicarse en un canal e identificarse)
 * y una de cifrado (para sellar). Al cerrar la pestaña desaparecen; volver a entrar es ser
 * otro. No se toca la bóveda ni el store, y no se escribe nada en el navegador.
 *
 * TODO VA SELLADO (§4.1). El proxio enruta pero no lee: cada mensaje sale sellado a la
 * llave de cifrado de cada persona del canal (`requireSealed`), así que el operador del
 * proxio ve que hay tráfico, no qué dice. El canal público solo es la lista de quién está.
 *
 * NADA SE REENVÍA. El proxio no guarda mensajes por token, y aquí no hay historial: quien
 * entra ve lo que se escriba desde ese momento.
 */
import {
  WebSocketProxyClient, setKeypairStore, getPublicKeyJwk, signData, makeEncKeypair,
} from '@dotrino/proxy-client'
import { MINE, compatible } from './compat.js'

export const TTL_MS = 60_000
export const MAX_TEXT = 500
// El proxio olvida a un miembro del canal a los 20 minutos: se vuelve a publicar antes.
const REPUBLISH_MS = 10 * 60_000
// Red de seguridad del contador: los eventos joined/left lo llevan en tiempo real, y esto
// corrige lo que se haya perdido en una reconexión.
const RELIST_MS = 30_000
const CHANNEL_PREFIX = 'temp_'

/** @param {string} raw */
export function normalizeChannel (raw) {
  const c = (raw || '').trim().toLowerCase()
  return /^[a-z0-9]{1,3}$/.test(c) ? c : null
}

// Las llaves de firma, solo en memoria. Sin esto el pilar las guardaría en localStorage
// y la misma pestaña sería reconocible al volver.
/** @type {any} */
let memoryPair = null
setKeypairStore({ get: () => memoryPair, set: (/** @type {any} */ p) => { memoryPair = p } })

/**
 * @typedef {{ id: string, text: string, from: string, mine: boolean, at: number }} Msg
 * @typedef {{
 *   onMessage: (m: Msg) => void,
 *   onCount: (n: number) => void,
 *   onStatus: (s: 'connecting'|'online'|'offline'|'error') => void,
 *   onNotice: (k: 'notDelivered'|'oldVersion', n?: number) => void,
 *   onDelivered: (id: string) => void,
 * }} Handlers
 */

/**
 * @param {string} name canal ya normalizado
 * @param {Handlers} h
 */
export async function joinRoom (name, h) {
  /** Mis mensajes vivos: a quién le llegó cada uno. @type {Map<string, { text: string, recipients: Set<string>, timer: ReturnType<typeof setTimeout> }>} */
  const sent = new Map()
  const newMember = () => Object.assign(new Error('someone joined'), { code: 'new-member' })
  /** @param {string} id */
  const expireLater = (id) => {
    const e = sent.get(id)
    if (!e) return
    clearTimeout(e.timer)
    e.timer = setTimeout(() => sent.delete(id), TTL_MS)
  }
  /** @type {WebSocketProxyClient} */
  let client
  const channel = CHANNEL_PREFIX + name
  const enc = await makeEncKeypair()
  const publickey = await getPublicKeyJwk()
  client = new WebSocketProxyClient({
    requireSealed: true,
    myEncPub: enc.encPub,
    myEncPrivateKey: enc.privateKey,
    maxReconnectAttempts: Infinity,
  })

  /** @type {Set<string>} */
  const members = new Set()
  const emitCount = () => h.onCount(members.size)
  let warnedVersion = false
  /** @type {ReturnType<typeof setInterval>[]} */
  const timers = []

  const refresh = async () => {
    const tokens = await client.list(channel)
    members.clear()
    for (const tk of tokens) members.add(tk)
    if (client.token) members.add(client.token)
    emitCount()
    const others = [...members].filter((tk) => tk !== client.token && !client.pubkeyOfToken(tk))
    if (others.length) client.helloTo(others)
  }

  // Cada conexión (la primera y cada reconexión) trae un token nuevo: hay que volver a
  // identificarse y a publicarse, o el canal deja de vernos.
  const enter = async () => {
    try {
      h.onStatus('connecting')
      await client.identifyAs({ publickey, sign: signData })
      await client.publish(channel)
      await refresh()
      h.onStatus('online')
    } catch (e) {
      console.error('[temp] join failed:', /** @type {any} */ (e)?.code || /** @type {Error} */ (e).message)
      h.onStatus('error')
    }
  }

  client.on('token', () => { client.forgetToken(); enter() })
  client.on('disconnect', () => h.onStatus('offline'))
  client.on('channel_joined', (ch, tk) => {
    if (ch !== channel || !tk) return
    members.add(tk)
    emitCount()
  })
  const gone = (/** @type {string} */ tk, /** @type {string|null} */ ch) => {
    if (ch && ch !== channel) return
    if (!members.delete(tk)) return
    client.forgetToken(tk)
    emitCount()
  }
  client.on('channel_left', (ch, tk) => gone(tk, ch))
  client.on('peer_disconnected', (tk, ch) => gone(tk, ch))
  client.on('error', (e) => console.warn('[temp] transport:', e?.code || e?.type || e?.error))

  client.on('message', (from, payload, meta) => {
    // El pilar es el único que abre el sobre; aquí solo se comprueba que venía sellado.
    if (!meta?.sealed) return
    const m = typeof payload === 'string' ? safeParse(payload) : payload
    if (!m || m.t !== 'tmp' || typeof m.text !== 'string' || typeof m.id !== 'string') return
    if (!compatible(m.v) && !warnedVersion) { warnedVersion = true; h.onNotice('oldVersion') }
    h.onMessage({ id: m.id, text: m.text.slice(0, MAX_TEXT), from, mine: false, at: Date.now() })
  })

  const logFail = (/** @type {string} */ what) => (/** @type {any} */ e) =>
    console.warn(`[temp] ${what} failed:`, e?.code || e?.message)
  /**
   * Manda un mensaje mío a todos los conectados de ahora y apunta a quién le llegó.
   * @param {string} id
   */
  const deliver = async (id) => {
    const e = sent.get(id)
    if (!e) return
    const payload = { t: 'tmp', v: MINE, id, text: e.text }
    const others = [...members].filter((tk) => tk !== client.token)
    const results = await Promise.allSettled(others.map(async (tk) => {
      const peerPubkey = client.pubkeyOfToken(tk) || await client.whoIs(tk, 5000)
      if (!peerPubkey) throw Object.assign(new Error('no identity'), { code: 'no-peer-identity' })
      await client.sendSealedTo(tk, payload, { peerPubkey })
      e.recipients.add(tk)
    }))
    const failed = results.filter((r) => r.status === 'rejected')
    for (const f of failed) console.warn('[temp] not delivered:', /** @type {any} */ (f).reason?.code || /** @type {any} */ (f).reason?.message)
    if (failed.length) h.onNotice('notDelivered', failed.length)
    h.onDelivered(id)
  }

  timers.push(setInterval(() => { if (client.token) client.publish(channel).catch(logFail('republish')) }, REPUBLISH_MS))
  timers.push(setInterval(() => { if (client.token) refresh().catch(logFail('relist')) }, RELIST_MS))

  h.onStatus('connecting')
  await client.connect()

  return {
    /**
     * @param {string} text
     * @param {number} seen cuántos conectados ha visto el usuario. Si ahora hay más, no
     *   sale nada: lo que se escribió era para los que había.
     */
    async send (text, seen) {
      const clean = text.trim().slice(0, MAX_TEXT)
      if (!clean) return
      if (members.size > seen) throw newMember()
      const id = crypto.randomUUID()
      h.onMessage({ id, text: clean, from: client.token || '', mine: true, at: Date.now() })
      const entry = { text: clean, recipients: new Set(), timer: setTimeout(() => {}, 0) }
      sent.set(id, entry)
      expireLater(id)
      await deliver(id)
    },

    /**
     * Cuántos de los conectados de ahora no tienen este mensaje mío (entraron después, o
     * no les llegó). 0 si el mensaje ya caducó.
     * @param {string} id
     */
    missing (id) {
      const e = sent.get(id)
      if (!e) return 0
      return [...members].filter((tk) => tk !== client.token && !e.recipients.has(tk)).length
    },

    /**
     * REENVIAR a los que no lo tienen. Sale a todos los de ahora con el mismo id: quien ya
     * lo tenía no lo ve dos veces, solo se le reinicia el reloj. Los 60 segundos vuelven a
     * empezar para todos, también para mi copia.
     * @param {string} id
     * @param {number} seen cuántos conectados ha visto el usuario
     */
    async resend (id, seen) {
      if (!sent.has(id)) return
      if (members.size > seen) throw newMember()
      expireLater(id)
      await deliver(id)
    },
    leave () {
      for (const tm of timers) clearInterval(tm)
      client.unpublish(channel).catch(logFail('unpublish'))
      client.close()
    },
  }
}

/** @param {string} s */
function safeParse (s) {
  try { return JSON.parse(s) } catch { return null }
}

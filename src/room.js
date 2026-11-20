/**
 * Un canal de Temp sobre el pilar de transporte (@dotrino/proxy-client).
 *
 * CON TU CUENTA DE DOTRINO, SIN REGISTRO. La cuenta se crea sola la primera vez que abres
 * una app del ecosistema. La pestaña se identifica en el proxio con la llave de la bóveda,
 * y a cada persona del canal se le presenta con una firma atada a los dos tokens
 * (`from`, `to`) y al canal: quien la recibe la comprueba con `verifySignedBy`, que dice
 * de qué cuenta es sin guardar a nadie en la libreta. Así cada uno ve quién está, no solo
 * cuántos.
 *
 * TODO VA SELLADO (§4.1). El proxio enruta pero no lee: cada mensaje sale sellado a la
 * llave de cifrado de cada persona del canal (`requireSealed`), así que el operador del
 * proxio ve que hay tráfico, no qué dice. El canal público solo es la lista de quién está.
 *
 * NADA SE REENVÍA NI SE GUARDA. El proxio no guarda mensajes por token, y aquí no hay
 * historial: quien entra ve lo que se escriba desde ese momento.
 */
import { WebSocketProxyClient, makeEncKeypair, setKeypairStore } from '@dotrino/proxy-client'
import { verifySignedBy } from '@dotrino/identity/acta'
import { keyLabel } from '@dotrino/identity/keyid'
import { MINE, compatible } from './compat.js'

export const TTL_MS = 60_000
export const MAX_TEXT = 500
// El proxio olvida a un miembro del canal a los 20 minutos: se vuelve a publicar antes.
const REPUBLISH_MS = 10 * 60_000
// Red de seguridad del contador: los eventos joined/left lo llevan en tiempo real, y esto
// corrige lo que se haya perdido en una reconexión.
const RELIST_MS = 30_000
const CHANNEL_PREFIX = 'temp_'

// El pilar se hace además una llave propia de transporte y la guardaría en localStorage.
// Aquí vive solo en memoria: Temp no escribe nada en el navegador.
/** @type {any} */
let memoryPair = null
setKeypairStore({ get: () => memoryPair, set: (/** @type {any} */ p) => { memoryPair = p } })

/** @param {string} raw */
export function normalizeChannel (raw) {
  const c = (raw || '').trim().toLowerCase()
  return /^[a-z0-9]{1,3}$/.test(c) ? c : null
}

/**
 * @typedef {{ id: string, text: string, from: string, mine: boolean, at: number }} Msg
 * @typedef {{ token: string, me: boolean, nick: string, label: string, verified: boolean }} Person
 * @typedef {{
 *   onMessage: (m: Msg) => void,
 *   onMembers: (people: Person[]) => void,
 *   onJoin: (p: Person) => void,
 *   onLeave: (p: Person) => void,
 *   onPeer: (p: Person) => void,
 *   onStatus: (s: 'connecting'|'online'|'offline'|'error') => void,
 *   onNotice: (k: 'notDelivered'|'oldVersion', n?: number) => void,
 *   onDelivered: (id: string) => void,
 * }} Handlers
 */

/**
 * @param {string} name canal ya normalizado
 * @param {import('@dotrino/identity').Identity} identity la cuenta de Dotrino de esta pestaña
 * @param {Handlers} h
 */
export async function joinRoom (name, identity, h) {
  /** Mis mensajes vivos: a quién le llegó cada uno. @type {Map<string, { text: string, recipients: Set<string>, timer: ReturnType<typeof setTimeout> }>} */
  const sent = new Map()
  const newMember = () => Object.assign(new Error('someone joined'), { code: 'new-member' })
  /** ¿Hay alguien que el usuario no ha visto? @param {Set<string>} seen */
  const unseen = (seen) => [...members.keys()].some((tk) => !seen.has(tk))
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
  const publickey = identity.me?.publickey
  if (!publickey) throw Object.assign(new Error('the vault did not give a public key'), { code: 'no-identity' })
  const myNick = (identity.me?.nickname || '').slice(0, 40)
  // Mi cuenta, por la misma vía que los demás la verán: la firma dice a nombre de quién va.
  const self = await identity.signData({ app: 'temp', op: 'self', ch: name })
  const myLabel = await keyLabel(self.profileId)
  client = new WebSocketProxyClient({
    requireSealed: true,
    myEncPub: enc.encPub,
    myEncPrivateKey: enc.privateKey,
    maxReconnectAttempts: Infinity,
  })

  /** Quién está: token → lo que se sabe de él. @type {Map<string, Person>} */
  const members = new Map()
  /** A quién ya me presenté en esta conexión. @type {Set<string>} */
  const introduced = new Set()
  const people = () => [...members.values()]
  const emitMembers = () => h.onMembers(people())
  let warnedVersion = false
  /** @type {ReturnType<typeof setInterval>[]} */
  const timers = []

  /** @param {string} tk */
  const unknown = (tk) => ({ token: tk, me: tk === client.token, nick: tk === client.token ? myNick : '', label: tk === client.token ? myLabel : '', verified: tk === client.token })

  /** @param {string} tk */
  const joined = (tk) => {
    if (members.has(tk)) return
    const p = unknown(tk)
    members.set(tk, p)
    if (!p.me) { h.onJoin(p); introduce(tk) }
  }
  /** @param {string} tk */
  const gone = (tk) => {
    const p = members.get(tk)
    if (!p) return
    members.delete(tk)
    introduced.delete(tk)
    client.forgetToken(tk)
    if (!p.me) h.onLeave(p)
    emitMembers()
  }

  /**
   * PRESENTARME a uno: mi apodo y una firma de mi cuenta sobre `{canal, mi token, su token}`.
   * Atada a los dos tokens, no sirve para que otro se haga pasar por mí: un token muere con
   * su conexión y no se recicla.
   * @param {string} tk
   */
  const introduce = async (tk) => {
    if (tk === client.token || introduced.has(tk) || !client.token) return
    introduced.add(tk)
    try {
      const proof = await identity.signData({ app: 'temp', ch: channel, from: client.token, to: tk })
      const peerPubkey = client.pubkeyOfToken(tk) || await client.whoIs(tk, 5000)
      if (!peerPubkey) throw Object.assign(new Error('no identity'), { code: 'no-peer-identity' })
      await client.sendSealedTo(tk, {
        t: 'tmp-who', v: MINE, nick: myNick,
        proof: { signature: proof.signature, publickey: proof.publickey, chain: proof.chain },
      }, { peerPubkey })
    } catch (e) {
      introduced.delete(tk)
      console.warn('[temp] introduce failed:', /** @type {any} */ (e)?.code || /** @type {Error} */ (e)?.message)
    }
  }

  /**
   * Comprobar la presentación de otro. Si la firma no es de una cuenta, o no va atada a SU
   * token y al MÍO, se queda como «sin verificar»: no se le pone nombre.
   * @param {string} from @param {any} m
   */
  const recognize = async (from, m) => {
    const p = members.get(from)
    if (!p || !m.proof || typeof m.proof.signature !== 'string') return
    const r = await verifySignedBy({
      data: { app: 'temp', ch: channel, from, to: client.token },
      signature: m.proof.signature, publickey: m.proof.publickey, chain: m.proof.chain,
    })
    if (!r.ok || !r.profileId) {
      console.warn('[temp] presentation rejected:', r.reason)
      return
    }
    p.label = await keyLabel(r.profileId)
    p.nick = typeof m.nick === 'string' ? m.nick.slice(0, 40) : ''
    p.verified = true
    h.onPeer(p)
    emitMembers()
    // Quien se presenta primero espera la mía: la de vuelta sale si todavía no salió.
    introduce(from)
  }

  // Lista entera del canal: corrige lo que se haya perdido en una reconexión. Lo que
  // falta es una salida y lo nuevo una entrada, con su línea en el chat.
  const refresh = async () => {
    const tokens = new Set(await client.list(channel))
    if (client.token) tokens.add(client.token)
    for (const tk of [...members.keys()]) if (!tokens.has(tk)) gone(tk)
    const others = [...tokens].filter((tk) => tk !== client.token && !client.pubkeyOfToken(tk))
    if (others.length) client.helloTo(others)
    for (const tk of tokens) joined(tk)
    for (const tk of tokens) introduce(tk)
    emitMembers()
  }

  // Cada conexión (la primera y cada reconexión) trae un token nuevo: hay que volver a
  // identificarse y a publicarse, o el canal deja de vernos.
  const enter = async () => {
    try {
      h.onStatus('connecting')
      await client.identifyAs({ publickey, sign: (/** @type {any} */ d) => identity.signData(d) })
      await client.publish(channel)
      await refresh()
      h.onStatus('online')
    } catch (e) {
      console.error('[temp] join failed:', /** @type {any} */ (e)?.code || /** @type {Error} */ (e).message)
      h.onStatus('error')
    }
  }

  client.on('token', () => {
    // Token nuevo = otra conexión: mis presentaciones iban atadas al token viejo, así que
    // hay que hacerlas otra vez. La lista se corrige sola en `refresh` (el token viejo sale).
    client.forgetToken()
    introduced.clear()
    enter()
  })
  client.on('disconnect', () => h.onStatus('offline'))
  client.on('channel_joined', (ch, tk) => {
    if (ch !== channel || !tk) return
    joined(tk)
    emitMembers()
  })
  client.on('channel_left', (ch, tk) => { if (ch === channel) gone(tk) })
  client.on('peer_disconnected', (tk, ch) => { if (!ch || ch === channel) gone(tk) })
  client.on('error', (e) => console.warn('[temp] transport:', e?.code || e?.type || e?.error))

  client.on('message', (from, payload, meta) => {
    // El pilar es el único que abre el sobre; aquí solo se comprueba que venía sellado.
    if (!meta?.sealed) return
    const m = typeof payload === 'string' ? safeParse(payload) : payload
    if (!m) return
    if (m.t === 'tmp-who') { recognize(from, m).catch(logFail('recognize')); return }
    if (m.t !== 'tmp' || typeof m.text !== 'string' || typeof m.id !== 'string') return
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
    const others = [...members.keys()].filter((tk) => tk !== client.token)
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
     * @param {Set<string>} seen los tokens que el usuario ha visto. Si ahora hay alguien
     *   más, no sale nada: lo que se escribió era para los que había.
     */
    async send (text, seen) {
      const clean = text.trim().slice(0, MAX_TEXT)
      if (!clean) return
      if (unseen(seen)) throw newMember()
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
      return [...members.keys()].filter((tk) => tk !== client.token && !e.recipients.has(tk)).length
    },

    /**
     * REENVIAR a los que no lo tienen. Sale a todos los de ahora con el mismo id: quien ya
     * lo tenía no lo ve dos veces, solo se le reinicia el reloj. Los 60 segundos vuelven a
     * empezar para todos, también para mi copia.
     * @param {string} id
     * @param {Set<string>} seen los tokens que el usuario ha visto
     */
    async resend (id, seen) {
      if (!sent.has(id)) return
      if (unseen(seen)) throw newMember()
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

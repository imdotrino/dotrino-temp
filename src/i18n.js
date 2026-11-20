// Textos es/en. El idioma lo manda el <dotrino-topbar> (§5): su toggle guarda la
// elección en 'dotrino.lang', la clave compartida del ecosistema, y avisa con el
// evento `dotrino-lang`. Aquí solo se lee y se sigue.

const STRINGS = {
  es: {
    channelLabel: 'Canal',
    channelPlaceholder: 'abc',
    enter: 'Entrar',
    random: 'Al azar',
    invalid: 'El canal tiene de 1 a 3 letras o números.',
    homeHint: 'Hasta 3 letras o números. Cada mensaje se borra a los 60 segundos.',
    connecting: 'Conectando…',
    offline: 'Sin conexión. Reintentando…',
    online: (n) => (n === 1 ? '1 conectado' : `${n} conectados`),
    composer: 'Escribe un mensaje',
    send: 'Enviar',
    empty: 'Nada por aquí. Lo que se escriba dura 60 segundos.',
    otherChannel: 'Otro canal',
    notDelivered: (n) => (n === 1 ? 'No le llegó a 1 persona.' : `No les llegó a ${n} personas.`),
    oldVersion: 'Alguien en el canal usa otra versión de Efimeral; puede que no se lean bien.',
    error: 'No se pudo conectar.',
    joinedAlert: (n) => `Entró alguien. Ahora hay ${n} conectados. Revisa antes de enviar.`,
    ack: 'Entendido',
    joinedLine: (n) => `Entró alguien · ${n} conectados`,
    leftLine: (n) => (n === 1 ? 'Salió alguien · solo tú' : `Salió alguien · ${n} conectados`),
    copy: 'Copiar',
    copyFailed: 'No se pudo copiar.',
  },
  en: {
    channelLabel: 'Channel',
    channelPlaceholder: 'abc',
    enter: 'Join',
    random: 'Random',
    invalid: 'A channel is 1 to 3 letters or digits.',
    homeHint: 'Up to 3 letters or digits. Every message is deleted after 60 seconds.',
    connecting: 'Connecting…',
    offline: 'Offline. Retrying…',
    online: (n) => (n === 1 ? '1 online' : `${n} online`),
    composer: 'Write a message',
    send: 'Send',
    empty: 'Nothing here. Whatever is written lasts 60 seconds.',
    otherChannel: 'Another channel',
    notDelivered: (n) => (n === 1 ? '1 person did not get it.' : `${n} people did not get it.`),
    oldVersion: 'Someone in this channel runs another version of Efimeral; you may not read each other well.',
    error: 'Could not connect.',
    joinedAlert: (n) => `Someone joined. There are now ${n} online. Check before sending.`,
    ack: 'Got it',
    joinedLine: (n) => `Someone joined · ${n} online`,
    leftLine: (n) => (n === 1 ? 'Someone left · only you' : `Someone left · ${n} online`),
    copy: 'Copy',
    copyFailed: 'Could not copy.',
  },
}

const LS_LANG = 'dotrino.lang'

/** @returns {'es'|'en'} */
export function getLang () {
  let saved = null
  try { saved = localStorage.getItem(LS_LANG) } catch { /* almacenamiento bloqueado: se usa el del navegador */ }
  if (saved === 'es' || saved === 'en') return saved
  return (navigator.language || 'es').toLowerCase().startsWith('es') ? 'es' : 'en'
}

let lang = getLang()

/** @param {'es'|'en'} l */
export function setLang (l) {
  lang = l
  document.documentElement.lang = l
}

/**
 * @param {keyof typeof STRINGS.es} key
 * @param {...any} args
 */
export function t (key, ...args) {
  const v = STRINGS[lang][key]
  return typeof v === 'function' ? v(...args) : v
}

import '@dotrino/theme/theme.css'
import './style.css'
// Barra superior estándar (§5): marca, idioma, tema, perfil y la moneda de support en un
// solo componente. Sin bóveda: el botón de perfil abre el menú con los enlaces.
import '@dotrino/topbar'
import { t, getLang, setLang } from './i18n.js'
import { joinRoom, normalizeChannel, TTL_MS, MAX_TEXT } from './room.js'

const app = document.getElementById('app')
if (!app) throw new Error('efimeral: #app is missing from index.html')

setLang(getLang())

/**
 * @param {string} tag
 * @param {Record<string, any>} [attrs]
 * @param {...(Node|string)} children
 */
function h (tag, attrs = {}, ...children) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v)
    else if (k === 'text') el.textContent = v
    else if (v === true) el.setAttribute(k, '')
    else if (v !== false && v != null) el.setAttribute(k, v)
  }
  el.append(...children)
  return el
}

const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'
const randomChannel = () => {
  const b = crypto.getRandomValues(new Uint8Array(3))
  return [...b].map((x) => ALPHABET[x % ALPHABET.length]).join('')
}

const channel = normalizeChannel(decodeURIComponent(location.pathname.slice(1)))
const askedInvalid = location.pathname.length > 1 && !channel

const topbar = h('dotrino-topbar', {
  brand: channel ? `Efimeral /${channel}` : 'Efimeral',
  icon: '/icon.svg',
  'brand-href': '/',
  profile: true,
  theme: true,
  'no-back': true,
  'support-href': 'https://ko-fi.com/dotrino',
  'support-repo': 'imdotrino/dotrino-efimeral',
  'support-discord': 'https://discord.gg/D648uq7cth',
})
const main = h('main', { class: 'view' })
app.append(topbar, main)

// El idioma lo cambia el topbar: se repinta lo que dependa del texto.
/** @type {() => void} */
let repaint = () => {}
window.addEventListener('dotrino-lang', (e) => {
  const l = /** @type {CustomEvent} */ (e).detail?.lang
  if (l === 'es' || l === 'en') { setLang(l); repaint() }
})

if (channel) renderRoom(channel)
else renderHome()

function renderHome () {
  const input = h('input', {
    class: 'channel-input', maxlength: '3', autocomplete: 'off', autocapitalize: 'off',
    spellcheck: 'false', 'data-testid': 'channel-input', 'aria-label': t('channelLabel'),
    placeholder: t('channelPlaceholder'),
  })
  const msg = h('p', { class: 'hint', 'data-testid': 'home-hint' })
  const go = (/** @type {string} */ c) => { location.href = '/' + c }
  const form = h('form', {
    class: 'home',
    onsubmit: (/** @type {Event} */ e) => {
      e.preventDefault()
      const c = normalizeChannel(/** @type {HTMLInputElement} */ (input).value)
      if (c) go(c)
      else { msg.textContent = t('invalid'); msg.classList.add('bad') }
    },
  })
  const enterBtn = h('button', { class: 'btn primary', type: 'submit', 'data-testid': 'enter-btn' })
  const randomBtn = h('button', { class: 'btn', type: 'button', 'data-testid': 'random-btn', onclick: () => go(randomChannel()) })
  const prefix = h('span', { class: 'prefix', text: 'efimeral.dotrino.com/' })
  form.append(h('div', { class: 'channel-row' }, prefix, input), h('div', { class: 'row' }, enterBtn, randomBtn), msg)
  main.replaceChildren(form)
  repaint = () => {
    enterBtn.textContent = t('enter')
    randomBtn.textContent = t('random')
    input.setAttribute('aria-label', t('channelLabel'))
    if (!msg.classList.contains('bad')) msg.textContent = t('homeHint')
    else msg.textContent = t('invalid')
  }
  if (askedInvalid) msg.classList.add('bad')
  repaint()
  input.focus()
}

/** @param {string} name */
function renderRoom (name) {
  const status = h('div', { class: 'status', 'data-testid': 'status', 'aria-live': 'polite' })
  const list = h('ol', { class: 'messages', 'data-testid': 'messages' })
  const empty = h('p', { class: 'empty', 'data-testid': 'empty' })
  const notice = h('p', { class: 'notice', 'data-testid': 'notice', hidden: true })
  // EL AVISO DE QUE ENTRÓ ALGUIEN. La seguridad del canal es saber quién lo lee: si sube
  // el número de conectados, no se puede enviar nada hasta haberlo visto.
  const alertText = h('span', { 'data-testid': 'join-alert-text' })
  const ackBtn = h('button', { class: 'btn', type: 'button', 'data-testid': 'ack-btn' })
  const alertBox = h('div', { class: 'join-alert', role: 'alert', 'data-testid': 'join-alert', hidden: true }, alertText, ackBtn)
  const input = /** @type {HTMLInputElement} */ (h('input', {
    class: 'composer-input', maxlength: String(MAX_TEXT), autocomplete: 'off',
    'data-testid': 'composer', enterkeyhint: 'send',
  }))
  const sendBtn = h('button', { class: 'btn primary', type: 'submit', 'data-testid': 'send-btn', disabled: true })
  const otherBtn = h('a', { class: 'other', href: '/', 'data-testid': 'other-channel' })
  const composer = h('form', { class: 'composer' }, input, sendBtn)
  main.replaceChildren(h('section', { class: 'room' }, h('div', { class: 'room-head' }, status, otherBtn), alertBox, notice, empty, list, composer))

  /** @type {'connecting'|'online'|'offline'|'error'} */
  let state = 'connecting'
  let count = 0
  // Cuántos conectados ha visto el usuario. `null` hasta la primera lista: lo que hay al
  // entrar ya está a la vista en el contador antes de escribir nada.
  /** @type {number | null} */
  let acked = null
  const pendingJoin = () => acked !== null && count > acked
  const paintStatus = () => {
    status.className = 'status ' + state + (pendingJoin() ? ' alert' : '')
    status.textContent = state === 'online' ? t('online', count) : t(state === 'error' ? 'error' : state)
    sendBtn.toggleAttribute('disabled', state !== 'online' || pendingJoin())
    alertBox.hidden = !pendingJoin()
    if (pendingJoin()) alertText.textContent = t('joinedAlert', count)
  }
  ackBtn.addEventListener('click', () => { acked = count; paintStatus(); input.focus() })
  /** @type {ReturnType<typeof setTimeout> | null} */
  let noticeTimer = null
  /** @param {string} text */
  const showNotice = (text) => {
    notice.textContent = text
    notice.hidden = false
    if (noticeTimer) clearTimeout(noticeTimer)
    noticeTimer = setTimeout(() => { notice.hidden = true }, 6000)
  }
  const paintEmpty = () => { empty.hidden = list.childElementCount > 0 }
  repaint = () => {
    paintStatus()
    empty.textContent = t('empty')
    input.placeholder = t('composer')
    input.setAttribute('aria-label', t('composer'))
    sendBtn.textContent = t('send')
    ackBtn.textContent = t('ack')
    otherBtn.textContent = t('otherChannel')
  }
  repaint()
  paintEmpty()

  /** @type {Set<string>} */
  const seen = new Set()
  /** @param {HTMLElement} li */
  const append = (li) => {
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40
    list.append(li)
    if (atBottom || li.classList.contains('mine')) list.scrollTop = list.scrollHeight
    paintEmpty()
    // A los 60 segundos se borra del DOM, y con él la única copia que existía.
    setTimeout(() => { li.remove(); paintEmpty() }, TTL_MS)
  }
  /** @param {import('./room.js').Msg} m */
  const addMessage = (m) => {
    if (seen.has(m.id)) return
    seen.add(m.id)
    setTimeout(() => seen.delete(m.id), TTL_MS)
    const bar = h('span', { class: 'ttl' })
    bar.style.animationDuration = TTL_MS + 'ms'
    const copyBtn = h('button', {
      class: 'copy', type: 'button', 'data-testid': 'copy-btn', 'aria-label': t('copy'), title: t('copy'),
    })
    copyBtn.innerHTML = ICON_COPY
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(m.text).then(() => {
        copyBtn.innerHTML = ICON_CHECK
        copyBtn.classList.add('done')
        setTimeout(() => { copyBtn.innerHTML = ICON_COPY; copyBtn.classList.remove('done') }, 1500)
      }).catch((e) => { console.warn('[efimeral] copy failed:', e?.message); showNotice(t('copyFailed')) })
    })
    const li = h('li', {
      class: 'msg' + (m.mine ? ' mine' : ''), 'data-testid': 'message', 'data-msg-id': m.id,
    }, h('span', { class: 'text', text: m.text }), copyBtn, bar)
    if (!m.mine) li.style.setProperty('--who', String(hue(m.from)))
    append(li)
  }
  /** @param {'joinedLine'|'leftLine'} key @param {number} n */
  const addSystem = (key, n) => {
    append(h('li', { class: 'sys' + (key === 'joinedLine' ? ' in' : ''), 'data-testid': 'system-line', text: t(key, n) }))
  }

  /** @type {Awaited<ReturnType<typeof joinRoom>> | null} */
  let room = null
  joinRoom(name, {
    onMessage: addMessage,
    onCount: (n) => {
      if (acked !== null && n > count) addSystem('joinedLine', n)
      if (acked !== null && n < count) addSystem('leftLine', n)
      count = n
      // Si alguien se fue, lo visto sigue valiendo para los que quedan.
      if (acked !== null && count < acked) acked = count
      paintStatus()
    },
    onStatus: (s) => {
      state = s
      if (s === 'online' && acked === null) acked = count
      paintStatus()
    },
    onNotice: (k, n) => showNotice(t(k, n)),
  }).then((r) => { room = r }).catch((e) => {
    console.error('[efimeral] connect failed:', e?.code || e?.message)
    state = 'error'
    paintStatus()
  })

  composer.addEventListener('submit', (e) => {
    e.preventDefault()
    if (!room || state !== 'online' || acked === null || pendingJoin()) return
    const text = input.value
    // El pilar vuelve a comprobarlo con su lista: si entró alguien en este mismo
    // instante, no sale y el texto se queda en la caja.
    room.send(text, acked).then(() => { input.value = '' }).catch((err) => {
      if (err?.code === 'new-member') { paintStatus(); return }
      console.error('[efimeral] send failed:', err?.code || err?.message)
    })
  })
  window.addEventListener('pagehide', () => room?.leave())
  input.focus()
}

const ICON_COPY = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>'
const ICON_CHECK = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>'

/** Un color por remitente, para seguir la conversación sin nombres. @param {string} s */
function hue (s) {
  let x = 0
  for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) >>> 0
  return x % 360
}

// Service worker (§3): la app abre sin conexión una vez visitada. Se re-chequea cada
// 30 min para que una PWA instalada no se quede en una versión vieja.
if ('serviceWorker' in navigator && !import.meta.env.DEV) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      setInterval(() => reg.update().catch((e) => console.warn('[efimeral] sw update failed:', e?.message)), 30 * 60_000)
    }).catch((e) => console.warn('[efimeral] sw register failed:', e?.message))
  })
}

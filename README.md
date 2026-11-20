# Temp

**https://temp.dotrino.com/**

Un chat sin registro y sin historial. Entras a un canal de hasta 3 letras o números
(`temp.dotrino.com/abc`), escribes, y cada mensaje se borra a los 60 segundos. Ves quién
está conectado: su apodo y el código de su cuenta de Dotrino.

Sirve para pasarse algo que hay que copiar —un código, un enlace, una clave— entre dos
aparatos o dos personas, sin dejarlo guardado en ningún sitio.

Cómo se usa: [wiki.dotrino.com/apps/temp](https://wiki.dotrino.com/apps/temp/).

## Cómo funciona

- **Tu cuenta de Dotrino, sin registro.** La cuenta se crea sola la primera vez que abres
  una app de Dotrino. La pestaña se identifica con ella y se presenta a cada persona del
  canal con una firma atada a los dos tokens y al canal. Quien la recibe la comprueba
  (`verifySignedBy` de `@dotrino/identity/acta`) y ve el apodo y el código de la cuenta
  (`AB12-CD34`). La comprobación no guarda a nadie en tus contactos.
- **Nada guardado.** El store se abre con la cuenta (§4) pero Temp no guarda nada en él, y
  no escribe nada en el navegador.
- **60 segundos.** Cada mensaje se borra de la pantalla a los 60 segundos de llegar. No hay
  más copia que esa.
- **Nada queda para después.** Quien entra ve lo que se escriba desde ese momento. Para
  pasarle un mensaje anterior, su autor lo reenvía (**Reenviar a N nuevos**), y los 60
  segundos vuelven a empezar.
- **Sellado.** Cada mensaje sale cifrado para cada persona del canal. El servidor de
  transporte (`proxy.dotrino.com`) lo pasa pero no puede leerlo.
- **Saber quién lee.** El canal lo lee cualquiera que sepa su nombre. Por eso, si entra
  alguien, aparece un aviso con su nombre y no se puede enviar nada hasta haberlo visto. Se
  cuenta por persona, no por número: si uno sale y otro entra a la vez, también avisa.
- **Copiar.** Cada mensaje tiene su botón de copiar.

## Desarrollo

```bash
npm install
npm run dev      # http://localhost:3290/abc
npm run build
```

Vite sin framework. Transporte: `@dotrino/proxy-client` (canales públicos para saber quién
está; mensajes sellados por token). Cuenta: `@dotrino/identity`. Almacén: `@dotrino/store`. Se despliega a GitHub Pages con cada push a `main`; el
`404.html` es la misma app, para que funcione cualquier `/<canal>`.

## Licencia

MIT. Parte de [Dotrino](https://dotrino.com/), un ecosistema de aplicaciones centradas en la
privacidad de tus datos.

# Efimeral

**https://efimeral.dotrino.com/**

Un chat sin cuenta y sin historial. Entras a un canal de hasta 3 letras o números
(`efimeral.dotrino.com/abc`), escribes, y cada mensaje se borra a los 60 segundos. Solo ves
cuántas personas hay conectadas.

Sirve para pasarse algo que hay que copiar —un código, un enlace, una clave— entre dos
aparatos o dos personas, sin dejarlo guardado en ningún sitio.

Cómo se usa: [wiki.dotrino.com/apps/efimeral](https://wiki.dotrino.com/apps/efimeral/).

## Cómo funciona

- **Sin cuenta.** Cada pestaña crea al abrirse sus llaves, que viven solo en memoria. Al
  cerrarla desaparecen. No se usa la bóveda ni el almacén, y no se escribe nada en el
  navegador.
- **60 segundos.** Cada mensaje se borra de la pantalla a los 60 segundos de llegar. No hay
  más copia que esa.
- **Nada queda para después.** Quien entra ve lo que se escriba desde ese momento. Para
  pasarle un mensaje anterior, su autor lo reenvía (**Reenviar a N nuevos**), y los 60
  segundos vuelven a empezar.
- **Sellado.** Cada mensaje sale cifrado para cada persona del canal. El servidor de
  transporte (`proxy.dotrino.com`) lo pasa pero no puede leerlo.
- **Saber quién lee.** El canal lo lee cualquiera que sepa su nombre. Por eso, si entra
  alguien, aparece un aviso y no se puede enviar nada hasta haberlo visto.
- **Copiar.** Cada mensaje tiene su botón de copiar.

## Desarrollo

```bash
npm install
npm run dev      # http://localhost:3290/abc
npm run build
```

Vite sin framework. Transporte: `@dotrino/proxy-client` (canales públicos para saber quién
está; mensajes sellados por token). Se despliega a GitHub Pages con cada push a `main`; el
`404.html` es la misma app, para que funcione cualquier `/<canal>`.

## Licencia

MIT. Parte de [Dotrino](https://dotrino.com/), un ecosistema de aplicaciones centradas en la
privacidad de tus datos.

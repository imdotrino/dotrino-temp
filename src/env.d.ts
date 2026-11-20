/// <reference types="vite/client" />
// La versión de esta build, la escribe vite.config.js (`define`).
declare const __APP_VERSION__: string

// @dotrino/compat 0.5.1 no publica tipos: aquí va lo que Temp usa.
declare module '@dotrino/compat' {
  export interface Declaration { product: string, version: string, protocol: number, speaks: number[] }
  export interface BrokenEntry { product: string, versions: string | string[], why?: string, fix?: string }
  export function declare (d: { product: string, version: string, protocol: number, speaks?: number[] }): Declaration
  export function check (o: { mine: Declaration, theirs: unknown, broken?: BrokenEntry[] }): { compatible: boolean }
}

"use strict";

import { claveCelda } from "./motor";
import { Celda, DefinicionCuadro, NULO, TOTAL, UNICA } from "./tipos";

export interface Etiquetas {
    titulo: string;
    opciones: Map<string, string>;
}

export function esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function ordenar(a: string, b: string): number {
    if (a === b) return 0;
    if (a === TOTAL) return -1;
    if (b === TOTAL) return 1;
    if (a === NULO) return -1;
    if (b === NULO) return 1;
    var na = Number(a), nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    return a < b ? -1 : 1;
}

function rotulo(clave: string, et: Etiquetas | undefined): string {
    if (clave === TOTAL) return 'Total';
    if (clave === NULO) return 'Sin dato';
    var t = et?.opciones.get(clave);
    return t ? `${clave}. ${t}` : clave;
}

function formatear(valor: string | null, decimales: number, sep: string): string {
    if (valor === null) return '';
    var n = Number(valor);
    if (!Number.isFinite(n)) return valor;
    return n.toFixed(decimales).replace('.', sep);
}

/**
 * Dibuja el cuadro. En "comun" muestra el % sobre el total de la fila (como publica SIEH 1)
 * y la cantidad en el title de la celda.
 */
export function cuadroHtml(def: DefinicionCuadro, celdas: Celda[], et: { f1?: Etiquetas; f2?: Etiquetas; c?: Etiquetas },
    decimales: number, sep: string, expandido: boolean): string {
    var porClave = new Map<string, Celda>();
    celdas.forEach((c: Celda) => porClave.set(claveCelda(c), c));
    var filas = Array.from(new Set(celdas.map((c: Celda) => c.f1 + '|' + c.f2)))
        .map((k: string) => k.split('|'))
        .sort((a: string[], b: string[]) => ordenar(a[0], b[0]) || ordenar(a[1], b[1]));
    var cols = Array.from(new Set(celdas.map((c: Celda) => c.c))).sort(ordenar);
    var titulo = `${def.id} ${def.titulo}${expandido ? '' : ' (MUESTRAL)'}`;
    var cab = `<tr><th>${esc(et.f1?.titulo ?? def.fila1)}</th>${def.fila2 ? `<th>${esc(et.f2?.titulo ?? def.fila2)}</th>` : ''}` +
        cols.map((c: string) => `<th>${esc(c === UNICA ? (def.tipo === 'frecuencia' ? (def.columna === 'hog' ? 'Hogares' : 'Personas') : def.tipo) : rotulo(c, et.c))}</th>`).join('') + '</tr>';
    var cuerpo = filas.map((fk: string[]) => {
        var celdasFila = cols.map((c: string) => {
            var celda = porClave.get(`${fk[0]}|${fk[1]}|${c}`);
            if (!celda) return '<td class="vacia"></td>';
            if (def.tipo === 'comun') {
                var tot = porClave.get(`${fk[0]}|${fk[1]}|${TOTAL}`);
                var pct = tot && tot.valor && Number(tot.valor) !== 0 && celda.valor !== null
                    ? (Number(celda.valor) * 100 / Number(tot.valor)).toFixed(decimales).replace('.', sep) : '';
                return `<td title="${esc(celda.valor ?? '')}">${c === TOTAL ? '100' + (decimales ? sep + '0'.repeat(decimales) : '') : pct}</td>`;
            }
            return `<td>${formatear(celda.valor, decimales, sep)}</td>`;
        }).join('');
        return `<tr><th>${esc(rotulo(fk[0], et.f1))}</th>${def.fila2 ? `<th>${esc(rotulo(fk[1], et.f2))}</th>` : ''}${celdasFila}</tr>`;
    }).join('\n');
    return `<table class="cuadro"><caption>${esc(titulo)}</caption><thead>${cab}</thead><tbody>${cuerpo}</tbody></table>`;
}

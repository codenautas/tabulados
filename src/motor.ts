"use strict";

/*
 * Motor genérico de cuadros.
 *
 * A diferencia de SIEH 1 (que arma un UNION distinto por tipo de celda y por cantidad de filas),
 * acá hay una sola consulta: GROUP BY CUBE sobre las dimensiones del cuadro. CUBE produce
 * todas las combinaciones de totales (por fila, por columna, por fila2, total general) y
 * GROUPING() distingue un total de una categoría nula.
 *
 * El motor no conoce tablas ni operativos: recibe una Fuente.
 */

import { Celda, DefinicionCuadro, ErrorDefinicion, Fila, Fuente, NULO, TOTAL, UNICA } from "./tipos";

const IDENT = /^[A-Za-z][A-Za-z0-9_]*$/;

function validarIdent(nombre: string, que: string): void {
    if (!IDENT.test(nombre)) {
        throw new ErrorDefinicion(`${que} inválido: "${nombre}"`);
    }
}

/** Columnas como 'mie' u 'hog' en frecuencias no son una dimensión: sólo rotulan qué se cuenta. */
export function columnaEsDimension(def: DefinicionCuadro): boolean {
    if (def.tipo === 'comun') return true;
    if (def.tipo === 'frecuencia') return def.columna !== null && def.columna !== 'mie' && def.columna !== 'hog';
    return false;
}

export function decimalesDe(def: DefinicionCuadro): number {
    if (def.decimales !== null) return def.decimales;
    if (def.tipo === 'promedio' || def.tipo === 'suma') {
        throw new ErrorDefinicion(`El cuadro ${def.id} es de tipo ${def.tipo} y no tiene decimales definidos`);
    }
    return 1;
}

export interface ConsultaCuadro {
    sql: string;
    /** Nombres de las columnas de salida que son dimensiones, en orden f1, f2, c. */
    dimensiones: { f1: string; f2: string | null; c: string | null };
}

/** Arma la expresión de la medida según el tipo de celda. */
function expresionValor(def: DefinicionCuadro, fuente: Fuente, dec: number): string {
    var w = fuente.ponderador;
    var col = def.columna ? fuente.expresion(def.columna) : null;
    switch (def.tipo) {
        case 'comun':
        case 'frecuencia':
            return w ? `sum(${w})` : 'count(*)';
        case 'tasa':
            if (!col) throw new ErrorDefinicion(`La tasa ${def.id} no tiene variable en columna`);
            return w
                ? `round(sum(case when ${col}>0 then ${w} else 0 end)::numeric*100/nullif(sum(${w}),0)::numeric, ${dec})`
                : `round(sum(case when ${col}>0 then 1 else 0 end)::numeric*100/nullif(count(*),0)::numeric, ${dec})`;
        case 'promedio':
            if (!col) throw new ErrorDefinicion(`El promedio ${def.id} no tiene variable en columna`);
            // Igual que SIEH 1: expandido divide por la suma de factores de TODOS los casos (también los nulos);
            // muestral usa avg(), que ignora los nulos. Se conserva para poder comparar; revisar con procesamiento.
            return w
                ? `round(sum(${col}::numeric*${w})/nullif(sum(${w}),0)::numeric, ${dec})`
                : `round(avg(${col})::numeric, ${dec})`;
        case 'suma':
            if (!col) throw new ErrorDefinicion(`La suma ${def.id} no tiene variable en columna`);
            return w ? `round(sum(${col}::numeric*${w})::numeric, ${dec})` : `round(sum(${col})::numeric, ${dec})`;
        case 'mediana':
            if (!col) throw new ErrorDefinicion(`La mediana ${def.id} no tiene variable en columna`);
            if (w) {
                // Mediana ponderada: primer valor donde el peso acumulado alcanza la mitad del total.
                // Pendiente validar contra dbo.mediana_expandida de SIEH 1 (no se compara todavía).
                throw new ErrorDefinicion('La mediana expandida todavía no está implementada');
            }
            return `round((percentile_cont(0.5) within group (order by ${col}))::numeric, ${dec})`;
    }
}

export function generarConsulta(def: DefinicionCuadro, fuente: Fuente): ConsultaCuadro {
    validarIdent(def.fila1, 'fila1');
    if (def.fila2) validarIdent(def.fila2, 'fila2');
    if (def.columna) validarIdent(def.columna, 'columna');
    var dec = decimalesDe(def);
    var dims: string[] = [];
    var exprs: string[] = [];
    var agregar = (alias: string, variable: string) => {
        dims.push(alias);
        exprs.push(fuente.expresion(variable));
    };
    agregar('d_f1', def.fila1);
    if (def.fila2) agregar('d_f2', def.fila2);
    var conColumna = columnaEsDimension(def);
    if (conColumna) agregar('d_c', def.columna!);
    var selectDims = dims.map((d: string, i: number) => `${exprs[i]} as ${d}`);
    var grouping = dims.map((d: string, i: number) => `grouping(${exprs[i]}) as g${d.substring(1)}`);
    var sql = `select ${selectDims.join(', ')},
       ${grouping.join(', ')},
       ${expresionValor(def, fuente, dec)} as valor
  ${fuente.desde}
  where ${fuente.donde}
  group by cube(${exprs.join(', ')})`;
    return {
        sql,
        dimensiones: { f1: 'd_f1', f2: def.fila2 ? 'd_f2' : null, c: conColumna ? 'd_c' : null }
    };
}

/** Normaliza un valor de categoría para usarlo como clave. */
export function claveDe(valor: string | null): string {
    if (valor === null) return NULO;
    var n = Number(valor);
    return valor.trim() !== '' && Number.isFinite(n) ? String(n) : valor;
}

function coordenada(fila: Fila, dim: string | null): string {
    if (dim === null) return TOTAL;
    if (fila['g' + dim.substring(1)] === '1') return TOTAL;
    return claveDe(fila[dim]);
}

/** Convierte el resultado de la consulta en celdas. */
export function aCeldas(consulta: ConsultaCuadro, filas: Fila[]): Celda[] {
    var d = consulta.dimensiones;
    return filas.map((fila: Fila): Celda => ({
        f1: coordenada(fila, d.f1),
        f2: d.f2 ? coordenada(fila, d.f2) : TOTAL,
        c: d.c ? coordenada(fila, d.c) : UNICA,
        valor: fila['valor']
    }));
}

export function claveCelda(c: { f1: string; f2: string; c: string }): string {
    return `${c.f1}|${c.f2}|${c.c}`;
}

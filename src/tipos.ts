"use strict";

/** Fila devuelta por una consulta: nombre de columna -> valor como texto (null si es NULL). */
export type Fila = Record<string, string | null>;

/** Ejecuta SQL y devuelve las filas. */
export interface Ejecutor {
    consultar(sql: string): Fila[];
}

export type TipoCelda = 'comun' | 'frecuencia' | 'tasa' | 'promedio' | 'suma' | 'mediana';
export type Unidad = 'personas' | 'hogares' | 'viviendas';

export const TIPOS_CELDA: TipoCelda[] = ['comun', 'frecuencia', 'tasa', 'promedio', 'suma', 'mediana'];
export const UNIDADES: Unidad[] = ['personas', 'hogares', 'viviendas'];

/** Definición de un cuadro. Equivale a una fila de encu.tabulados de SIEH 1. */
export interface DefinicionCuadro {
    id: string;
    titulo: string;
    fila1: string;
    fila2: string | null;
    columna: string | null;
    unidad: Unidad;
    tipo: TipoCelda;
    filtro: string | null;
    decimales: number | null;
    grupo: string | null;
}

/**
 * De dónde salen los datos de un cuadro. Cada aplicación (SIEH 1, dmencu) da la suya.
 * El motor no sabe nada de tablas: sólo pide el FROM, el WHERE y la expresión SQL de cada variable.
 */
export interface Fuente {
    /** FROM completo (incluye la palabra "from"). */
    desde: string;
    /** Condición WHERE completa ya traducida (sin la palabra "where"); "true" si no hay. */
    donde: string;
    /** Expresión SQL del ponderador; null para cuadros muestrales (cuenta casos). */
    ponderador: string | null;
    /** Expresión SQL de una variable. */
    expresion(variable: string): string;
}

/** Marca de total en las claves de celda. */
export const TOTAL = 'T';
/** Marca de categoría nula en las claves de celda. */
export const NULO = 'NULL';
/** Marca de "no aplica" para la dimensión de columna en tipos sin columna-dimensión. */
export const UNICA = '*';

/** Una celda calculada: las tres coordenadas y el valor. */
export interface Celda {
    f1: string;
    f2: string;
    c: string;
    valor: string | null;
}

export class ErrorDefinicion extends Error {}

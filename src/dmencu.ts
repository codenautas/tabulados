"use strict";

/*
 * Todo lo específico de dmencu (SIEH 2): datos relacionales por unidad de análisis
 * (viviendas -> hogares -> personas), una tabla `<operativo>_<ua>_calculada` por unidad con las
 * variables calculadas por varcal, y `tem` con el estado, el ponderador (fexp) y las tareas.
 *
 * Todo se descubre de la base (unidad_analisis e information_schema): nada depende de los
 * nombres de un operativo en particular. Las diferencias con SIEH 1:
 *  - no hay tablas planas: el FROM se arma con joins por clave entre la unidad, sus padres y tem;
 *  - las calculadas están en otra tabla de la misma unidad (join 1 a 1 por clave);
 *  -  "estado >= 77" de SIEH 1 equivale a tarea proc en estado V y rea positiva (tabla rea, es_positiva).
 */

import { agregarPrefijo } from "./prefijo";
import { DefinicionCuadro, Ejecutor, ErrorDefinicion, Fila, Fuente } from "./tipos";

/** Marca temporal para ubicar identificadores de una expresión libre antes de resolverlos. */
const MARCA = '§';

export interface OpcionesDmencu {
    /** Código del operativo (valor de la columna operativo). */
    operativo: string;
    /** Esquema donde están las tablas del operativo. */
    esquema: string;
    /** true: cuadros expandidos (con ponderador); false: muestrales (cuentan casos). */
    expandido: boolean;
    /**
     * Condición SQL para considerar una encuesta cerrada, escrita sobre el alias `t` (tem).
     * Por defecto: la tarea proc está verificada (estado V).
     */
    condicionCierre?: string;
    /** Ponderador (alias t). Por defecto t.fexp. */
    ponderador?: string;
    /** Condición de realización, sobre `t`. Por defecto: el código rea de tem figura en la tabla rea con es_positiva (SIEH 1 usaba rea not in (0,2)). */
    condicionRea?: string;
    /** Nombres de SIEH 1 que en dmencu se llaman distinto (por ejemplo mie -> persona). */
    renombres?: Record<string, string>;
    /** Esquema de las tablas externas (datos-ext). Por defecto el mismo del operativo, como las _calculada. */
    esquemaExterno?: string;
    /**
     * Para tablas externas que conviven varios operativos (EAH con ETOI como submuestra): columna que
     * los distingue y valor que corresponde a este cuadro. Se agrega al join de las externas que tienen esa columna.
     */
    discriminador?: { columna: string; valor: string };
}

export interface Unidad {
    nombre: string;
    padre: string | null;
    pkAgregada: string;
}

interface Tabla {
    /** Nombre calificado con el esquema. */
    nombre: string;
    alias: string;
    columnas: Set<string>;
}

export interface FuenteDmencu extends Fuente {
    /** Descripción legible de cómo se resolvió cada variable usada (para depurar y mostrar). */
    resoluciones: Record<string, string>;
}

export function leerUnidades(db: Ejecutor, operativo: string): Record<string, Unidad> {
    var filas = db.consultar(`
        select unidad_analisis, padre, pk_agregada
          from unidad_analisis
          where operativo = '${operativo.replace(/'/g, "''")}'`);
    var unidades: Record<string, Unidad> = {};
    filas.forEach((fila: Fila) => {
        var nombre = fila['unidad_analisis'] ?? '';
        unidades[nombre] = { nombre, padre: fila['padre'] || null, pkAgregada: fila['pk_agregada'] ?? '' };
    });
    return unidades;
}

/** Cadena de la unidad hasta la raíz: [personas, hogares, viviendas]. */
export function cadenaHastaRaiz(unidades: Record<string, Unidad>, hoja: string): Unidad[] {
    var cadena: Unidad[] = [];
    var actual: string | null = hoja;
    while (actual) {
        var u: Unidad | undefined = unidades[actual];
        if (!u) throw new ErrorDefinicion(`La unidad de análisis ${actual} no está definida en unidad_analisis`);
        cadena.push(u);
        actual = u.padre;
    }
    return cadena;
}

export function leerColumnas(db: Ejecutor, esquema: string, tablas: string[]): Record<string, Set<string>> {
    var lista = tablas.map((t: string) => `'${t.replace(/'/g, "''")}'`).join(',');
    var filas = db.consultar(`
        select table_name, column_name
          from information_schema.columns
          where table_schema = '${esquema.replace(/'/g, "''")}' and table_name in (${lista})`);
    var resultado: Record<string, Set<string>> = {};
    filas.forEach((fila: Fila) => {
        var tabla = fila['table_name'] ?? '';
        if (!resultado[tabla]) resultado[tabla] = new Set<string>();
        resultado[tabla].add(fila['column_name'] ?? '');
    });
    return resultado;
}

/** Encuesta cerrada (equivale a estado >= 77 de SIEH 1): tarea proc en estado V. Sobre el alias t (tem). */
export function cierrePorDefecto(esquema: string): string {
    return `exists (select 1 from ${esquema}.tareas_tem tt where tt.operativo = t.operativo and tt.enc = t.enc and tt.tarea = 'proc' and tt.estado = 'V')`;
}

/** Encuesta con resultado positivo: su código rea figura en la tabla rea con es_positiva. Sobre el alias t (tem). */
export function reaPorDefecto(esquema: string): string {
    return `exists (select 1 from ${esquema}.rea r where r.operativo = t.operativo and r.rea = t.rea and r.es_positiva)`;
}

export const ALIAS_POR_NIVEL = ['p', 'h', 'v', 'w', 'x'];

/**
 * Arma la Fuente de dmencu para una definición de cuadro.
 * Lanza ErrorDefinicion si la unidad no existe o si el cuadro usa una variable que no está
 * en ninguna tabla de la cadena (ni en la unidad, ni en sus padres, ni en tem, ni en sus calculadas).
 */
export function fuenteDmencu(db: Ejecutor, def: DefinicionCuadro, opciones: OpcionesDmencu): FuenteDmencu {
    var { operativo, esquema } = opciones;
    var renombres = opciones.renombres ?? {};
    var unidades = leerUnidades(db, operativo);
    var cadena = cadenaHastaRaiz(unidades, def.unidad);
    var raiz = cadena[cadena.length - 1];
    var esquemaExt = opciones.esquemaExterno ?? esquema;

    // Tablas candidatas: por nivel la tabla de la unidad y su calculada (si existe), y al final tem.
    var nombresFisicos: string[] = [];
    cadena.forEach((u: Unidad) => nombresFisicos.push(u.nombre, `${operativo.toLowerCase()}_${u.nombre}_calculada`));
    nombresFisicos.push('tem');
    var columnasPorTabla = leerColumnas(db, esquema, nombresFisicos);
    if (!columnasPorTabla[def.unidad]) {
        throw new ErrorDefinicion(`No existe la tabla ${esquema}.${def.unidad} en la base`);
    }

    var tablasEnOrden: Tabla[] = [];
    var joins: string[] = [];
    // Claves de cada nivel: operativo + pk_agregada de la raíz hasta ese nivel.
    var clavesPorNivel: string[][] = cadena.map((_u: Unidad, i: number) =>
        ['operativo', ...cadena.slice(i).reverse().map((c: Unidad) => c.pkAgregada)]);
    cadena.forEach((u: Unidad, nivel: number) => {
        var alias = ALIAS_POR_NIVEL[nivel] ?? `n${nivel}`;
        var tabla: Tabla = { nombre: `${esquema}.${u.nombre}`, alias, columnas: columnasPorTabla[u.nombre] ?? new Set<string>() };
        tablasEnOrden.push(tabla);
        var calculadaFisica = `${operativo.toLowerCase()}_${u.nombre}_calculada`;
        var calc = columnasPorTabla[calculadaFisica];
        var aliasCalc: string | null = null;
        if (calc) {
            aliasCalc = alias + 'c';
            tablasEnOrden.push({ nombre: `${esquema}.${calculadaFisica}`, alias: aliasCalc, columnas: calc });
        }
        if (nivel === 0) {
            joins.push(`from ${tabla.nombre} ${alias}`);
        } else {
            var hijo = ALIAS_POR_NIVEL[nivel - 1] ?? `n${nivel - 1}`;
            var claves = clavesPorNivel[nivel];
            joins.push(`inner join ${tabla.nombre} ${alias} on ${claves.map((k: string) => `${alias}.${k} = ${hijo}.${k}`).join(' and ')}`);
        }
        if (aliasCalc) {
            var clavesNivel = clavesPorNivel[nivel];
            joins.push(`left join ${esquema}.${calculadaFisica} ${aliasCalc} on ${clavesNivel.map((k: string) => `${aliasCalc}.${k} = ${alias}.${k}`).join(' and ')}`);
        }
    });
    // Tablas externas (tabla_datos.tipo = 'externa'): cada una se une en el nivel más profundo cuyas claves tiene completas.
    var externas = db.consultar(`
        select table_name from tabla_datos
          where operativo = '${operativo.replace(/'/g, "''")}' and tipo = 'externa' and table_name is not null
          order by tabla_datos`);
    var colsExt = externas.length ? leerColumnas(db, esquemaExt, externas.map((f: Fila) => f['table_name'] ?? '')) : {};
    // Se unen recién cuando el cuadro usa alguna de sus variables: una externa con varias filas por clave
    // (por ejemplo una por operativo) duplicaría los casos aunque no se use.
    var contador = 0;
    var pendientes: { nombre: string; cols: Set<string>; nivel: number; unida: boolean }[] = [];
    externas.forEach((fila: Fila) => {
        var nombre = fila['table_name'] ?? '';
        var cols = colsExt[nombre];
        if (!cols) return;
        var nivel = cadena.findIndex((_u: Unidad, i: number) => clavesPorNivel[i].every((k: string) => cols.has(k)));
        if (nivel < 0) return;
        pendientes.push({ nombre, cols, nivel, unida: false });
    });
    var unirExterna = (ext: { nombre: string; cols: Set<string>; nivel: number; unida: boolean }): string => {
        var alias = `e${++contador}`;
        var base = ALIAS_POR_NIVEL[ext.nivel] ?? `n${ext.nivel}`;
        var condiciones = clavesPorNivel[ext.nivel].map((k: string) => `${alias}.${k} = ${base}.${k}`);
        var d = opciones.discriminador;
        if (d && ext.cols.has(d.columna)) condiciones.push(`${alias}.${d.columna} = '${d.valor.replace(/'/g, "''")}'`);
        var cubiertas = new Set<string>([...clavesPorNivel[ext.nivel], ...(d ? [d.columna] : [])]);
        var pk = db.consultar(`
            select a.attname as col from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
              where i.indrelid = '${esquemaExt}.${ext.nombre}'::regclass and i.indisprimary`);
        var sobrantes = pk.map((f: Fila) => f['col'] ?? '').filter((c: string) => !cubiertas.has(c));
        if (sobrantes.length) {
            throw new ErrorDefinicion(`La tabla externa ${esquemaExt}.${ext.nombre} tiene varias filas por clave (columnas ${sobrantes.join(', ')}): falta indicar el discriminador`);
        }
        joins.push(`left join ${esquemaExt}.${ext.nombre} ${alias} on ${condiciones.join(' and ')}`);
        ext.unida = true;
        return alias;
    };
    var aliasRaiz = ALIAS_POR_NIVEL[cadena.length - 1] ?? `n${cadena.length - 1}`;
    joins.push(`inner join ${esquema}.tem t on t.operativo = ${aliasRaiz}.operativo and t.enc = ${aliasRaiz}.${raiz.pkAgregada}`);
    tablasEnOrden.push({ nombre: `${esquema}.tem`, alias: 't', columnas: columnasPorTabla['tem'] ?? new Set<string>() });

    // Las claves de cada nivel quedan sólo en la unidad: se resuelven primero por la tabla más cercana.
    var resoluciones: Record<string, string> = {};
    var resolver = (variable: string): string => {
        var nombre = renombres[variable] ?? variable;
        var existente = resoluciones[variable];
        if (existente) return existente;
        for (var tabla of tablasEnOrden) {
            if (tabla.columnas.has(nombre)) {
                var expresion = `${tabla.alias}.${nombre}`;
                resoluciones[variable] = expresion;
                return expresion;
            }
        }
        for (var ext of pendientes) {
            if (!ext.unida && ext.cols.has(nombre)) {
                var aliasExt = unirExterna(ext);
                resoluciones[variable] = `${aliasExt}.${nombre}`;
                return resoluciones[variable];
            }
        }
        throw new ErrorDefinicion(`La variable ${variable} no está en ${def.unidad}, sus unidades padre, tem, sus tablas _calculada ni las externas (¿falta generar calculadas o cargar el metadato?)`);
    };

    var condicionCierre = opciones.condicionCierre ?? cierrePorDefecto(esquema);
    var condicionRea = opciones.condicionRea ?? reaPorDefecto(esquema);
    var partes: string[] = [condicionCierre, condicionRea];
    if (def.unidad !== 'viviendas') partes.push(`${resolver('entrea')} <> 4`);
    if (def.filtro) {
        var marcada = agregarPrefijo(def.filtro, MARCA);
        var traducido = marcada.replace(new RegExp(MARCA + '([A-Za-z_][A-Za-z_0-9]*)', 'g'), (_m: string, ident: string) => resolver(ident));
        partes.unshift(`(${traducido})`);
    }
    return {
        get desde(): string { return '\n' + joins.join('\n') + '\n'; },
        donde: partes.join('\n    and '),
        ponderador: opciones.expandido ? (opciones.ponderador ?? 't.fexp') : null,
        expresion: resolver,
        resoluciones
    };
}

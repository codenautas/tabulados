"use strict";

/*
 * Vista plana de dmencu: una fila por caso de la unidad de análisis, con todas las variables que le
 * corresponden en una sola fila. Equivale a las tablas plana_* de SIEH 1, pero es una vista: no se
 * mantiene con triggers ni se recrea al cambiar metadatos (alcanza con volver a generarla).
 *
 *   <esquema>.<operativo>_<ua>_plana
 *
 * Arma las mismas uniones que la Fuente de tabulados (dmencu.ts), en el mismo orden de prioridad:
 * la unidad, su _calculada, sus externas, después cada unidad padre con las suyas, y por último tem.
 * Si dos tablas tienen una columna con el mismo nombre, queda la primera y se informa.
 *
 * Agrega dos columnas para filtrar sin repetir reglas:
 *   cerrada         tarea proc en estado V (el "estado >= 77" de SIEH 1)
 *   rea_positiva    el código rea de tem figura en la tabla rea con es_positiva
 *
 * Uso:
 *   node dist/plana.js --config local-config.json --operativo pcetoi --esquema base [--ua personas]
 *        [--discriminador origen=etoi] [--con-json] [--crear] [--salida archivo.sql]
 * Sin --crear sólo escribe el SQL (para revisarlo o correrlo a mano).
 */

import * as fs from "fs";
import { ejecutorPsql, ConfigDb } from "./psql";
import {
    ALIAS_POR_NIVEL, Unidad, cadenaHastaRaiz, cierrePorDefecto, leerUnidades, reaPorDefecto
} from "./dmencu";
import { Ejecutor, ErrorDefinicion, Fila } from "./tipos";

export interface OpcionesPlana {
    operativo: string;
    esquema: string;
    /** Esquema de las tablas externas. Por defecto el mismo del operativo. */
    esquemaExterno?: string;
    /** Externas con varias filas por clave (EAH con ETOI): columna y valor a usar. */
    discriminador?: { columna: string; valor: string };
    /** Incluir columnas json/jsonb (en tem está json_encuesta, que es muy grande). Por defecto no. */
    conJson?: boolean;
    condicionCierre?: string;
    condicionRea?: string;
}

export interface VistaPlana {
    nombre: string;
    sql: string;
    /** Columnas descartadas por repetirse: columna -> tabla de la que se tomó y tabla que se descartó. */
    repetidas: { columna: string; tomada: string; descartada: string }[];
    /** Tablas externas que no se pudieron unir y por qué. */
    externasOmitidas: { tabla: string; motivo: string }[];
}

interface Columna { nombre: string; tipo: string; }

function q(s: string): string { return `'${s.replace(/'/g, "''")}'`; }
function id(s: string): string { return /^[a-z_][a-z0-9_]*$/.test(s) ? s : `"${s.replace(/"/g, '""')}"`; }

function columnasDe(db: Ejecutor, esquema: string, tablas: string[]): Record<string, Columna[]> {
    if (!tablas.length) return {};
    var filas = db.consultar(`
        select table_name, column_name, data_type
          from information_schema.columns
          where table_schema = ${q(esquema)} and table_name in (${tablas.map(q).join(',')})
          order by table_name, ordinal_position`);
    var r: Record<string, Columna[]> = {};
    filas.forEach((f: Fila) => {
        var t = f['table_name'] ?? '';
        (r[t] = r[t] ?? []).push({ nombre: f['column_name'] ?? '', tipo: f['data_type'] ?? '' });
    });
    return r;
}

function pkDe(db: Ejecutor, esquema: string, tabla: string): string[] {
    return db.consultar(`
        select a.attname as col from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
          where i.indrelid = ${q(esquema + '.' + tabla)}::regclass and i.indisprimary`).map((f: Fila) => f['col'] ?? '');
}

export function generarVistaPlana(db: Ejecutor, ua: string, opciones: OpcionesPlana): VistaPlana {
    var { operativo, esquema } = opciones;
    var esquemaExt = opciones.esquemaExterno ?? esquema;
    var op = operativo.toLowerCase();
    var unidades = leerUnidades(db, operativo);
    var cadena = cadenaHastaRaiz(unidades, ua);
    var raiz = cadena[cadena.length - 1];
    var clavesPorNivel: string[][] = cadena.map((_u: Unidad, i: number) =>
        ['operativo', ...cadena.slice(i).reverse().map((c: Unidad) => c.pkAgregada)]);

    var nombres: string[] = ['tem'];
    cadena.forEach((u: Unidad) => nombres.push(u.nombre, `${op}_${u.nombre}_calculada`));
    var cols = columnasDe(db, esquema, nombres);
    if (!cols[ua]) throw new ErrorDefinicion(`No existe la tabla ${esquema}.${ua}`);

    var externas = db.consultar(`
        select table_name from ${esquema}.tabla_datos
          where operativo = ${q(operativo)} and tipo = 'externa' and table_name is not null
          order by tabla_datos`).map((f: Fila) => f['table_name'] ?? '');
    var colsExt = columnasDe(db, esquemaExt, externas);
    var externasOmitidas: { tabla: string; motivo: string }[] = [];
    var externasPorNivel: { tabla: string; condExtra: string | null }[][] = cadena.map(() => []);
    externas.forEach((t: string) => {
        var c = colsExt[t];
        if (!c) { externasOmitidas.push({ tabla: t, motivo: `no existe en el esquema ${esquemaExt}` }); return; }
        var nombresCol = new Set(c.map((x: Columna) => x.nombre));
        var nivel = cadena.findIndex((_u: Unidad, i: number) => clavesPorNivel[i].every((k: string) => nombresCol.has(k)));
        if (nivel < 0) { externasOmitidas.push({ tabla: t, motivo: `sus columnas no incluyen la clave de ${ua} ni de sus unidades padre` }); return; }
        // externas de una unidad hija (por ejemplo de personas en la plana de hogares) no se pueden unir 1 a 1
        var d = opciones.discriminador;
        var cubiertas = new Set<string>([...clavesPorNivel[nivel], ...(d && nombresCol.has(d.columna) ? [d.columna] : [])]);
        var sobrantes = pkDe(db, esquemaExt, t).filter((k: string) => !cubiertas.has(k));
        // externa de una unidad hija (por ejemplo de hogares en la plana de viviendas): va en la plana de esa unidad
        var clavesHijas = new Set(Object.values(unidades).filter((u: Unidad) => !cadena.includes(u)).map((u: Unidad) => u.pkAgregada));
        if (sobrantes.some((k: string) => clavesHijas.has(k))) return;
        if (sobrantes.length) {
            externasOmitidas.push({ tabla: t, motivo: `tiene varias filas por clave (${sobrantes.join(', ')}): indicar el discriminador` });
            return;
        }
        externasPorNivel[nivel].push({ tabla: t, condExtra: d && nombresCol.has(d.columna) ? `${d.columna} = ${q(d.valor)}` : null });
    });

    var select: string[] = [];
    var vistas = new Map<string, string>(); // columna -> tabla de origen
    var repetidas: { columna: string; tomada: string; descartada: string }[] = [];
    var agregar = (alias: string, tabla: string, columnas: Columna[]) => {
        columnas.forEach((c: Columna) => {
            if (!opciones.conJson && (c.tipo === 'json' || c.tipo === 'jsonb')) return;
            var previa = vistas.get(c.nombre);
            if (previa !== undefined) {
                // las claves se repiten en todas las tablas a propósito: no se informan
                if (!clavesPorNivel[0].includes(c.nombre) && c.nombre !== 'enc') {
                    repetidas.push({ columna: c.nombre, tomada: previa, descartada: tabla });
                }
                return;
            }
            vistas.set(c.nombre, tabla);
            select.push(`${alias}.${id(c.nombre)}`);
        });
    };

    var joins: string[] = [];
    var contador = 0;
    cadena.forEach((u: Unidad, nivel: number) => {
        var alias = ALIAS_POR_NIVEL[nivel] ?? `n${nivel}`;
        var claves = clavesPorNivel[nivel];
        if (nivel === 0) {
            joins.push(`  from ${esquema}.${u.nombre} ${alias}`);
        } else {
            var hijo = ALIAS_POR_NIVEL[nivel - 1] ?? `n${nivel - 1}`;
            joins.push(`  join ${esquema}.${u.nombre} ${alias} on ${claves.map((k: string) => `${alias}.${k} = ${hijo}.${k}`).join(' and ')}`);
        }
        agregar(alias, u.nombre, cols[u.nombre] ?? []);
        var calc = `${op}_${u.nombre}_calculada`;
        if (cols[calc]) {
            var ac = alias + 'c';
            joins.push(`  left join ${esquema}.${calc} ${ac} on ${claves.map((k: string) => `${ac}.${k} = ${alias}.${k}`).join(' and ')}`);
            agregar(ac, calc, cols[calc]);
        }
        externasPorNivel[nivel].forEach((e: { tabla: string; condExtra: string | null }) => {
            var ae = `e${++contador}`;
            var cond = claves.map((k: string) => `${ae}.${k} = ${alias}.${k}`);
            if (e.condExtra) cond.push(`${ae}.${e.condExtra}`);
            joins.push(`  left join ${esquemaExt}.${e.tabla} ${ae} on ${cond.join(' and ')}`);
            agregar(ae, e.tabla, colsExt[e.tabla]);
        });
    });
    var aliasRaiz = ALIAS_POR_NIVEL[cadena.length - 1] ?? `n${cadena.length - 1}`;
    joins.push(`  join ${esquema}.tem t on t.operativo = ${aliasRaiz}.operativo and t.enc = ${aliasRaiz}.${raiz.pkAgregada}`);
    agregar('t', 'tem', cols['tem'] ?? []);

    var cierre = opciones.condicionCierre ?? cierrePorDefecto(esquema);
    var rea = opciones.condicionRea ?? reaPorDefecto(esquema);
    for (var extra of ['cerrada', 'rea_positiva']) {
        if (vistas.has(extra)) throw new ErrorDefinicion(`La columna ${extra} ya existe en ${vistas.get(extra)}: no se puede agregar a la vista`);
    }
    select.push(`${cierre} as cerrada`, `${rea} as rea_positiva`);

    var nombre = `${esquema}.${op}_${ua}_plana`;
    var sql = `-- Generada por tabulados/plana.ts. No editar: volver a generar si cambian las tablas o los metadatos.
drop view if exists ${nombre};
create view ${nombre} as
  select ${select.join(',\n         ')}
${joins.join('\n')}
  where ${ALIAS_POR_NIVEL[0]}.operativo = ${q(operativo)};
comment on view ${nombre} is ${q(`Plana de ${ua} del operativo ${operativo}: ${ua}, unidades padre, calculadas, externas y tem. Columnas cerrada y rea_positiva para filtrar.`)};
`;
    return { nombre, sql, repetidas, externasOmitidas };
}

function argumentos(argv: string[]): Record<string, string | true> {
    var r: Record<string, string | true> = {};
    for (var i = 0; i < argv.length; i++) {
        var a = argv[i];
        if (!a.startsWith('--')) continue;
        var siguiente = argv[i + 1];
        if (siguiente !== undefined && !siguiente.startsWith('--')) { r[a.slice(2)] = siguiente; i++; }
        else r[a.slice(2)] = true;
    }
    return r;
}

if (require.main === module) {
    var a = argumentos(process.argv.slice(2));
    var config: ConfigDb = JSON.parse(fs.readFileSync(String(a['config'] ?? 'local-config.json'), 'utf-8'));
    var esquema = String(a['esquema'] ?? 'base');
    var db = ejecutorPsql({ ...config, searchPath: config.searchPath ?? esquema + ',public' });
    var operativo = String(a['operativo'] ?? '');
    if (!operativo) { console.error('Falta --operativo'); process.exit(2); }
    var disc = typeof a['discriminador'] === 'string' ? a['discriminador'].split('=') : null;
    var opciones: OpcionesPlana = {
        operativo, esquema,
        esquemaExterno: typeof a['esquema-externo'] === 'string' ? a['esquema-externo'] : undefined,
        discriminador: disc && disc.length === 2 ? { columna: disc[0], valor: disc[1] } : undefined,
        conJson: a['con-json'] === true
    };
    var uas = typeof a['ua'] === 'string'
        ? [a['ua']]
        : db.consultar(`select unidad_analisis from unidad_analisis where operativo = ${q(operativo)} order by orden, unidad_analisis`)
            .map((f: Fila) => f['unidad_analisis'] ?? '');
    var todo: string[] = [];
    for (var ua of uas) {
        try {
            var v = generarVistaPlana(db, ua, opciones);
            todo.push(v.sql);
            console.error(`✓ ${v.nombre}`);
            v.repetidas.forEach((r) => console.error(`   columna ${r.columna}: se toma de ${r.tomada}, se descarta la de ${r.descartada}`));
            v.externasOmitidas.forEach((e) => console.error(`   externa ${e.tabla} omitida: ${e.motivo}`));
            if (a['crear'] === true) db.consultar(v.sql + '\nselect 1 as ok');
        } catch (e) {
            if (e instanceof ErrorDefinicion) console.error(`✗ ${ua}: ${e.message}`); else throw e;
        }
    }
    var salida = typeof a['salida'] === 'string' ? a['salida'] : null;
    if (salida) fs.writeFileSync(salida, todo.join('\n'), 'utf-8'); else process.stdout.write(todo.join('\n'));
    if (a['crear'] === true) console.error('Vistas creadas.');
}

"use strict";

/*
 * Compara las variables calculadas que generó varcal en dmencu con las que calculó SIEH 1 para los mismos casos.
 * Sirve para validar la migración de varcal (expresiones, null2zero, valores por defecto) caso por caso.
 *
 *   hogares_calculada   <-> plana_s1_  (pla_hog > 0, pla_mie = 0)
 *   personas_calculada  <-> plana_s1_p y plana_i1_ (pla_mie > 0)
 *
 * Toma las calculadas activas del operativo en el destino, busca la columna pla_<variable> en las planas y compara
 * solo los casos que están en el destino (los que copió copiar-casos). Números con tolerancia, texto sin espacios
 * de los costados; null contra null es igual.
 *
 * Uso (misma configuración que copiar-casos):
 *   node dist/comparar-calculadas.js --config local-copia.json [--variable t_ocup] [--ejemplos 5]
 * Escribe salida/calculadas_<base destino>.md y muestra el resumen.
 */

import * as fs from "fs";
import * as path from "path";
import { ejecutorPsql, ConfigDb } from "./psql";
import { Ejecutor, Fila } from "./tipos";

interface Conexion { host: string; port: number; user: string; password: string; database: string; }
interface ConfigComparacion {
    psql: string;
    operativo: string;
    esquemaOrigen?: string;
    esquemaDestino?: string;
    origen: Conexion;
    destino: Conexion;
}

interface Nivel {
    tablaDatos: string;
    claves: string[];                 // claves en dmencu, en orden
    planas: { alias: string; plana: string }[];
    desde: (eo: string, encs: string) => string;
    clavesOrigen: string[];           // expresión en el origen de cada clave (sin operativo)
}

export interface ResultadoVariable {
    tablaDatos: string;
    variable: string;
    columnaOrigen: string | null;
    casos: number;
    iguales: number;
    distintas: number;
    ejemplos: { clave: string; sieh1: string | null; dmencu: string | null }[];
}

const NIVELES: Nivel[] = [
    {
        tablaDatos: 'hogares_calculada',
        claves: ['vivienda', 'hogar'],
        planas: [{ alias: 's', plana: 'plana_s1_' }],
        desde: (eo, encs) => `from ${eo}.plana_s1_ s where s.pla_hog > 0 and s.pla_mie = 0 and s.pla_enc in (${encs})`,
        clavesOrigen: ['s.pla_enc::text', 's.pla_hog::text'],
    },
    {
        tablaDatos: 'personas_calculada',
        claves: ['vivienda', 'hogar', 'persona'],
        planas: [{ alias: 'p', plana: 'plana_s1_p' }, { alias: 'i', plana: 'plana_i1_' }],
        desde: (eo, encs) => `from ${eo}.plana_s1_p p left join ${eo}.plana_i1_ i
            on i.pla_enc = p.pla_enc and i.pla_hog = p.pla_hog and i.pla_mie = p.pla_mie
            where p.pla_mie > 0 and p.pla_enc in (${encs})`,
        clavesOrigen: ['p.pla_enc::text', 'p.pla_hog::text', 'p.pla_mie::text'],
    },
];

function q(s: string): string { return `'${s.replace(/'/g, "''")}'`; }
function qi(s: string): string { return `"${s.replace(/"/g, '""')}"`; }

/** Igualdad de valores como los devuelve psql: números con tolerancia, texto sin espacios de los costados. */
export function mismoValor(a: string | null, b: string | null): boolean {
    if (a === null || b === null) return a === b;
    var ta = a.trim(), tb = b.trim();
    if (ta === tb) return true;
    var na = Number(ta), nb = Number(tb);
    if (ta !== '' && tb !== '' && !isNaN(na) && !isNaN(nb)) return Math.abs(na - nb) <= 1e-6 * Math.max(1, Math.abs(na), Math.abs(nb));
    return false;
}

function columnasDe(db: Ejecutor, esquema: string, tabla: string): Set<string> {
    return new Set(db.consultar(`select column_name from information_schema.columns
        where table_schema = ${q(esquema)} and table_name = ${q(tabla)}`).map((f: Fila) => f['column_name'] ?? ''));
}

export function compararCalculadas(config: ConfigComparacion, opciones: { variable?: string; ejemplos?: number } = {}): ResultadoVariable[] {
    var eo = config.esquemaOrigen ?? 'encu';
    var ed = config.esquemaDestino ?? 'base';
    var op = config.operativo;
    var maxEjemplos = opciones.ejemplos ?? 5;
    var conf = (c: Conexion): ConfigDb => ({ psql: config.psql, ...c, searchPath: 'public' });
    var origen = ejecutorPsql(conf(config.origen));
    var destino = ejecutorPsql(conf(config.destino));
    var resultados: ResultadoVariable[] = [];

    for (var nivel of NIVELES) {
        var td = destino.consultar(`select table_name from ${ed}.tabla_datos where operativo = ${q(op)} and tabla_datos = ${q(nivel.tablaDatos)}`);
        if (!td.length) continue;
        var tablaDestino = td[0]['table_name'] ?? nivel.tablaDatos;
        var vars = destino.consultar(`select variable from ${ed}.variables
            where operativo = ${q(op)} and tabla_datos = ${q(nivel.tablaDatos)} and clase = 'calculada' and activa
            ${opciones.variable ? `and variable = ${q(opciones.variable)}` : ''} order by orden, variable`)
            .map((f: Fila) => f['variable'] ?? '');
        var columnasDestino = columnasDe(destino, ed, tablaDestino);
        vars = vars.filter(v => columnasDestino.has(v));
        if (!vars.length) continue;

        // columna de SIEH 1 de cada variable: la primera plana que tenga pla_<variable>
        var columnasPlanas = nivel.planas.map(p => ({ ...p, columnas: columnasDe(origen, eo, p.plana) }));
        var origenDe = new Map<string, string>();
        for (var v of vars) {
            var p = columnasPlanas.find(p => p.columnas.has('pla_' + v));
            if (p) origenDe.set(v, `${p.alias}.${qi('pla_' + v)}`);
        }

        // casos del destino, con sus valores
        var filasDestino = destino.consultar(`select ${nivel.claves.map(qi).join(', ')}, ${vars.map(qi).join(', ')}
            from ${ed}.${qi(tablaDestino)} where operativo = ${q(op)}`);
        var claveDe = (f: Fila, cols: string[]) => cols.map(c => f[c] ?? '').join('/');
        var destinoPorClave = new Map(filasDestino.map(f => [claveDe(f, nivel.claves), f]));
        var encs = [...new Set(filasDestino.map(f => f['vivienda'] ?? ''))].filter(e => /^-?\d+$/.test(e));

        var filasOrigen: Fila[] = [];
        var conOrigen = vars.filter(v => origenDe.has(v));
        if (encs.length && conOrigen.length) {
            filasOrigen = origen.consultar(`select ${nivel.clavesOrigen.map((e, i) => `${e} as ${qi('k' + i)}`).join(', ')},
                ${conOrigen.map(v => `${origenDe.get(v)}::text as ${qi(v)}`).join(', ')}
                ${nivel.desde(eo, encs.join(', '))}`);
        }
        var clavesK = nivel.claves.map((_, i) => 'k' + i);

        for (var v of vars) {
            var r: ResultadoVariable = { tablaDatos: nivel.tablaDatos, variable: v, columnaOrigen: origenDe.get(v) ?? null, casos: 0, iguales: 0, distintas: 0, ejemplos: [] };
            if (r.columnaOrigen) {
                for (var fo of filasOrigen) {
                    var clave = claveDe(fo, clavesK);
                    var fd = destinoPorClave.get(clave);
                    if (!fd) continue;
                    r.casos++;
                    if (mismoValor(fo[v] ?? null, fd[v] ?? null)) r.iguales++;
                    else {
                        r.distintas++;
                        if (r.ejemplos.length < maxEjemplos) r.ejemplos.push({ clave, sieh1: fo[v] ?? null, dmencu: fd[v] ?? null });
                    }
                }
            }
            resultados.push(r);
        }
    }
    return resultados;
}

function textoInforme(config: ConfigComparacion, rs: ResultadoVariable[]): string {
    var l: string[] = [];
    var conDif = rs.filter(r => r.distintas > 0).sort((a, b) => b.distintas - a.distintas);
    var sinOrigen = rs.filter(r => !r.columnaOrigen);
    var ok = rs.filter(r => r.columnaOrigen && r.distintas === 0);
    l.push(`# Calculadas: ${config.destino.database} contra ${config.origen.database}`, '');
    l.push(`- Variables comparadas: ${rs.length - sinOrigen.length}`);
    l.push(`- Iguales en todos los casos: ${ok.length}`);
    l.push(`- Con diferencias: ${conDif.length}`);
    l.push(`- Sin columna en SIEH 1: ${sinOrigen.length}`, '');
    if (conDif.length) {
        l.push('## Con diferencias', '', '| tabla | variable | casos | distintas | ejemplos (clave: SIEH 1 → dmencu) |', '|---|---|---|---|---|');
        for (var r of conDif) {
            l.push(`| ${r.tablaDatos} | ${r.variable} | ${r.casos} | ${r.distintas} | ${r.ejemplos.map(e => `${e.clave}: ${e.sieh1 ?? 'null'} → ${e.dmencu ?? 'null'}`).join('; ')} |`);
        }
        l.push('');
    }
    if (sinOrigen.length) l.push('## Sin columna en SIEH 1', '', sinOrigen.map(r => `${r.tablaDatos}.${r.variable}`).join(', '), '');
    return l.join('\n');
}

if (require.main === module) {
    var args = process.argv.slice(2);
    var arg = (n: string) => { var i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
    var config: ConfigComparacion = JSON.parse(fs.readFileSync(arg('--config') ?? 'local-copia.json', 'utf8'));
    var ejemplos = arg('--ejemplos');
    var resultados = compararCalculadas(config, { variable: arg('--variable'), ejemplos: ejemplos ? Number(ejemplos) : undefined });
    var texto = textoInforme(config, resultados);
    var carpeta = path.resolve('salida');
    if (!fs.existsSync(carpeta)) fs.mkdirSync(carpeta, { recursive: true });
    fs.writeFileSync(path.join(carpeta, `calculadas_${config.destino.database}.md`), texto, 'utf8');
    console.log(texto);
}

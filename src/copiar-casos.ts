"use strict";

/*
 * Copia los casos de un operativo de SIEH 1 (tablas planas de encu) a una base de dmencu, para probar
 * procesamiento y tabulados con datos reales. SÓLO PARA BASES LOCALES DE PRUEBA: borra los casos del
 * operativo destino antes de copiar y desactiva los triggers mientras carga.
 *
 *   plana_tem_                          -> tem (enc, fexp, dominio, rea, ...) y tareas_tem
 *   plana_tem_ + plana_s1_ (hogar 1)    -> viviendas
 *   plana_s1_ + plana_a1_               -> hogares
 *   plana_s1_p + plana_i1_              -> personas
 *
 * Cada columna del destino se llena con la columna pla_<nombre> de la plana que corresponde, por nombre;
 * no hay listas a mano, salvo los pocos renombres (por ejemplo tem.nrocomuna <- pla_comuna). Las que no tienen equivalente quedan nulas y se informan.
 *
 * Cierre: las encuestas con estado >= 77 quedan con tarea_actual 'proc' y una fila en tareas_tem
 * (proc, V), que es lo que lee la Fuente de tabulados.
 *
 * Datos personales: no se copian columnas de nombres, teléfonos, correos, direcciones ni observaciones
 * (ver EXCLUIR). Los CSV intermedios se borran al terminar salvo con --conservar.
 *
 * Uso:
 *   node dist/copiar-casos.js --config local-copia.json [--conservar] [--solo-informe]
 * local-copia.json:
 *   { "psql": "...psql.exe", "operativo": "pcetoi", "estadoDesde": 77,
 *     "origen":  { "host": "localhost", "port": 5432, "user": "postgres", "password": "...", "database": "etoi262_db" },
 *     "destino": { "host": "localhost", "port": 5432, "user": "postgres", "password": "...", "database": "pcetoi_prueba" } }
 */

import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";
import { ejecutorPsql, ConfigDb } from "./psql";
import { Ejecutor, Fila } from "./tipos";

interface Conexion { host: string; port: number; user: string; password: string; database: string; }
interface ConfigCopia {
    psql: string;
    operativo: string;
    estadoDesde?: number;
    esquemaOrigen?: string;
    esquemaDestino?: string;
    origen: Conexion;
    destino: Conexion;
}

/** Columnas del destino que no se copian (datos personales o texto libre). */
export const EXCLUIR = /^(nombre|nombres|los_nombres|msnombre|nombrer|apellido|l0|movil|movili|telefono|telms|correo|correoi|correoms|codcalle|nomcalle|calle|nrocatastral|piso|departamento|habitacion|domicilio|direccion|observaciones|anotacion)$|tel\d|^tel|correo|mail|nombre|_obs$|^obs|obs_/;

interface Columna { nombre: string; tipo: string; }
interface Fuente { alias: string; plana: string; }
interface Destino {
    tabla: string;
    desde: string;
    fuentes: Fuente[];
    claves: Record<string, string>;
    fijas: Record<string, string>;
    /** Columnas del destino que en SIEH 1 se llaman distinto: destino -> nombre en la plana (sin pla_). */
    renombres?: Record<string, string>;
}

function q(s: string): string { return `'${s.replace(/'/g, "''")}'`; }

function columnas(db: Ejecutor, esquema: string, tabla: string): Columna[] {
    return db.consultar(`select column_name, data_type from information_schema.columns
        where table_schema = ${q(esquema)} and table_name = ${q(tabla)} order by ordinal_position`)
        .map((f: Fila) => ({ nombre: f['column_name'] ?? '', tipo: f['data_type'] ?? '' }));
}

const ENTEROS = ['integer', 'bigint', 'smallint'];
const NUMERICOS = ['numeric', 'double precision', 'real'];
const TEXTOS = ['text', 'character varying', 'character'];

/** Expresión para pasar una columna de la plana al tipo del destino, o null si no se puede sin riesgo. */
export function convertir(expr: string, tipoOrigen: string, tipoDestino: string): string | null {
    if (tipoOrigen === tipoDestino) return expr;
    if (ENTEROS.includes(tipoDestino)) {
        if (ENTEROS.includes(tipoOrigen)) return `${expr}::${tipoDestino}`;
        if (NUMERICOS.includes(tipoOrigen)) return `round(${expr})::${tipoDestino}`;
        if (TEXTOS.includes(tipoOrigen)) return `case when trim(${expr}) ~ '^-?[0-9]+$' then trim(${expr})::${tipoDestino} end`;
        return null;
    }
    if (NUMERICOS.includes(tipoDestino)) {
        if (ENTEROS.includes(tipoOrigen) || NUMERICOS.includes(tipoOrigen)) return `${expr}::${tipoDestino}`;
        if (TEXTOS.includes(tipoOrigen)) return `case when trim(${expr}) ~ '^-?[0-9]+([.][0-9]+)?$' then trim(${expr})::${tipoDestino} end`;
        return null;
    }
    if (TEXTOS.includes(tipoDestino)) return `nullif(${expr}::text, '')`;
    if (tipoDestino === 'boolean' && ENTEROS.includes(tipoOrigen)) return `(${expr} = 1)`;
    if (tipoDestino.startsWith('timestamp') && tipoOrigen.startsWith('timestamp')) return `${expr}::${tipoDestino}`;
    if (tipoDestino === 'date' && tipoOrigen.startsWith('timestamp')) return `${expr}::date`;
    return null;
}

export interface InformeTabla {
    tabla: string;
    filas: number;
    copiadas: string[];
    sinEquivalente: string[];
    excluidas: string[];
    conRestriccion: string[];
    tipoIncompatible: string[];
}

function psqlComando(config: ConfigCopia, con: Conexion, comando: string, carpeta: string): void {
    var r = spawnSync(config.psql, ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-h', con.host, '-p', String(con.port), '-U', con.user, '-d', con.database, '-f', '-'], {
        input: comando + '\n', cwd: carpeta, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
        env: { ...process.env, PGPASSWORD: con.password, PGCLIENTENCODING: 'UTF8' }
    });
    if (r.error) throw r.error;
    if (r.status !== 0) throw new Error((r.stderr || 'psql terminó con código ' + r.status).trim());
}

export function copiarCasos(config: ConfigCopia, opciones: { carpeta: string; conservar?: boolean; soloInforme?: boolean }): InformeTabla[] {
    var eo = config.esquemaOrigen ?? 'encu';
    var ed = config.esquemaDestino ?? 'base';
    var op = config.operativo;
    var estado = config.estadoDesde ?? 77;
    var conf = (c: Conexion): ConfigDb => ({ psql: config.psql, ...c, searchPath: 'public' });
    var origen = ejecutorPsql(conf(config.origen));
    var destino = ejecutorPsql(conf(config.destino));

    var planas: Record<string, Map<string, string>> = {};
    for (var p of ['plana_tem_', 'plana_s1_', 'plana_a1_', 'plana_s1_p', 'plana_i1_']) {
        var cols = columnas(origen, eo, p);
        if (!cols.length) throw new Error(`No existe ${eo}.${p} en la base origen ${config.origen.database}`);
        planas[p] = new Map(cols.map((c: Columna) => [c.nombre, c.tipo]));
    }

    var destinos: Destino[] = [
        {
            tabla: 'tem',
            desde: `from ${eo}.plana_tem_ t where t.pla_hog = 0 and t.pla_mie = 0`,
            fuentes: [{ alias: 't', plana: 'plana_tem_' }],
            claves: { operativo: q(op), enc: 't.pla_enc::text' },
            fijas: { habilitada: 'true', tarea_actual: `case when t.pla_estado >= ${estado} then 'proc' end` },
            // la comuna del marco: comuna en SIEH 1, nrocomuna en el tem de dmencu (las calculadas como zona_3 la usan)
            renombres: { nrocomuna: 'comuna' }
        },
        {
            tabla: 'viviendas',
            desde: `from ${eo}.plana_tem_ t left join ${eo}.plana_s1_ s on s.pla_enc = t.pla_enc and s.pla_hog = 1 and s.pla_mie = 0 where t.pla_hog = 0 and t.pla_mie = 0`,
            fuentes: [{ alias: 's', plana: 'plana_s1_' }, { alias: 't', plana: 'plana_tem_' }],
            claves: { operativo: q(op), vivienda: 't.pla_enc::text' },
            fijas: {}
        },
        {
            tabla: 'hogares',
            // h2, v2, v4 y otras del hogar están en el formulario A1 (plana_a1_), no en el S1
            desde: `from ${eo}.plana_s1_ s left join ${eo}.plana_a1_ a on a.pla_enc = s.pla_enc and a.pla_hog = s.pla_hog and a.pla_mie = 0 where s.pla_hog > 0 and s.pla_mie = 0`,
            fuentes: [{ alias: 's', plana: 'plana_s1_' }, { alias: 'a', plana: 'plana_a1_' }],
            claves: { operativo: q(op), vivienda: 's.pla_enc::text', hogar: 's.pla_hog' },
            fijas: {}
        },
        {
            tabla: 'personas',
            desde: `from ${eo}.plana_s1_p p left join ${eo}.plana_i1_ i on i.pla_enc = p.pla_enc and i.pla_hog = p.pla_hog and i.pla_mie = p.pla_mie where p.pla_mie > 0`,
            fuentes: [{ alias: 'p', plana: 'plana_s1_p' }, { alias: 'i', plana: 'plana_i1_' }],
            claves: { operativo: q(op), vivienda: 'p.pla_enc::text', hogar: 'p.pla_hog', persona: 'p.pla_mie' },
            fijas: {}
        }
    ];

    fs.mkdirSync(opciones.carpeta, { recursive: true });
    var informes: InformeTabla[] = [];
    var cargas: string[] = [];
    for (var d of destinos) {
        var colsDestino = columnas(destino, ed, d.tabla);
        if (!colsDestino.length) throw new Error(`No existe ${ed}.${d.tabla} en la base destino ${config.destino.database}`);
        var inf: InformeTabla = { tabla: d.tabla, filas: 0, copiadas: [], sinEquivalente: [], excluidas: [], conRestriccion: [], tipoIncompatible: [] };
        // columnas con CHECK propios de dmencu (no los de texto vacío): un valor de SIEH 1 fuera de rango haría fallar toda la carga
        var restringidas = new Set(destino.consultar(`
            select distinct a.attname as col from pg_constraint k join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any(k.conkey)
              where k.contype = 'c' and k.conrelid = ${q(ed + '.' + d.tabla)}::regclass and k.conname not like '%<>''''%'`)
            .map((f: Fila) => f['col'] ?? ''));
        var nombres: string[] = [];
        var exprs: string[] = [];
        for (var c of colsDestino) {
            var expr: string | null = null;
            if (d.claves[c.nombre] !== undefined) expr = d.claves[c.nombre];
            else if (d.fijas[c.nombre] !== undefined) expr = d.fijas[c.nombre];
            else if (EXCLUIR.test(c.nombre)) { inf.excluidas.push(c.nombre); continue; }
            else if (restringidas.has(c.nombre)) { inf.conRestriccion.push(c.nombre); continue; }
            else {
                var encontrada = false;
                for (var f of d.fuentes) {
                    var nombreOrigen = d.renombres?.[c.nombre] ?? c.nombre;
                    var tipoOrigen = planas[f.plana].get('pla_' + nombreOrigen);
                    if (tipoOrigen === undefined) continue;
                    encontrada = true;
                    expr = convertir(`${f.alias}.pla_${nombreOrigen}`, tipoOrigen, c.tipo);
                    if (expr === null) inf.tipoIncompatible.push(`${c.nombre} (${tipoOrigen} -> ${c.tipo})`);
                    break;
                }
                if (!encontrada) { inf.sinEquivalente.push(c.nombre); continue; }
                if (expr === null) continue;
                inf.copiadas.push(c.nombre);
            }
            nombres.push(`"${c.nombre}"`);
            exprs.push(`${expr} as "${c.nombre}"`);
        }
        var archivo = `copia_${d.tabla}.csv`;
        var select = `select ${exprs.join(', ')} ${d.desde}`;
        inf.filas = Number(origen.consultar(`select count(*) as n ${d.desde}`)[0]?.['n'] ?? 0);
        informes.push(inf);
        if (opciones.soloInforme) continue;
        psqlComando(config, config.origen, `\\copy (${select}) to '${archivo}' with (format csv, header true)`, opciones.carpeta);
        cargas.push(`\\copy ${ed}.${d.tabla} (${nombres.join(', ')}) from '${archivo}' with (format csv, header true)`);
    }
    if (!opciones.soloInforme) {
        var carga = [
            'begin;',
            "set session_replication_role = replica;",
            ...['personas', 'hogares', 'visitas', 'viviendas', 'tareas_tem', 'tem'].map((t: string) =>
                `delete from ${ed}.${t} where operativo = ${q(op)};`),
            ...cargas,
            `insert into ${ed}.tareas_tem (operativo, enc, tarea, estado)
                select operativo, enc, 'proc', 'V' from ${ed}.tem where operativo = ${q(op)} and tarea_actual = 'proc';`,
            'commit;'
        ].join('\n');
        try {
            psqlComando(config, config.destino, carga, opciones.carpeta);
        } finally {
            if (!opciones.conservar) {
                destinos.forEach((d: Destino) => {
                    var a = path.join(opciones.carpeta, `copia_${d.tabla}.csv`);
                    if (fs.existsSync(a)) fs.unlinkSync(a);
                });
            }
        }
    }
    return informes;
}

function textoInforme(config: ConfigCopia, informes: InformeTabla[], soloInforme: boolean): string {
    var l: string[] = [];
    l.push(`# Copia de casos ${config.origen.database} -> ${config.destino.database} (operativo ${config.operativo})`);
    l.push('');
    l.push(soloInforme ? 'Sólo informe: no se copió nada.' : `Fecha: ${new Date().toISOString()}`);
    l.push('');
    l.push('| Tabla | Filas | Copiadas | Sin equivalente | Excluidas | Con CHECK de dmencu | Tipo incompatible |');
    l.push('| --- | --- | --- | --- | --- | --- | --- |');
    informes.forEach((i: InformeTabla) => l.push(`| ${i.tabla} | ${i.filas} | ${i.copiadas.length} | ${i.sinEquivalente.length} | ${i.excluidas.length} | ${i.conRestriccion.length} | ${i.tipoIncompatible.length} |`));
    informes.forEach((i: InformeTabla) => {
        l.push('', `## ${i.tabla}`, '');
        l.push(`Sin equivalente en las planas (quedan nulas): ${i.sinEquivalente.join(', ') || '—'}`, '');
        l.push(`Excluidas por datos personales: ${i.excluidas.join(', ') || '—'}`, '');
        l.push(`No copiadas por tener un CHECK propio de dmencu: ${i.conRestriccion.join(', ') || '—'}`, '');
        l.push(`Tipo incompatible (quedan nulas): ${i.tipoIncompatible.join(', ') || '—'}`);
    });
    return l.join('\n') + '\n';
}

if (require.main === module) {
    var args = process.argv.slice(2);
    var i = args.indexOf('--config');
    var archivoConfig = i >= 0 ? args[i + 1] : 'local-copia.json';
    var config: ConfigCopia = JSON.parse(fs.readFileSync(archivoConfig, 'utf8'));
    var carpeta = path.resolve('salida');
    var soloInforme = args.includes('--solo-informe');
    var informes = copiarCasos(config, { carpeta, conservar: args.includes('--conservar'), soloInforme });
    var texto = textoInforme(config, informes, soloInforme);
    fs.writeFileSync(path.join(carpeta, `copia_${config.destino.database}.md`), texto, 'utf8');
    console.log(texto);
}

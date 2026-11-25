"use strict";

/*
 * Ejecutor que usa el psql instalado con PostgreSQL. Evita dependencias de npm:
 * el prototipo corre con node y nada más.
 */

import { spawnSync } from "child_process";
import { Ejecutor, Fila } from "./tipos";

export interface ConfigDb {
    psql: string;
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
    searchPath?: string;
}

/** Parser CSV (RFC 4180) para la salida de psql --csv. */
export function parsearCsv(texto: string): string[][] {
    var filas: string[][] = [];
    var fila: string[] = [];
    var campo = '';
    var enComillas = false;
    for (var i = 0; i < texto.length; i++) {
        var ch = texto[i];
        if (enComillas) {
            if (ch === '"') {
                if (texto[i + 1] === '"') { campo += '"'; i++; }
                else enComillas = false;
            } else campo += ch;
        } else if (ch === '"') {
            enComillas = true;
        } else if (ch === ',') {
            fila.push(campo); campo = '';
        } else if (ch === '\n' || ch === '\r') {
            if (ch === '\r' && texto[i + 1] === '\n') i++;
            fila.push(campo); campo = '';
            filas.push(fila); fila = [];
        } else campo += ch;
    }
    if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila); }
    return filas;
}

const MARCA_NULO = '\u0001NULL\u0001';

export function ejecutorPsql(config: ConfigDb): Ejecutor {
    return {
        consultar(sql: string): Fila[] {
            var r = spawnSync(config.psql, [
                '-X', '-q', '--csv', '-v', 'ON_ERROR_STOP=1',
                '-P', 'null=' + MARCA_NULO,
                '-h', config.host, '-p', String(config.port), '-U', config.user, '-d', config.database,
                '-f', '-'
            ], {
                input: sql.trim().replace(/;?\s*$/, ';') + '\n',
                encoding: 'utf8',
                maxBuffer: 512 * 1024 * 1024,
                env: {
                    ...process.env,
                    PGPASSWORD: config.password,
                    PGCLIENTENCODING: 'UTF8',
                    PGOPTIONS: '-c search_path=' + (config.searchPath ?? 'encu,dbo,comun,public')
                }
            });
            if (r.error) throw r.error;
            if (r.status !== 0) {
                throw new Error((r.stderr || 'psql terminó con código ' + r.status).trim());
            }
            var tabla = parsearCsv(r.stdout);
            if (!tabla.length) return [];
            var cab = tabla[0];
            return tabla.slice(1).map((valores: string[]): Fila => {
                var f: Fila = {};
                cab.forEach((c: string, i: number) => {
                    var v = valores[i] ?? null;
                    f[c] = v === MARCA_NULO ? null : v;
                });
                return f;
            });
        }
    };
}

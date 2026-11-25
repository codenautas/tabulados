"use strict";

/*
 * Corre cuadros de SIEH 1 con el motor nuevo y con el oráculo (SQL portado del PHP) sobre una base
 * de operativo restaurada, y compara celda por celda. Sólo escribe resultados agregados.
 *
 *   node dist/comparar.js [--config local-config.json] [--tabla operaciones.tab_etoi261_1]
 *                         [--ids "CUADRO 1z_cortes,CUADRO 2z_cortes"] [--expandido] [--estado 77]
 */

import * as fs from "fs";
import * as path from "path";
import { aCeldas, claveCelda, decimalesDe, generarConsulta } from "./motor";
import { ConfigDb, ejecutorPsql } from "./psql";
import { celdasOraculo, contextoSieh1, etiquetasSieh1, fuenteSieh1, leerDefiniciones, operativoActual, oraculoSieh1 } from "./sieh1";
import { cuadroHtml, esc, Etiquetas } from "./html";
import { Celda, DefinicionCuadro, Ejecutor, ErrorDefinicion, TIPOS_CELDA, UNIDADES } from "./tipos";

interface Argumentos {
    config: string;
    tabla: string;
    ids: string[] | null;
    expandido: boolean;
    estado: number;
    salida: string;
}

function leerArgumentos(argv: string[]): Argumentos {
    var a: Argumentos = { config: 'local-config.json', tabla: 'operaciones.tab_etoi261_1', ids: null, expandido: false, estado: 77, salida: 'salida' };
    for (var i = 0; i < argv.length; i++) {
        var v = argv[i + 1];
        switch (argv[i]) {
            case '--config': a.config = v; i++; break;
            case '--tabla': a.tabla = v; i++; break;
            case '--ids': a.ids = v.split(',').map((s: string) => s.trim()).filter((s: string) => s !== ''); i++; break;
            case '--expandido': a.expandido = true; break;
            case '--estado': a.estado = Number(v); i++; break;
            case '--salida': a.salida = v; i++; break;
            default: throw new Error('Argumento desconocido: ' + argv[i]);
        }
    }
    return a;
}

type Estado = 'igual' | 'distinto' | 'error_motor' | 'error_oraculo' | 'no_soportado';

interface Diferencia {
    clave: string;
    oraculo: string | null;
    motor: string | null;
    nota: string;
}

interface Resultado {
    def: DefinicionCuadro;
    modo: 'muestral' | 'expandido';
    estado: Estado;
    mensaje: string;
    celdasComparadas: number;
    diferencias: Diferencia[];
    html: string;
    segundosMotor: number;
    segundosOraculo: number;
}

function validarDefinicion(def: DefinicionCuadro): string | null {
    if (!TIPOS_CELDA.includes(def.tipo)) return `tipo de celda inválido: "${def.tipo}"`;
    if (!UNIDADES.includes(def.unidad)) return `unidad inválida: "${def.unidad}"`;
    if (!def.fila1) return 'falta fila1';
    return null;
}

function iguales(a: string | null, b: string | null): boolean {
    if (a === null || b === null) return a === b;
    var na = Number(a), nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return Math.abs(na - nb) < 1e-9 * Math.max(1, Math.abs(na));
    return a === b;
}

function explicar(def: DefinicionCuadro, o: string | null, m: string | null): string {
    if (def.tipo === 'tasa' && o !== null && m !== null) {
        var no = Number(o), nm = Number(m);
        if (Number.isInteger(no) && nm >= no && nm - no < 1) return 'SIEH 1 trunca la tasa (división entera)';
    }
    if (o === null) return 'falta en SIEH 1';
    if (m === null) return 'falta en el motor';
    return '';
}

function correrUno(db: Ejecutor, operativo: string, def: DefinicionCuadro, expandido: boolean, estado: number,
    etiquetas: (v: string) => Etiquetas): Resultado {
    var r: Resultado = {
        def, modo: expandido ? 'expandido' : 'muestral', estado: 'igual', mensaje: '',
        celdasComparadas: 0, diferencias: [], html: '', segundosMotor: 0, segundosOraculo: 0
    };
    var invalida = validarDefinicion(def);
    if (invalida) { r.estado = 'no_soportado'; r.mensaje = invalida; return r; }
    var ctx;
    try {
        ctx = contextoSieh1(db, operativo, def, { expandido, estadoDesde: estado });
    } catch (e) {
        r.estado = 'no_soportado'; r.mensaje = (e as Error).message; return r;
    }
    var celdasMotor: Celda[];
    try {
        var t0 = Date.now();
        var consulta = generarConsulta(def, fuenteSieh1(ctx));
        celdasMotor = aCeldas(consulta, db.consultar(consulta.sql));
        r.segundosMotor = (Date.now() - t0) / 1000;
        var dec = decimalesDe(def);
        r.html = cuadroHtml(def, celdasMotor, {
            f1: etiquetas(def.fila1),
            f2: def.fila2 ? etiquetas(def.fila2) : undefined,
            c: def.columna ? etiquetas(def.columna) : undefined
        }, dec, ',', expandido);
    } catch (e) {
        r.estado = e instanceof ErrorDefinicion ? 'no_soportado' : 'error_motor';
        r.mensaje = (e as Error).message;
        return r;
    }
    var celdasOrac: Celda[];
    try {
        var t1 = Date.now();
        celdasOrac = celdasOraculo(def, db.consultar(oraculoSieh1(def, ctx)));
        r.segundosOraculo = (Date.now() - t1) / 1000;
    } catch (e) {
        r.estado = e instanceof ErrorDefinicion ? 'no_soportado' : 'error_oraculo';
        r.mensaje = 'SIEH 1: ' + (e as Error).message;
        return r;
    }
    var motorPorClave = new Map<string, Celda>();
    celdasMotor.forEach((c: Celda) => motorPorClave.set(claveCelda(c), c));
    var vistas = new Set<string>();
    celdasOrac.forEach((o: Celda) => {
        var k = claveCelda(o);
        if (vistas.has(k)) {
            r.diferencias.push({ clave: k, oraculo: o.valor, motor: null, nota: 'SIEH 1 devuelve la celda repetida' });
            return;
        }
        vistas.add(k);
        r.celdasComparadas++;
        var m = motorPorClave.get(k);
        var vm = m ? m.valor : null;
        if (!m || !iguales(o.valor, vm)) {
            r.diferencias.push({ clave: k, oraculo: o.valor, motor: vm, nota: explicar(def, o.valor, vm) });
        }
    });
    if (r.diferencias.length) {
        r.estado = 'distinto';
        var explicadas = r.diferencias.filter((d: Diferencia) => d.nota.startsWith('SIEH 1 trunca')).length;
        r.mensaje = `${r.diferencias.length} de ${r.celdasComparadas} celdas distintas` +
            (explicadas ? ` (${explicadas} por truncamiento de SIEH 1)` : '');
    } else {
        r.mensaje = `${r.celdasComparadas} celdas iguales`;
    }
    return r;
}

function hayFactores(db: Ejecutor): boolean {
    try {
        var f = db.consultar('select count(pla_fexp) as n from plana_tem_');
        return Number(f[0]?.['n'] ?? 0) > 0;
    } catch (_e) {
        return false;
    }
}

function reporteHtml(operativo: string, args: Argumentos, resultados: Resultado[]): string {
    var cuenta = (e: Estado) => resultados.filter((r: Resultado) => r.estado === e).length;
    var filas = resultados.map((r: Resultado, i: number) =>
        `<tr class="${r.estado}"><td><a href="#c${i}">${esc(r.def.id)}</a></td><td>${r.modo}</td><td>${esc(r.def.tipo)}</td>` +
        `<td>${esc(r.def.unidad)}</td><td>${r.estado.replace('_', ' ')}</td><td>${esc(r.mensaje)}</td>` +
        `<td>${r.segundosMotor.toFixed(2)}</td><td>${r.segundosOraculo.toFixed(2)}</td></tr>`).join('\n');
    var detalles = resultados.map((r: Resultado, i: number) => {
        var difs = r.diferencias.length
            ? `<details><summary>${r.diferencias.length} diferencias</summary><table class="difs"><tr><th>fila1|fila2|columna</th><th>SIEH 1</th><th>motor</th><th>nota</th></tr>` +
              r.diferencias.slice(0, 200).map((d: Diferencia) =>
                  `<tr><td>${esc(d.clave)}</td><td>${esc(d.oraculo ?? 'null')}</td><td>${esc(d.motor ?? 'null')}</td><td>${esc(d.nota)}</td></tr>`).join('') +
              '</table></details>'
            : '';
        return `<section id="c${i}"><h3>${esc(r.def.id)} · ${r.modo} · ${r.estado.replace('_', ' ')}</h3>` +
            `<p class="def">${esc(r.def.tipo)} de ${esc(r.def.unidad)} · filas: ${esc(r.def.fila1)}${r.def.fila2 ? ' × ' + esc(r.def.fila2) : ''}` +
            ` · columna: ${esc(r.def.columna ?? '-')} · filtro: ${esc(r.def.filtro ?? '-')}</p>${r.html}${difs}</section>`;
    }).join('\n');
    return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Tabulados ${esc(operativo)}: motor vs SIEH 1</title>
<style>
body{font:14px system-ui,sans-serif;margin:24px;color:#222}
table{border-collapse:collapse;margin:8px 0}td,th{border:1px solid #ccc;padding:3px 8px}
td{text-align:right}th{background:#f4f4f4;text-align:left;font-weight:600}
caption{text-align:left;font-weight:600;padding:4px 0}
tr.igual td:nth-child(5){color:#176f2c}tr.distinto td:nth-child(5){color:#b35c00}
tr.error_motor td:nth-child(5),tr.error_oraculo td:nth-child(5){color:#b00020}tr.no_soportado td:nth-child(5){color:#777}
.def{color:#555}.vacia{background:#fafafa}section{margin-top:28px}
</style></head><body>
<h1>Tabulados ${esc(operativo)}: motor nuevo vs SIEH 1</h1>
<p>Tabla de definiciones: <code>${esc(args.tabla)}</code> · estado desde ${args.estado} · ${new Date().toISOString().substring(0, 19).replace('T', ' ')}</p>
<p>Iguales: <b>${cuenta('igual')}</b> · distintos: <b>${cuenta('distinto')}</b> · error motor: <b>${cuenta('error_motor')}</b> ·
error SIEH 1: <b>${cuenta('error_oraculo')}</b> · no soportados: <b>${cuenta('no_soportado')}</b></p>
<table><tr><th>cuadro</th><th>modo</th><th>tipo</th><th>unidad</th><th>resultado</th><th>detalle</th><th>s motor</th><th>s SIEH 1</th></tr>
${filas}</table>
${detalles}
</body></html>`;
}

function principal(): void {
    var args = leerArgumentos(process.argv.slice(2));
    var config = JSON.parse(fs.readFileSync(args.config, 'utf8')) as ConfigDb;
    var db = ejecutorPsql(config);
    var operativo = operativoActual(db);
    var defs = leerDefiniciones(db, args.tabla, args.ids);
    console.log(`Operativo ${operativo}: ${defs.length} cuadros de ${args.tabla}`);
    var modos: boolean[] = [false];
    if (args.expandido) {
        if (hayFactores(db)) modos.push(true);
        else console.log('Aviso: plana_tem_.pla_fexp está vacío; se corre sólo muestral');
    }
    var cache = new Map<string, Etiquetas>();
    var etiquetas = (v: string): Etiquetas => {
        var e = cache.get(v);
        if (!e) { e = etiquetasSieh1(db, operativo, v); cache.set(v, e); }
        return e;
    };
    var resultados: Resultado[] = [];
    defs.forEach((def: DefinicionCuadro) => {
        modos.forEach((exp: boolean) => {
            var r = correrUno(db, operativo, def, exp, args.estado, etiquetas);
            console.log(`${r.estado.padEnd(13)} ${r.modo.padEnd(9)} ${def.id}: ${r.mensaje}`);
            resultados.push(r);
        });
    });
    fs.mkdirSync(args.salida, { recursive: true });
    var archivo = path.join(args.salida, `reporte-${operativo}.html`);
    fs.writeFileSync(archivo, reporteHtml(operativo, args, resultados), 'utf8');
    fs.writeFileSync(path.join(args.salida, `reporte-${operativo}.json`), JSON.stringify(resultados.map((r: Resultado) => ({
        id: r.def.id, modo: r.modo, estado: r.estado, mensaje: r.mensaje, diferencias: r.diferencias
    })), null, 2), 'utf8');
    console.log('Reporte: ' + archivo);
}

try {
    principal();
} catch (e) {
    console.error((e as Error).message);
    process.exit(1);
}

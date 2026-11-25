"use strict";

/*
 * Todo lo específico de SIEH 1 (base de un operativo restaurada, esquema encu con tablas planas).
 *
 * - contextoSieh1(): reproduce cómo encuestas/proceso_tabulados.php arma el FROM, el filtro
 *   y el ponderador. Lo usan tanto el motor nuevo (vía fuenteSieh1) como el oráculo.
 * - oraculoSieh1(): port LITERAL del SQL que genera el PHP (sin coeficientes de variación,
 *   modalidad "normal", sin "revisar"). Sirve como referencia: si el motor nuevo da lo mismo
 *   que este SQL, da lo mismo que SIEH 1.
 *
 * Fuera de alcance en esta versión: CV, modos de EAH (pla_ext_hog), factores individuales
 * (SAME/UT/VCM), operativos semestrales de ETOI, mediana.
 */

import { agregarPrefijo } from "./prefijo";
import { claveDe } from "./motor";
import { Celda, DefinicionCuadro, Ejecutor, ErrorDefinicion, Fila, Fuente, TOTAL, UNICA } from "./tipos";

const FRASE_TOTAL = '-1234567';

export interface ContextoSieh1 {
    operativo: string;
    junta: string;
    filtro: string;
    ponderador: string | null;
}

export interface OpcionesCorrida {
    expandido: boolean;
    estadoDesde: number;
}

/** Nombre del operativo de la base (dbo.ope_actual()). */
export function operativoActual(db: Ejecutor): string {
    var filas = db.consultar('select dbo.ope_actual() as ope');
    var ope = filas[0]?.['ope'];
    if (!ope) throw new Error('No se pudo obtener dbo.ope_actual()');
    return ope;
}

export function contextoSieh1(db: Ejecutor, operativo: string, def: DefinicionCuadro, opciones: OpcionesCorrida): ContextoSieh1 {
    if (operativo.startsWith('eah')) {
        // EAH >= 2015 usa pla_ext_hog y modos; queda para la fase EAH.
        throw new ErrorDefinicion('Los operativos EAH todavía no están soportados por el comparador');
    }
    if (operativo.startsWith('etoi') && operativo.substring(6, 7) === 's') {
        throw new ErrorDefinicion('Los operativos semestrales de ETOI todavía no están soportados');
    }
    var vh = db.consultar(`
        select distinct lower('plana_'||blo_for||'_') as tabla_vh,
               case when blo_for='A1' then 'inner join plana_s1_ as s1 on a.pla_enc=s1.pla_enc and a.pla_hog=s1.pla_hog' else '' end as join_vh
          from encu.bloques
          where blo_ope=dbo.ope_actual() and blo_blo in ('Viv', 'Hog','SM1.1') and blo_mat=''`)[0];
    var tablaVh = vh?.['tabla_vh'] ?? 'plana_s1_';
    var joinVh = vh?.['join_vh'] ?? '';
    var valcan = (operativo.startsWith('eah') || operativo.startsWith('etoi'))
        ? ` left join valcan vc on vc.pla_ope='${operativo}'` : '';
    var junta: string;
    switch (def.unidad) {
        case 'personas':
            junta = `
                        from plana_s1_p s1_p
                          inner join plana_i1_ i1 on s1_p.pla_enc=i1.pla_enc and s1_p.pla_hog=i1.pla_hog and s1_p.pla_mie=i1.pla_mie
                          inner join plana_s1_ s1 on s1.pla_enc=i1.pla_enc and s1.pla_hog=i1.pla_hog and s1.pla_mie=0
                          inner join plana_tem_ t on t.pla_enc=i1.pla_enc and t.pla_hog=0 and s1.pla_mie=0
                          ${valcan}
`;
            break;
        case 'hogares':
            junta = `
                        from ${tablaVh} a
                          ${joinVh}
                          inner join plana_tem_ t on a.pla_enc=t.pla_enc
                          ${valcan}
`;
            break;
        case 'viviendas':
            junta = `
                        from ${tablaVh} a
                          inner join plana_tem_ t on a.pla_enc=t.pla_enc
                          ${valcan}
`;
            break;
    }
    var filtroRea = operativo === 'colon2015' ? ' ' : ' AND rea not in (0,2) ';
    var filtroGeneral = 'estado>=' + opciones.estadoDesde + filtroRea;
    if (def.unidad !== 'viviendas') {
        filtroGeneral = filtroGeneral + ' AND entrea <> 4 ';
    }
    var filtro: string;
    if (!def.filtro) {
        filtro = agregarPrefijo(filtroGeneral, 'pla_');
    } else {
        filtro = agregarPrefijo(def.filtro + ' AND ' + filtroGeneral, 'pla_');
        filtro = def.unidad === 'viviendas'
            ? filtro.replace(/\bpla_(hog|enc)\b/g, 'a.pla_$1')
            : filtro.replace(/\bpla_(hog|enc)\b/g, 's1.pla_$1');
        filtro = filtro.replace(/\bpla_mie\b/g, 'i1.pla_mie');
    }
    return { operativo, junta, filtro, ponderador: opciones.expandido ? 'pla_fexp' : null };
}

/** Fuente para el motor nuevo sobre una base SIEH 1: mismas tablas y filtros que el PHP. */
export function fuenteSieh1(ctx: ContextoSieh1): Fuente {
    return {
        desde: ctx.junta,
        donde: ctx.filtro,
        ponderador: ctx.ponderador,
        expresion: (variable: string) => 'pla_' + variable
    };
}

function decimalesSieh1(def: DefinicionCuadro): number {
    if (def.decimales !== null) return def.decimales;
    if (def.tipo === 'promedio' || def.tipo === 'suma') {
        throw new ErrorDefinicion(`SIEH 1 no genera ${def.tipo} sin decimales definidos`);
    }
    return 1;
}

/** Port literal del SQL de proceso_tabulados.php (ver encabezado). */
export function oraculoSieh1(def: DefinicionCuadro, ctx: ContextoSieh1): string {
    if (def.tipo === 'mediana') throw new ErrorDefinicion('Mediana: no portada todavía');
    if (!def.columna) throw new ErrorDefinicion('SIEH 1: todavía no está preparado para tabulados sin columnas');
    var FT = FRASE_TOTAL;
    var DEC = decimalesSieh1(def);
    var expandido = ctx.ponderador !== null;
    var fexp = ctx.ponderador ?? '';
    var junta = ctx.junta;
    var filtro = ctx.filtro;
    var f1 = 'pla_' + def.fila1;
    var f2 = def.fila2 ? 'pla_' + def.fila2 : null;
    var col = 'pla_' + def.columna;
    var camposFila = f2 ? [f1, f2] : [f1];
    var cantidadComun = expandido ? `sum(${fexp})` : 'count(*)';

    if (def.tipo === 'tasa') {
        var filasx = (f2 ? 'x.' + f2 + ', ' : '') + 'x.' + f1;
        var filas = (f2 ? f2 + ', ' : '') + f1;
        var resto = ' ) x) y where y.' + col + ' > 0)';
        var origen = expandido
            ? `
                        round((y.pla_cantidad*100 / y.pla_total)::numeric,${DEC}) as pla_cantidad  from
                          (SELECT x.${col}, ${filasx}, x.pla_cantidad, sum(x.pla_cantidad) OVER (PARTITION BY ${filasx}) as pla_total
                              FROM (select ${col}, ${filas}, sum(${fexp})
`
            : `
                        round((y.pla_cantidad*100 / y.pla_total)::numeric,${DEC}) as pla_cantidad from (SELECT x.${col}, ${filasx}, x.pla_cantidad, sum(x.pla_cantidad)  OVER (PARTITION BY ${filasx}) as pla_total FROM
(select ${col}, ${filas}, count(*)  `;
        var camposSelect = [...camposFila, origen + ' as pla_cantidad'];
        var groupBy = [col, ...(f2 ? [f2] : []), f1];
        var orderBy = [f1, ...(f2 ? [f2] : [])];
        var principio: string;
        if (expandido) {
            principio = `select 'TASA' as pla_tasa, ${FT} as ${camposFila.join(',' + FT + ' as ')}, round(sum(case when ${col}>0 then ${fexp} else 0 end)*100/sum(${fexp})::numeric,${DEC}) as pla_cantidad  ${junta} WHERE ${filtro}\n UNION \n`;
            if (f2) {
                var parte = (izq: boolean, campoGroupBy: string): string => {
                    var totalIzq = izq ? `${FT} as ` : '';
                    var totalDer = izq ? '' : `${FT} as `;
                    var xeroIzq = izq ? '0 as ' : 'x.';
                    var xeroDer = izq ? 'x.' : '0 as ';
                    var ceroIzq = izq ? '0 as ' : '';
                    var ceroDer = izq ? '' : '0 as ';
                    return `\n(select 'TASA' as pla_tasa` +
                        `\n, ${totalIzq} ${f1}` +
                        `\n, ${totalDer} ${f2}` +
                        `\n , round((y.pla_cantidad *100 / y.pla_total)::numeric,${DEC}) as pla_cantidad ` +
                        `\n from (` +
                        `\n   SELECT x.${col}` +
                        `\n    , ${xeroIzq}${f1}` +
                        `\n    , ${xeroDer}${f2}` +
                        `\n    , x.pla_cantidad` +
                        `\n    , sum(x.pla_cantidad) OVER (PARTITION BY x.${campoGroupBy}) as pla_total ` +
                        `\n      FROM (select ${col}` +
                        `\n              , ${ceroIzq}${f1}` +
                        `\n              , ${ceroDer}${f2}` +
                        `\n              , sum(${fexp}) as pla_cantidad ` +
                        `\n               ${junta} WHERE ${filtro}` +
                        `\n               group by ${col}, ${campoGroupBy}` +
                        `\n            ) x) y where y.${col} > 0 ) \n UNION `;
                };
                principio += parte(false, f1);
                principio += parte(true, f2);
            }
        } else {
            principio = `select 'TASA' as pla_tasa, '${FT}' as ${camposFila.join(',' + FT + ' as ')}, round(sum(case when ${col}>0 then 1 else 0 end)*100/count(coalesce(${col},1))::numeric,${DEC}) as pla_cantidad ${junta} WHERE ${filtro} UNION `;
            if (f2) {
                principio += `(select 'TASA' as pla_tasa, ${f1}, ${FT} as ${f2}, round((y.pla_cantidad*100 / y.pla_total)::numeric,${DEC}) as pla_cantidad from (SELECT x.${col}, 0 as ${f2}, x.${f1}, x.pla_cantidad, sum(x.pla_cantidad) OVER (PARTITION BY x.${f1}) as pla_total FROM (select ${col}, 0 as ${f2}, ${f1}, count(*) as pla_cantidad ${junta} WHERE ${filtro} group by ${col}, ${f1} ) x) y where y.${col} > 0 ) \n UNION `;
                principio += `(select 'TASA' as pla_tasa, ${FT} as ${f1}, ${f2}, round((y.pla_cantidad*100 / y.pla_total)::numeric,${DEC}) as pla_cantidad from (SELECT x.${col}, x.${f2}, 0 as ${f1}, x.pla_cantidad, sum(x.pla_cantidad) OVER (PARTITION BY x.${f2}) as pla_total FROM (select ${col}, ${f2}, 0 as ${f1}, count(*) as pla_cantidad ${junta} WHERE ${filtro} group by ${col}, ${f2} ) x) y where y.${col} > 0 ) \n UNION `;
            }
        }
        return principio + `(select 'TASA' as pla_tasa, ` + camposSelect.join(',') + junta +
            '\n WHERE ' + filtro +
            '\n GROUP BY ' + groupBy.join(',') +
            resto +
            '\n ORDER BY ' + orderBy.join(' nulls first,') + ' nulls first ';
    }

    if (def.tipo === 'promedio' || def.tipo === 'suma') {
        var etiqueta = def.tipo === 'promedio' ? 'PROMEDIO' : 'SUMA';
        var alias = def.tipo === 'promedio' ? 'pla_promedio' : 'pla_suma';
        var expr = def.tipo === 'promedio'
            ? (expandido ? `round(sum(${col}::numeric*${fexp})/sum(${fexp})::numeric,${DEC})` : `round(avg(${col})::numeric,${DEC})`)
            : (expandido ? `round(sum(${col}::numeric *${fexp})::numeric,${DEC})` : `round(sum(${col})::numeric,${DEC})`);
        var principioPS = `select '${etiqueta}' as ${alias}, ${FT} as ${camposFila.join(',' + FT + ' as ')}, ${expr} as pla_cantidad ${junta} WHERE ${filtro} UNION `;
        return principioPS + ` select '${etiqueta}' as ${alias}, ` + [...camposFila, expr + ' as pla_cantidad'].join(',') + junta +
            '\n WHERE ' + filtro +
            '\n GROUP BY ' + camposFila.join(',') +
            '\n ORDER BY ' + camposFila.join(' nulls first,') + ' nulls first';
    }

    // comun y frecuencia
    var esFrecuenciaRotulo = def.tipo === 'frecuencia' && (def.columna === 'mie' || def.columna === 'hog');
    var rotulo = def.columna === 'mie' ? 'PERSONAS'
        : (def.columna === 'hog' && def.unidad === 'viviendas') ? 'VIVIENDAS'
        : def.columna === 'hog' ? 'HOGARES' : null;
    var camposSel: string[] = [...camposFila];
    var groupByC: string[] = [...camposFila];
    if (!esFrecuenciaRotulo) {
        camposSel.push(col);
        groupByC.push(col);
    }
    camposSel.push(cantidadComun + ' as pla_cantidad');
    var sqlColumnas = rotulo ? `select '${rotulo}' as pla_frecuencia ` : `select distinct ${col} ${junta}\n WHERE ${filtro} order by 1`;
    var cuerpoInicio = rotulo ? `select '${rotulo}' as pla_frecuencia, ` : 'select ';
    var cuerpo = cuerpoInicio + camposSel.join(',') + junta +
        '\n WHERE ' + filtro +
        '\n GROUP BY ' + groupByC.join(',') +
        '\n ORDER BY ' + groupByC.join(' nulls first,') + ' nulls first';
    var desde = ' from (';
    var tp: string, tt: string;
    var tpinter = '', tpinter2 = '';
    if (f2) {
        tp = `select ${FT} as ${f1} , ${FT} as ${f2} , ${col} ,sum(pla_cantidad) as pla_cantidad ` + desde;
        tt = `select ${FT} as ${f1} , ${FT} as ${f2} , ${FT} as ${col} ,sum(pla_cantidad) as pla_cantidad ` + desde;
        tpinter = `select ${FT} as ${f1} , ${f2} , ${col} ,sum(pla_cantidad) as pla_cantidad ` + desde + cuerpo + `) x group by ${f2} ,${col}\n union `;
        tpinter2 = `select ${f1} , ${FT} as ${f2} , ${col} ,sum(pla_cantidad) as pla_cantidad ` + desde + cuerpo + `) x group by ${f1} ,${col}\n union `;
    } else if (def.tipo === 'frecuencia') {
        var inicio = 'select ' + sqlColumnas.replace(/\bselect\b/, '') + ' , ';
        tp = '';
        tt = inicio + ` ${FT}. as ${f1} ,sum(pla_cantidad) as pla_cantidad ` + desde;
    } else {
        tp = `select ${FT} as ${f1} , ${col} ,sum(pla_cantidad) as pla_cantidad ` + desde;
        tt = `select ${FT} as ${f1} , ${FT} as ${col} ,sum(pla_cantidad) as pla_cantidad ` + desde;
    }
    if (def.tipo === 'comun') {
        tp = tp + cuerpo + `) x group by  ${col}\n UNION `;
    }
    tt = tt + cuerpo + ') x \n UNION ';
    return f2 ? tt + tp + tpinter + tpinter2 + cuerpo : tt + tp + cuerpo;
}

/** Convierte la salida del oráculo en celdas comparables con las del motor. */
export function celdasOraculo(def: DefinicionCuadro, filas: Fila[]): Celda[] {
    var columnaDimension = def.tipo === 'comun' || (def.tipo === 'frecuencia' && def.columna !== 'mie' && def.columna !== 'hog');
    var coord = (v: string | null | undefined): string => {
        if (v === undefined) return TOTAL;
        var k = claveDe(v);
        return k === FRASE_TOTAL ? TOTAL : k;
    };
    return filas.map((f: Fila): Celda => ({
        f1: coord(f['pla_' + def.fila1]),
        f2: def.fila2 ? coord(f['pla_' + def.fila2]) : TOTAL,
        c: columnaDimension ? coord(f['pla_' + def.columna]) : UNICA,
        valor: f['pla_cantidad'] ?? null
    }));
}

/** Lee definiciones desde una tabla con la estructura de encu.tabulados (o sus copias de tanda). */
export function leerDefiniciones(db: Ejecutor, tabla: string, ids: string[] | null): DefinicionCuadro[] {
    if (!/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/.test(tabla)) {
        throw new Error('Nombre de tabla inválido: ' + tabla);
    }
    var donde = ids && ids.length
        ? ' where tab_tab in (' + ids.map((i: string) => `'${i.replace(/'/g, "''")}'`).join(',') + ')'
        : '';
    var filas = db.consultar(`select tab_tab, tab_titulo, tab_fila1, tab_fila2, tab_columna, tab_cel_exp, tab_cel_tipo,
            tab_filtro, tab_decimales, tab_grupo from ${tabla}${donde} order by tab_tab`);
    return filas.map((f: Fila): DefinicionCuadro => ({
        id: f['tab_tab'] ?? '',
        titulo: f['tab_titulo'] ?? '',
        fila1: (f['tab_fila1'] ?? '').trim(),
        fila2: f['tab_fila2'] ? f['tab_fila2'].trim() : null,
        columna: f['tab_columna'] ? f['tab_columna'].trim() : null,
        unidad: ((f['tab_cel_exp'] ?? '').trim()) as DefinicionCuadro['unidad'],
        tipo: ((f['tab_cel_tipo'] ?? '').trim()) as DefinicionCuadro['tipo'],
        filtro: f['tab_filtro'] && f['tab_filtro'].trim() ? f['tab_filtro'] : null,
        decimales: f['tab_decimales'] !== null && f['tab_decimales'] !== undefined ? Number(f['tab_decimales']) : null,
        grupo: f['tab_grupo'] ?? null
    }));
}

/** Etiquetas de las categorías de una variable (variables/opciones o varcal/varcalopc). */
export function etiquetasSieh1(db: Ejecutor, operativo: string, variable: string): { titulo: string; opciones: Map<string, string> } {
    var opciones = new Map<string, string>();
    var v = variable.replace(/'/g, "''");
    var o = operativo.replace(/'/g, "''");
    try {
        var vars = db.consultar(`select var_texto, var_conopc from encu.variables where var_ope='${o}' and var_var='${v}'`);
        if (vars.length) {
            var conopc = (vars[0]['var_conopc'] ?? '').replace(/'/g, "''");
            db.consultar(`select opc_opc, opc_texto from encu.opciones where opc_ope='${o}' and opc_conopc='${conopc}'`)
                .forEach((f: Fila) => opciones.set(claveDe(f['opc_opc']), (f['opc_texto'] ?? '').split('?')[0]));
            return { titulo: (vars[0]['var_texto'] ?? variable).trim() || variable, opciones };
        }
        var vc = db.consultar(`select varcal_nombre from encu.varcal where varcal_ope='${o}' and varcal_varcal='${v}'`);
        db.consultar(`select varcalopc_opcion, varcalopc_etiqueta from encu.varcalopc where varcalopc_ope='${o}' and varcalopc_varcal='${v}'`)
            .forEach((f: Fila) => opciones.set(claveDe(f['varcalopc_opcion']), f['varcalopc_etiqueta'] ?? ''));
        return { titulo: vc.length ? (vc[0]['varcal_nombre'] ?? variable) : variable, opciones };
    } catch (_e) {
        return { titulo: variable, opciones };
    }
}

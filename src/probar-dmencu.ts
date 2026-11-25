"use strict";
import { ejecutorPsql } from "./psql";
import { generarConsulta, aCeldas } from "./motor";
import { fuenteDmencu } from "./dmencu";
import { DefinicionCuadro } from "./tipos";

const db = ejecutorPsql({ psql: 'psql', host: '/tmp', port: 5499, user: 'postgres', password: 'x', database: 'pcetoi_replica', searchPath: 'base,public' });
const def = (o: Partial<DefinicionCuadro>): DefinicionCuadro => ({ id: 't', titulo: 't', fila1: 'sexo', fila2: null, columna: 'cond_activ', unidad: 'personas', tipo: 'comun', filtro: 'edad>=14', decimales: 1, grupo: null, ...o });
for (const expandido of [false, true]) {
    const d = def({});
    const f = fuenteDmencu(db, d, { operativo: 'pcetoi', esquema: 'base', expandido });
    const q = generarConsulta(d, f);
    const celdas = aCeldas(q, db.consultar(q.sql));
    console.log(expandido ? 'EXPANDIDO' : 'MUESTRAL', JSON.stringify(f.resoluciones));
    console.log(celdas.filter(c => c.f2 === 'T').map(c => `${c.f1}|${c.c}=${c.valor}`).join('  '));
}
// tasa por hogar usando calculada de hogares
const d2 = def({ unidad: 'hogares', fila1: 'zona_3', columna: 'zona_3', filtro: null, tipo: 'comun' });
const f2 = fuenteDmencu(db, d2, { operativo: 'pcetoi', esquema: 'base', expandido: false });
console.log(JSON.stringify(aCeldas(generarConsulta(d2, f2), db.consultar(generarConsulta(d2, f2).sql)).slice(0, 4)));

"use strict";
import { ejecutorPsql } from "./psql";
import { generarConsulta, aCeldas } from "./motor";
import { fuenteDmencu } from "./dmencu";
import { DefinicionCuadro } from "./tipos";
const db = ejecutorPsql({ psql: 'psql', host: '/tmp', port: 5499, user: 'postgres', password: 'x', database: 'pcetoi_replica', searchPath: 'base,public' });
const d: DefinicionCuadro = { id: 't', titulo: 't', fila1: 'zona_3', fila2: null, columna: 'quintil', unidad: 'hogares', tipo: 'comun', filtro: null, decimales: 1, grupo: null };
for (const origen of ['eah', 'etoi']) {
    const f = fuenteDmencu(db, d, { operativo: 'pcetoi', esquema: 'base', expandido: true, discriminador: { columna: 'origen', valor: origen } });
    const q = generarConsulta(d, f);
    const c = aCeldas(q, db.consultar(q.sql));
    console.log(origen, JSON.stringify(f.resoluciones), c.filter(x => x.f1 === 'T').map(x => `${x.c}=${x.valor}`).join(' '));
}

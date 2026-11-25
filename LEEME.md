# tabulados (prototipo)

Motor de cuadros estadísticos (tabulados) para migrar el procesamiento de SIEH 1 a dmencu.
Diseño completo: documento "Procesamiento SIEH 1 → dmencu: análisis y diseño".

Esta versión es un prototipo para validar el motor contra SIEH 1. No se integra todavía con
dmencu ni con backend-plus, y no tiene repositorio git.

## Qué hace

Sobre una base de operativo de SIEH 1 restaurada, toma definiciones de cuadros
(`encu.tabulados` o sus copias por tanda, por ejemplo `operaciones.tab_etoi261_1`) y para cada una:

1. Genera el cuadro con el **motor nuevo** (`src/motor.ts`): una sola consulta con `GROUP BY CUBE`.
2. Genera el mismo cuadro con el **oráculo** (`src/sieh1.ts`, `oraculoSieh1`): port literal del SQL
   que arma `encuestas/proceso_tabulados.php`.
3. Compara celda por celda y escribe `salida/reporte-<operativo>.html` (cuadros + diferencias) y un `.json`.

Sólo se escriben resultados agregados: no se exportan microdatos.

## Requisitos

- Node 20 o superior. No hace falta `npm install` para correrlo: `dist/` ya está compilado.
- PostgreSQL 16 instalado (se usa su `psql.exe`).

## Paso 1: restaurar la base de ETOI

```
set PGBIN=C:\Program Files\PostgreSQL\16\bin
"%PGBIN%\createdb.exe" -U postgres etoi262_local
"%PGBIN%\pg_restore.exe" -U postgres -d etoi262_local --no-owner --no-privileges C:\Users\GCBA\Desktop\etoi262_produc_db_260804.backup
```

Puede mostrar errores por roles o extensiones que no existen en tu máquina. No importan
mientras se carguen las tablas de `encu` y la función `dbo.ope_actual()`.

## Paso 2: configurar

`local-config.json` (no se versiona):

```json
{
  "psql": "C:\\Program Files\\PostgreSQL\\16\\bin\\psql.exe",
  "host": "localhost",
  "port": 5432,
  "user": "postgres",
  "password": "...",
  "database": "etoi262_local"
}
```

## Paso 3: correr

```
cd C:\npm\tabulados
node dist\comparar.js --expandido
```

Por defecto corre los 19 cuadros de la tanda 1 (`operaciones.tab_etoi261_1`). Opciones:

| Opción | Uso |
| --- | --- |
| `--tabla encu.tabulados` | Tabla de definiciones (cualquier tabla con la estructura de `encu.tabulados`) |
| `--ids "CUADRO 1z_cortes,CUADRO 2z_cortes"` | Sólo esos cuadros |
| `--expandido` | Además del muestral, corre expandido (si `plana_tem_.pla_fexp` tiene datos) |
| `--estado 77` | Estado mínimo de las encuestas (igual que en SIEH 1) |
| `--config` / `--salida` | Otro archivo de configuración / otra carpeta de salida |

Para el catálogo completo de ETOI (3.684 cuadros): `node dist\comparar.js --tabla encu.tabulados --expandido`.
Tarda: cada cuadro se calcula dos veces.

## Estado de la prueba

Probado con una base sintética que copia la estructura y los tipos de las planas de `etoi262`
(1.500 encuestas, 5.538 personas) y los 19 cuadros reales de la tanda 1:

- Los 19 cuadros dan **exactamente lo mismo** que el SQL de SIEH 1, muestrales y expandidos.
- También coinciden casos agregados: promedio y suma con dos filas, cuadros de hogares, filtros que mencionan `hog`.
- Una verificación manual de una tasa coincide, y una alteración deliberada del motor se detecta.

Falta correrlo contra la base real: ese es el paso 3.

## Diferencias conocidas con SIEH 1

- **Frecuencia con dos variables de fila**: el SQL de SIEH 1 es inválido (error de sintaxis). No hay cuadros así en ETOI 262.
- **Promedio**: SIEH 1 expandido divide por la suma de factores de todos los casos, también los que tienen la variable nula;
  muestral usa `avg()`, que ignora nulos. El motor reproduce ambas cosas para poder comparar. Hay que confirmar con
  procesamiento cuál es el criterio correcto.
- **Tipos o unidades mal escritos** (`común`, ` comun`, `oersonas`): el comparador los marca como no soportados.

## No soportado todavía

- Mediana (muestral está en el motor, sin comparar; expandida pendiente de leer `dbo.mediana_expandida`).
- Coeficientes de variación, modos de EAH (`pla_ext_hog`), factores individuales (SAME, UT, VCM), ETOI semestral.
- Completar categorías sin casos (hoy la celda queda vacía).

## Estructura

| Archivo | Contenido |
| --- | --- |
| `src/tipos.ts` | Tipos: definición de cuadro, fuente de datos, celdas |
| `src/motor.ts` | Motor genérico: arma el SQL con `GROUP BY CUBE` a partir de una `Fuente` |
| `src/sieh1.ts` | Fuente sobre base SIEH 1, oráculo (port del PHP), lectura de definiciones y etiquetas |
| `src/prefijo.ts` | Port de `expresion_regular_agregar_prefijo()` (prefijo `pla_` en filtros) |
| `src/psql.ts` | Ejecuta SQL con `psql --csv`, sin dependencias de npm |
| `src/html.ts` | Dibuja el cuadro |
| `src/comparar.ts` | Programa de comparación y reporte |
| `src/dmencu.ts` | Fuente sobre dmencu: unidad + padres + `_calculada` + externas + `tem`, cierre y ponderador |
| `src/plana.ts` | Genera las vistas `<operativo>_<ua>_plana` de dmencu |
| `src/probar-dmencu*.ts` | Pruebas de la Fuente de dmencu sobre la base sintética (`scripts/seed-dmencu*.sql`) |

Para recompilar: `npm install` y `npm run build`.

## dmencu

### Fuente (`src/dmencu.ts`)

Arma el FROM de un cuadro desde los metadatos (`unidad_analisis`, `tabla_datos`, `information_schema`), sin nombres fijos:
la unidad del cuadro, sus unidades padre, la `<operativo>_<ua>_calculada` de cada una, las tablas externas
(`tabla_datos.tipo = 'externa'`, mismo esquema que el operativo salvo que se indique otro) y `tem`.
Cada variable se busca en ese orden y se toma la primera tabla que la tiene.

- Cierre (el "estado >= 77" de SIEH 1): tarea `proc` en estado `V` en `tareas_tem`, y `rea` de `tem` con `es_positiva` en la tabla `rea`.
- Ponderador: `tem.fexp`.
- Externas: se unen sólo si el cuadro usa una de sus variables. Si tienen varias filas por clave (EAH con ETOI como
  submuestra) hay que indicar el `discriminador` (columna y valor); si no, da error en vez de duplicar casos.

### Vistas planas (`src/plana.ts`)

Una vista por unidad de análisis, `<esquema>.<operativo>_<ua>_plana`, con las mismas uniones que la Fuente y dos columnas
para filtrar: `cerrada` y `rea_positiva`. Sin columnas json (agregar `--con-json` si hacen falta).

```cmd
node dist\plana.js --config local-config.json --operativo pcetoi --esquema base --salida salida\planas_pcetoi.sql
node dist\plana.js --config local-config.json --operativo pcetoi --esquema base --crear
node dist\plana.js --config local-config.json --operativo eah2026 --esquema base --discriminador origen=etoi --crear
```

Sin `--crear` sólo escribe el SQL. Informa las columnas con el mismo nombre en dos tablas (queda la primera) y las
externas que no pudo unir. Hay que volver a generarlas si cambian las tablas o los metadatos.

Probado sólo en una base sintética con la estructura de `pcetoi_db`: los totales de la vista coinciden con los de la Fuente.
Falta probar con datos reales de dmencu.

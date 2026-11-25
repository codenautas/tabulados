@echo off
setlocal
rem Extrae la ESTRUCTURA y los METADATOS de una base de dmencu. No saca datos de encuestas.
rem Uso:  extraer-estructura-dmencu.bat [base]     (por defecto pcetoi_db)
set "PGBIN=C:\Program Files\PostgreSQL\16\bin"
set PGHOST=localhost
set PGPORT=5432
set PGUSER=postgres
set PGPASSWORD=admin1234
set DB=%1
if "%DB%"=="" set DB=pcetoi_db
set "OUT=%~dp0..\salida\dmencu_%DB%"
if not exist "%OUT%" mkdir "%OUT%"
set "OUTF=%OUT:\=/%"
set PGOPTIONS=-c search_path=base,public,comun,dbo,encu
set PSQL="%PGBIN%\psql.exe" -d %DB% -X -q

echo [1/5] esquemas y tablas...
%PSQL% -c "\dn" > "%OUT%\01_esquemas.txt" 2>&1
%PSQL% -A -F ";" -c "select table_schema, table_name, (select count(*) from information_schema.columns c where c.table_schema=t.table_schema and c.table_name=t.table_name) as columnas from information_schema.tables t where table_type='BASE TABLE' and table_schema not in ('pg_catalog','information_schema') order by 1,2" > "%OUT%\02_tablas.csv" 2>&1

echo [2/5] tablas calculadas (si varcal ya las genero)...
%PSQL% -A -F ";" -c "select table_schema, table_name from information_schema.tables where table_name like '%%calculada' order by 1,2" > "%OUT%\03_tablas_calculada.csv" 2>&1

echo [3/5] estructura completa (sin datos)...
"%PGBIN%\pg_dump.exe" -d %DB% --schema-only --no-owner --no-privileges -f "%OUT%\04_estructura.sql" 2> "%OUT%\errores.txt"

echo [4/5] metadatos (definiciones, no datos de encuestas)...
for %%T in (operativos unidad_analisis tabla_datos variables variables_opciones relaciones rel_vars tareas estados tareas_proximas) do (
  %PSQL% -c "\copy (select * from %%T) to '%OUTF%/meta_%%T.csv' csv header" 2>> "%OUT%\errores.txt"
)

echo [5/5] conteos agregados (sin datos personales)...
%PSQL% -A -F ";" -c "select tarea, estado, count(*) from tareas_tem group by 1,2 order by 1,2" > "%OUT%\05_tareas_estados.csv" 2>&1
%PSQL% -A -F ";" -c "select clase, count(*) from variables group by 1 order by 1" > "%OUT%\06_variables_por_clase.csv" 2>&1
%PSQL% -A -F ";" -c "select schemaname, relname, n_live_tup from pg_stat_user_tables order by 1,2" > "%OUT%\07_filas_aprox.csv" 2>&1

echo.
echo Listo. Resultados en: %OUT%
echo Si algun archivo trae un error de "no existe la relacion", es normal: avisame cual.
pause

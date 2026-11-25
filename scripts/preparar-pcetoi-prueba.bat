@echo off
rem Prepara pcetoi_prueba para cargar casos: columnas nuevas, tabla_datos, relaciones y estructura.
rem Uso: preparar-pcetoi-prueba.bat [base]   (por defecto pcetoi_prueba)
rem Deja todo lo que imprime en ..\salida\preparar_<base>.log
setlocal
set PGBIN=C:\Program Files\PostgreSQL\16\bin
set PGHOST=localhost
set PGPORT=5432
set PGUSER=postgres
if "%PGPASSWORD%"=="" set PGPASSWORD=admin1234
set DB=%1
if "%DB%"=="" set DB=pcetoi_prueba
set LOG=%~dp0..\salida\preparar_%DB%.log
if not exist "%~dp0..\salida" mkdir "%~dp0..\salida"

echo === 1. columnas nuevas (etoi) === > "%LOG%"
"%PGBIN%\psql" -X -d %DB% -v ON_ERROR_STOP=1 -f "C:\npm\etoi\operaciones\2026-11-18-actualizar_columnas_casilleros_pcetoi.sql" >> "%LOG%" 2>&1
if errorlevel 1 goto error

echo === 2. tabla_datos de viviendas, hogares y personas === >> "%LOG%"
"%PGBIN%\psql" -X -d %DB% -v ON_ERROR_STOP=1 -c "set search_path=base; select sql2tabla_datos('base','viviendas','pcetoi'); select sql2tabla_datos('base','hogares','pcetoi'); select sql2tabla_datos('base','personas','pcetoi');" >> "%LOG%" 2>&1
if errorlevel 1 goto error

echo === 3. relaciones de las calculadas === >> "%LOG%"
"%PGBIN%\psql" -X -d %DB% -v ON_ERROR_STOP=1 -v operativo=pcetoi -f "C:\npm\dmencu-data\operaciones\cargar_relaciones_calculadas.sql" >> "%LOG%" 2>&1
if errorlevel 1 goto error

echo === 4. estructura === >> "%LOG%"
call "%~dp0extraer-estructura-dmencu.bat" %DB% >> "%LOG%" 2>&1

echo Listo. Detalle en %LOG%
goto fin
:error
echo FALLO. Ver %LOG%
:fin
endlocal

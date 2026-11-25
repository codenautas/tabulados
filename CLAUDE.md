# CLAUDE.md — tabulados

Prototipo de tabulados (cuadros estadísticos) a partir de los datos de los operativos. Hoy sirve para migrar el procesamiento de SIEH 1 a dmencu: arma los cuadros con un motor propio (`GROUP BY CUBE`), los compara con los de SIEH 1 y valida las variables calculadas de dmencu contra las de SIEH 1. Más adelante puede ser una app multioperativo (app final en la organización es-ba) que también alimente a la API de CEPAL.

Diseño y decisiones: documento "Procesamiento SIEH 1 → dmencu: análisis y diseño". Uso: `LEEME.md`.

---

## Estructura de archivos

- `src/motor.ts`: el motor de cuadros (definición → una consulta → celdas). `src/tipos.ts`: tipos comunes.
- `src/sieh1.ts`: fuente y oráculo de SIEH 1 (port del SQL de `proceso_tabulados.php`). `src/dmencu.ts`: fuente de dmencu (unidades, calculadas, externas, cierre).
- `src/comparar.ts`, `src/html.ts`: comparación de cuadros y reporte. `src/plana.ts`: vistas planas por unidad de análisis en dmencu.
- `src/copiar-casos.ts`: copia casos de las planas de SIEH 1 a una base de dmencu de prueba. `src/comparar-calculadas.ts`: compara calculadas de dmencu con las de SIEH 1.
- `src/psql.ts`: ejecuta SQL con el `psql` instalado (sin dependencias de npm).
- `scripts/`: SQL y `.bat` para preparar bases de prueba.
- `dist/` (build), `salida/` (reportes), `cepal/` (datos bajados de la API de CEPAL) y `local-*.json` no se versionan.

---

## Convenciones de código

- **Todos los tipos deben ser explícitos**. Prohibido usar `any`, casts vía `unknown`, o cualquier magia sin justificación.
- **Preservar el estilo existente** al modificar archivos, incluyendo el uso de `var` donde ya se usa.
- **No tocar el formato de lo que ya existe**: el diff de un cambio debe mostrar sólo las líneas que cambian de verdad. Respetar el fin de línea de cada archivo (los `.bat` van con CRLF, ver `.gitattributes`). Antes de commitear, `git diff --stat` tiene que dar igual que `git diff --ignore-all-space --ignore-cr-at-eol --stat`.
- **Nunca repetir código**: antes de escribir una función o constante, buscar si ya existe y reutilizarla.
- Nombres de dominio, comentarios y mensajes en castellano.

---

## Compilación

- `npm install` y `npm run build` (`tsc -p .`). TypeScript es devDependency local: nunca instalar paquetes en forma global.
- Sin fallbacks: un error de compilación se corrige en el código.
- Con `NODE_ENV=production` npm no instala las devDependencies: instalar con `--include=dev`.

---

## Datos

- **Sólo bases locales de prueba.** `copiar-casos` borra los casos del operativo destino y desactiva triggers mientras carga: nunca apuntarlo a una base real.
- **Datos personales:** no se copian nombres, teléfonos, correos, direcciones ni observaciones (`EXCLUIR` en `copiar-casos.ts`). Los reportes sólo tienen resultados agregados o diferencias por clave, nunca microdatos completos.
- Las credenciales van en `local-*.json` (no se versionan); los ejemplos (`example-*.json`) llevan `TU_PASSWORD`.

---

## Casos de prueba

Todavía no hay tests automáticos. La validación es contra SIEH 1: `npm run comparar` (cuadros) y `npm run comparar-calculadas` (calculadas). Todo cambio en el motor o en las fuentes se valida volviendo a correr esas comparaciones; cuando se agreguen tests, van con Mocha como en el resto de los proyectos.

---

## Publicación

No se publica en npm (`"private": true`). Si pasa a ser app final se mueve a la organización `es-ba`: actualizar `repository` en `package.json` y el remoto (`git remote set-url origin https://github.com/es-ba/tabulados`).

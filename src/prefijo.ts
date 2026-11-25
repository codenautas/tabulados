"use strict";

/*
 * Port literal de expresion_regular_agregar_prefijo() de SIEH 1 (encuestas/consistencias.php).
 * Agrega un prefijo (en SIEH 1, "pla_") a cada identificador de una expresión SQL libre,
 * salvo a las palabras reservadas. Se conserva idéntico para reproducir el comportamiento
 * del sistema viejo, incluidas sus limitaciones.
 */

const OPERADORES_LOGICOS = 'or|and|is|end|in|not|true|false|null|case|when|else';

const IDENTIFICA_VARIABLE = new RegExp(
    '([A-Za-z][A-Za-z_.0-9]*)(\\s*)($|[-+)<=>,*/!|]|\\s(\\b(is null|is true|is false|' + OPERADORES_LOGICOS + ')\\b))',
    'g'
);

export function agregarPrefijo(expresion: string, prefijo: string): string {
    var resultado = expresion.replace(IDENTIFICA_VARIABLE, (_m: string, ident: string, espacios: string, resto: string) =>
        prefijo + ident + espacios + resto
    );
    var quitarEnReservadas = new RegExp(prefijo + '((' + OPERADORES_LOGICOS + '|null|not|true)\\b)', 'gi');
    return resultado.replace(quitarEnReservadas, '$1');
}

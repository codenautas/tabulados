-- SOLO PARA BASES DE PRUEBA (pcetoi_prueba). Desactiva las variables calculadas migradas de etoi262 que no se pueden
-- calcular todavía en dmencu, para que calculadas_generar no falle por ellas:
--   - usan funciones dbo.* de SIEH 1 o los nombres de clave viejos (enc, hog, mie);
--   - dependen (directa o indirectamente) de variables que no se migraron (con macros @...@ o de tipo especial).
-- Ver "Pendientes de las variables calculadas" en dmencu-data/operaciones/readme.md.
-- Se puede volver atrás con: update base.variables set activa = true where operativo = 'pcetoi' and clase = 'calculada';
\set ON_ERROR_STOP on
set search_path = base;
begin;
create temp table calculadas_rotas (variable text primary key, motivo text) on commit drop;
insert into calculadas_rotas values
  ('asist_hog_4a18', 'depende de cant_asist_hog_4a18, cant_edad_asist_hog_4a18'),
  ('asist_mie_4a18', 'depende de edad_30'),
  ('corresponde', 'depende de t_calocu'),
  ('e_aesc', 'depende de edad_30'),
  ('e_aesc_bu', 'depende de e_aesc'),
  ('e_edad_11', 'depende de edad_30'),
  ('e_edad_13', 'depende de edad_30'),
  ('e_edad_14', 'depende de edad_30'),
  ('e_edad_15', 'depende de edad_30'),
  ('e_edad_17', 'depende de edad_30'),
  ('e_edad_18', 'depende de edad_30'),
  ('e_edad_19', 'depende de edad_30'),
  ('e_edad_4', 'depende de edad_30'),
  ('e_edad_5', 'depende de edad_30'),
  ('e_raesc', 'depende de e_aesc'),
  ('edad_30', 'usa dbo.edad_a_la_fecha, dbo.fecha_30junio, dbo.texto_a_fecha'),
  ('edadma', 'usa enc, hog, mie'),
  ('edadpa', 'usa enc, hog, mie'),
  ('edadrefe', 'usa dbo.edadjefe, enc, hog'),
  ('fnacma', 'usa enc, hog, mie'),
  ('fnacpa', 'usa enc, hog, mie'),
  ('grupoc', 'depende de jerarq, t_calocu'),
  ('h_hacina', 'depende de h_perhab'),
  ('h_perhab', 'depende de tot_mi'),
  ('hacinam', 'depende de hacinam_2'),
  ('hacinam_2', 'depende de h_hacina'),
  ('hogar_bu', 'usa hog'),
  ('ipcf', 'depende de itf, pobnosd'),
  ('jerarq', 'depende de t41_cod2'),
  ('jerarq_covid', 'depende de t24_1_cod'),
  ('jerarq_os', 'depende de tso41_cod2'),
  ('p5b_bu', 'usa dbo.mie_bu, enc, hog'),
  ('p5bma', 'usa enc, hog, mie'),
  ('p5bpa', 'usa enc, hog, mie'),
  ('p6_a_bu', 'usa dbo.mie_bu, enc, hog'),
  ('p6_b_bu', 'usa dbo.mie_bu, enc, hog'),
  ('rclimedu', 'depende de climedu'),
  ('rclimedu_2', 'depende de climedu'),
  ('respond_bu', 'usa dbo.mie_bu, enc, hog'),
  ('respondi_bu', 'usa dbo.mie_bu, enc, hog'),
  ('sexoj', 'usa dbo.sexojefe, enc, hog'),
  ('sexorefe', 'usa dbo.sexojefe, enc, hog'),
  ('t37_coda', 'depende de t_ramocu'),
  ('t38_bis', 'depende de t37_cod2'),
  ('t38_bis2', 'depende de t37_cod2'),
  ('t39_comu', 'usa dbo.dic_tradu'),
  ('t39_rec', 'depende de t39_zona'),
  ('t39_zona', 'depende de t39_comu'),
  ('t40_2', 'depende de t37_cod2'),
  ('t_calocu', 'depende de t41_cod2'),
  ('t_calocu_ant_cesantes', 'depende de t24_1_cod'),
  ('t_calocu_ant_cesantes_2', 'depende de t_calocu_ant_cesantes'),
  ('t_calocu_os', 'depende de tso41_cod2'),
  ('t_ramoc2', 'depende de t_ramocu'),
  ('t_ramoc3sinsd_cesantes', 'depende de t23_1_cod'),
  ('t_ramocu', 'depende de t37_cod2'),
  ('t_ramocu_cesantes', 'depende de t23_1_cod'),
  ('t_ramocu_os', 'depende de cptso37_cod'),
  ('t_ramocu_os_agrup', 'depende de t_ramocu_os'),
  ('teletrabajo_243', 'depende de trab_domicilio, trab_domicilio_2'),
  ('teletrabajo_243_os', 'depende de trab_domicilio_os'),
  ('teletrabajo_nueva', 'depende de trab_domicilio'),
  ('tipoasal', 'depende de t37_cod2'),
  ('tot_mi', 'usa dbo.cant_i1_x_hog, enc, hog'),
  ('tot_mr', 'depende de tot_mi'),
  ('trab_domicilio', 'depende de t37_cod2'),
  ('trab_domicilio_2', 'depende de t37_cod2'),
  ('trab_domicilio_os', 'depende de cptso37_cod'),
  ('tu4_agrupada', 'depende de t37_cod2'),
  ('tuso6_agrupada', 'depende de teletrabajo_243_os');
update variables v set activa = false
  from calculadas_rotas r
  where v.operativo = 'pcetoi' and v.clase = 'calculada' and v.variable = r.variable;
select count(*) filter (where v.activa) as calculadas_activas, count(*) filter (where not v.activa) as calculadas_desactivadas
  from variables v where v.operativo = 'pcetoi' and v.clase = 'calculada';
commit;

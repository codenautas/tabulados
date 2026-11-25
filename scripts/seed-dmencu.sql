set search_path=base,public;
set session_replication_role=replica;
insert into operativos(operativo,nombre,con_rea_hogar,disform_cerrado,permite_generar_muestra) values ('pcetoi','ETOI sintética',true,false,false);
insert into unidad_analisis(operativo,unidad_analisis,nombre,pk_agregada,padre,orden,principal) values
 ('pcetoi','viviendas','viviendas','vivienda',null,'10',true),
 ('pcetoi','hogares','hogares','hogar','viviendas','20',false),
 ('pcetoi','personas','personas','persona','hogares','30',false),
 ('pcetoi','visitas','visitas','visita','viviendas','40',false);
insert into tem(operativo,enc,habilitada,tarea_actual,dominio,semana,fexp,rea,norea)
 select 'pcetoi', g::text, true, 'proc', 1+(g%3), 1+(g%12), 40+(g*37)%260, case when g%10=0 then 0 else 1 end, null from generate_series(1,300) g;
insert into tareas_tem(operativo,enc,tarea,estado)
 select 'pcetoi', enc, 'proc', case when enc::int%5=0 then '0D' else 'V' end from tem;
insert into viviendas(operativo,vivienda) select operativo,enc from tem;
insert into hogares(operativo,vivienda,hogar) select operativo,enc,1 from tem union all select operativo,enc,2 from tem where enc::int%7=0;
insert into personas(operativo,vivienda,hogar,persona,sexo,edad,p4)
 select h.operativo,h.vivienda,h.hogar,p, 1+((h.vivienda::int+p)%2), ((h.vivienda::int*p*13)%85), p
 from hogares h, generate_series(1,1+(h.vivienda::int+h.hogar)%4) p;
-- tablas _calculada como las deja varcal (nombre operativo_ua_calculada, mismas pk)
create table pcetoi_personas_calculada as
 select operativo,vivienda,hogar,persona,
   case when edad>=14 then case when (vivienda::int+persona)%3=0 then 2 else 1 end end as cond_activ,
   (edad/10)*10 as edad10a
 from personas;
alter table pcetoi_personas_calculada add primary key(operativo,vivienda,hogar,persona);
create table pcetoi_hogares_calculada as
 select operativo,vivienda,hogar, 1+(vivienda::int%3) as zona_3 from hogares;
alter table pcetoi_hogares_calculada add primary key(operativo,vivienda,hogar);

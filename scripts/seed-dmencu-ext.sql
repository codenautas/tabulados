create schema if not exists ext;
drop table if exists ext.pcetoi_hogares_ingresos;
create table ext.pcetoi_hogares_ingresos as
 select h.operativo,h.vivienda,h.hogar, o.origen, (h.vivienda::int%4)+1 + o.n as quintil
 from base.hogares h, (values ('eah',0),('etoi',10)) o(origen,n);
alter table ext.pcetoi_hogares_ingresos add primary key(operativo,vivienda,hogar,origen);
delete from base.tabla_datos where tabla_datos='hogares_ingresos';
insert into base.tabla_datos(operativo,tabla_datos,tipo) values ('pcetoi','hogares_ingresos','externa');

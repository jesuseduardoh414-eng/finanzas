-- Finanzas: ejecutar una sola vez en Supabase → SQL Editor.
-- Guarda todos tus datos como un solo documento JSON.
-- La tabla NO es accesible directo con la anon key; solo a través de dos
-- funciones que reciben la clave de la fila (la misma que está en config.js).
-- Esa clave es pública: cualquiera con el enlace de la app puede ver y editar los datos.

create table if not exists public.finanzas (
  clave       text primary key,
  datos       jsonb not null default '{}'::jsonb,
  actualizado timestamptz not null default now()
);

alter table public.finanzas enable row level security;
-- Sin políticas: con la anon key nadie puede leer ni escribir la tabla directamente.
revoke all on public.finanzas from anon, authenticated;

create or replace function public.fin_cargar(p_clave text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  select datos into v from public.finanzas where clave = p_clave;
  if not found then
    raise exception 'clave_invalida';
  end if;
  return v;
end;
$$;

create or replace function public.fin_guardar(p_clave text, p_datos jsonb)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  t timestamptz;
begin
  update public.finanzas
     set datos = p_datos, actualizado = now()
   where clave = p_clave
  returning actualizado into t;
  if not found then
    raise exception 'clave_invalida';
  end if;
  return t;
end;
$$;

revoke all on function public.fin_cargar(text) from public, anon, authenticated;
revoke all on function public.fin_guardar(text, jsonb) from public, anon, authenticated;
grant execute on function public.fin_cargar(text) to anon;
grant execute on function public.fin_guardar(text, jsonb) to anon;

-- Fila de datos. Debe coincidir con "clave" en config.js.
-- Nunca uses aquí una contraseña real: esta clave queda pública en la app.
insert into public.finanzas (clave)
values ('principal')
on conflict (clave) do nothing;

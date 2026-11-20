# Finanzas

App personal de finanzas (un solo usuario). HTML + CSS + JS sin compilación, datos en Supabase, hosting en Vercel, instalable como PWA.

## 1. Supabase (una sola vez)

1. Crea un proyecto en Supabase.
2. Abre **SQL Editor**, pega el contenido de `supabase.sql`.
3. **En el editor** (no en el archivo), cambia `CAMBIA-ESTA-CLAVE-POR-UNA-LARGA-Y-SECRETA` por tu clave: larga, 20+ caracteres.
4. Ejecuta (**Run**).

> No guardes tu clave real en `supabase.sql`: el archivo va al repositorio.

Para cambiar la clave después (desde el SQL Editor):

```sql
update public.finanzas set clave = 'NUEVA-CLAVE' where clave = 'CLAVE-ANTERIOR';
```

## 2. config.js

En Supabase → **Project Settings → API**, copia la **Project URL** y la **anon key** (o la *publishable key*) y pégalas en `config.js`.

La anon key es pública por diseño. Lo que protege tus datos es tu clave: la tabla está cerrada y solo se puede leer o escribir con ella.

## 3. Vercel

- Sube la carpeta a un repositorio de GitHub e impórtalo en Vercel. Framework Preset: **Other**, sin build command, output directory vacío (la raíz).
- O desde la carpeta: `npx vercel --prod`.

## 4. En el celular

Abre la URL de Vercel, escribe tu clave (solo la primera vez) y luego:
- **Android (Chrome):** menú ⋮ → *Instalar app* / *Agregar a pantalla principal*.
- **iPhone (Safari):** Compartir → *Agregar a inicio*.

## Cómo funciona

- **Saldo actual**: lo editas a mano. Al marcar algo como **Hecho** (o **Pagado**) se suma o resta solo; al desmarcarlo se revierte.
- **Semanas**: de la actual a 10 semanas adelante. Parten del saldo actual y proyectan solo lo pendiente. Lo hecho se ve tachado y no se vuelve a contar. Si el saldo baja de cero en algún momento, la semana se marca en rojo.
- **Atrasados**: lo pendiente de semanas pasadas (me deben, debo, pagos mensuales y movimientos únicos) aparece en la semana actual con la etiqueta *atrasado*. Los recurrentes pasados no se arrastran.
- **Debo mensual**: genera un pago cada mes en el día límite (a partir del día en que la registras). El total que debo cuenta los pagos atrasados más el próximo. Marca la deuda como *Pagado* solo cuando la termines por completo.
- **Recurrentes**:
  - *Cada semana*: con monto opcional de semanas alternas (A/B), en el día de la semana de la primera fecha.
  - *Cada X días*.
  - *Mensual sin día fijo*: estimado el último día del mes. Desde Semanas → tocar → *Mover fecha*.
- **Sin conexión**: los cambios se guardan en el teléfono y se suben solos al volver la conexión.
- **Respaldo**: Inicio → Exportar / Importar JSON.

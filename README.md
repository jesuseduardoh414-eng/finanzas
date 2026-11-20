# Finanzas

App personal de finanzas (un solo usuario). HTML + CSS + JS sin compilación, datos en Supabase, hosting en Vercel, instalable como PWA.

**En línea:** https://finanzas-flax-five.vercel.app. Se entra directo, sin clave. Cada `git push` a `main` vuelve a publicarla en Vercel.

> Sin clave, cualquiera que tenga el enlace puede ver y editar los datos. La página tiene `noindex` para que no aparezca en buscadores. Haz respaldos de vez en cuando (Inicio → Exportar JSON).

## Configuración (ya hecha)

1. **Supabase:** en SQL Editor se ejecutó `supabase.sql`. Crea la tabla `finanzas` (cerrada al acceso directo), las funciones `fin_cargar` / `fin_guardar` y la fila `principal`.
2. **config.js:** URL del proyecto, publishable key y `clave: 'principal'`. Nunca pongas ahí la secret key ni la contraseña de la base de datos.
3. **Vercel:** proyecto `finanzas` conectado a este repositorio. Preset **Other**, sin build.

## Acceso directo en el celular

Abre el enlace y en **Inicio** aparece la tarjeta **Acceso directo**:
- **Android (Chrome):** botón **Instalar**, o menú ⋮ → *Instalar app*.
- **iPhone (Safari):** Compartir → *Agregar a inicio*.

## Cómo funciona

- **Saldo actual**: es la suma de tus cuentas (efectivo, tarjetas, otras), cada una editable a mano. Al marcar algo como **Hecho** o **Pagado** se suma o resta en la cuenta que elijas (si solo tienes una, se usa directo). Al desmarcarlo se revierte en esa misma cuenta.
- **Me deben**: una tarjeta por persona con sus préstamos en orden (Préstamo 1, 2, 3…), cuándo te los pidió, cuánto te debe en total y el botón *Otro préstamo a…*. Si al prestar salió dinero de una cuenta, puedes indicarlo y se descuenta.
- **Semanas**: de la actual a 10 semanas adelante. Parten del saldo actual y proyectan solo lo pendiente. Lo hecho se ve tachado y no se vuelve a contar. Si el saldo baja de cero en algún momento, la semana se marca en rojo.
- **Atrasados**: lo pendiente de semanas pasadas (me deben, debo, pagos mensuales y movimientos únicos) aparece en la semana actual con la etiqueta *atrasado*. Los recurrentes pasados no se arrastran.
- **Debo · Tarjeta**: registra lo que debes en total, el pago del mes, el día límite y el límite de crédito (opcional). Cada mes aparece el pago en Semanas hasta terminar de pagar. Al pagar eliges cuánto y de qué cuenta, y lo que debes baja solo. El total de Debo cuenta toda la deuda de la tarjeta.
- **Debo mensual**: genera un pago cada mes en el día límite (a partir del día en que la registras). El total que debo cuenta los pagos atrasados más el próximo. Marca la deuda como *Pagado* solo cuando la termines por completo.
- **Recurrentes**:
  - *Cada semana*: con monto opcional de semanas alternas (A/B), en el día de la semana de la primera fecha.
  - *Cada X días*.
  - *Mensual sin día fijo*: estimado el último día del mes. Desde Semanas → tocar → *Mover fecha*.
- **Sin conexión**: los cambios se guardan en el teléfono y se suben solos al volver la conexión.
- **Respaldo**: Inicio → Exportar / Importar JSON.

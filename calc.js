// Lógica pura: fechas, ocurrencias, semanas y totales. Sin DOM.
(function (root) {
  'use strict';

  const SEMANAS = 11; // la actual + 10 adelante

  // ---------- fechas (siempre 'YYYY-MM-DD' en hora local) ----------
  const pad = (n) => String(n).padStart(2, '0');
  const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fromISO = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d, 12);
  };
  const hoyISO = () => toISO(new Date());
  const addDays = (s, n) => {
    const d = fromISO(s);
    d.setDate(d.getDate() + n);
    return toISO(d);
  };
  const diffDays = (a, b) => Math.round((fromISO(b) - fromISO(a)) / 86400000); // b - a
  const lunesDe = (s) => addDays(s, -((fromISO(s).getDay() + 6) % 7));
  const diasEnMes = (y, m) => new Date(y, m, 0).getDate(); // m: 1-12
  const fechaMes = (y, m, dia) => `${y}-${pad(m)}-${pad(Math.min(dia, diasEnMes(y, m)))}`;

  function* meses(desde, hasta) {
    let [y, m] = desde.split('-').map(Number);
    const [hy, hm] = hasta.split('-').map(Number);
    while (y < hy || (y === hy && m <= hm)) {
      yield [y, m];
      if (m === 12) { y++; m = 1; } else m++;
    }
  }

  const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100 || 0;

  // ---------- estado ----------
  const vacio = () => ({
    v: 2,
    cuentas: [{ id: 'efectivo', nombre: 'Efectivo', tipo: 'efectivo', saldo: 0 }], // {id, nombre, tipo:'efectivo'|'tarjeta'|'otra', saldo}
    principal: 'efectivo', // cuenta sugerida al marcar algo como hecho
    movs: [],     // {id, fecha, concepto, monto, tipo:'ingreso'|'gasto', hecho, cuenta}
    meDeben: [],  // {id, persona, concepto, monto, fechaPrestamo, fecha|null (pago esperado), estado, cuentaPago, cuentaSalida}
    debo: [],     // {id, aQuien, concepto, monto, modo:'unico'|'mensual', fecha|null, dia|null, inicio, estado, cuentaPago}
    recs: [],     // {id, clase:'semanal'|'cadaDias'|'mensual', concepto, tipo, monto, montoB|null, cadaDias|null, inicio}
    hechos: {},   // clave de ocurrencia generada -> id de la cuenta donde se aplicó
    mover: {},    // clave de ocurrencia (mensual estimado) -> 'YYYY-MM-DD'
  });

  const saldoTotal = (st) => r2(st.cuentas.reduce((a, c) => a + (Number(c.saldo) || 0), 0));

  function normalizar(d) {
    const s = vacio();
    if (!d || typeof d !== 'object') return s;
    if (Array.isArray(d.cuentas) && d.cuentas.length) s.cuentas = d.cuentas;
    else if (typeof d.saldo === 'number' && isFinite(d.saldo)) s.cuentas[0].saldo = d.saldo; // versión 1: un solo saldo
    s.principal = s.cuentas.some((c) => c.id === d.principal) ? d.principal : s.cuentas[0].id;
    for (const k of ['movs', 'meDeben', 'debo', 'recs']) if (Array.isArray(d[k])) s[k] = d[k];
    for (const k of ['hechos', 'mover']) if (d[k] && typeof d[k] === 'object' && !Array.isArray(d[k])) s[k] = d[k];
    const hoy = hoyISO();
    for (const x of s.debo) if (!x.inicio) x.inicio = hoy;
    for (const r of s.recs) if (!r.inicio) r.inicio = hoy;
    return s;
  }

  // ---------- ocurrencias en un rango ----------
  // Cada ocurrencia: {key, src, id, concepto, monto, tipo, hecho, fecha, pos, atrasado, ...}
  // pos = fecha donde se acomoda en las semanas (los atrasados pendientes van al lunes de la semana actual).
  function ocurrencias(st, desde, hasta) {
    const out = [];
    const add = (o, fecha) => {
      if (!fecha || fecha > hasta) return;
      if (fecha < desde) {
        if (o.hecho || !o.arrastra) return;
        o.atrasado = true;
        o.pos = desde;
      } else {
        o.pos = fecha;
      }
      o.fecha = fecha;
      out.push(o);
    };

    for (const m of st.movs) {
      add({ key: 'm:' + m.id, src: 'mov', id: m.id, concepto: m.concepto, monto: m.monto, tipo: m.tipo, hecho: !!m.hecho, arrastra: true }, m.fecha);
    }

    for (const x of st.meDeben) {
      if (!x.fecha) continue;
      add({
        key: 'p:' + x.id, src: 'meDeben', id: x.id,
        concepto: x.persona + (x.concepto ? ' · ' + x.concepto : ''),
        monto: x.monto, tipo: 'ingreso', hecho: x.estado === 'pagado', arrastra: true, etiqueta: 'me deben',
      }, x.fecha);
    }

    for (const x of st.debo) {
      const concepto = x.aQuien + (x.concepto ? ' · ' + x.concepto : '');
      if (x.modo === 'mensual') {
        if (x.estado === 'pagado') continue; // deuda terminada: ya no se genera
        for (const [y, m] of meses(x.inicio, hasta)) {
          const f = fechaMes(y, m, x.dia);
          if (f < x.inicio) continue;
          const key = `d:${x.id}:${y}-${pad(m)}`;
          add({ key, src: 'deboMes', id: x.id, concepto, monto: x.monto, tipo: 'gasto', hecho: !!st.hechos[key], arrastra: true, etiqueta: 'mensual' }, f);
        }
      } else if (x.modo === 'tarjeta') {
        for (const c of cuotasTarjeta(x, hasta)) {
          add({ key: `d:${x.id}:${c.mes}`, src: 'tarjeta', id: x.id, mes: c.mes, concepto, monto: c.monto, tipo: 'gasto', hecho: c.pagado, arrastra: true, etiqueta: 'tarjeta' }, c.fecha);
        }
      } else if (x.fecha) {
        add({ key: 'd:' + x.id, src: 'debo', id: x.id, concepto, monto: x.monto, tipo: 'gasto', hecho: x.estado === 'pagado', arrastra: true, etiqueta: 'debo' }, x.fecha);
      }
    }

    for (const r of st.recs) {
      if (r.clase === 'semanal' || r.clase === 'cadaDias') {
        const paso = r.clase === 'semanal' ? 7 : Math.max(1, Math.floor(r.cadaDias) || 1);
        let k = Math.max(0, Math.ceil(diffDays(r.inicio, desde) / paso));
        for (;; k++) {
          const f = addDays(r.inicio, k * paso);
          if (f > hasta) break;
          const key = `r:${r.id}:${f}`;
          const alterna = r.clase === 'semanal' && r.montoB > 0;
          add({
            key, src: 'rec', id: r.id, concepto: r.concepto,
            monto: alterna && k % 2 === 1 ? r.montoB : r.monto,
            tipo: r.tipo, hecho: !!st.hechos[key], arrastra: false,
            etiqueta: alterna ? (k % 2 === 1 ? 'semana B' : 'semana A') : '',
          }, f);
        }
      } else if (r.clase === 'mensual') {
        // Sin día fijo: estimado el último día del mes; se puede mover.
        const ini = r.inicio > addDays(desde, -62) ? r.inicio : addDays(desde, -62);
        for (const [y, m] of meses(ini, addDays(hasta, 31))) {
          const def = fechaMes(y, m, 31);
          if (def < r.inicio) continue;
          const key = `r:${r.id}:${y}-${pad(m)}`;
          add({
            key, src: 'rec', id: r.id, concepto: r.concepto, monto: r.monto, tipo: r.tipo,
            hecho: !!st.hechos[key], arrastra: false, movible: true, fechaDefault: def,
            etiqueta: st.mover[key] ? 'movido' : 'estimado',
          }, st.mover[key] || def);
        }
      }
    }
    return out;
  }

  // ---------- tarjetas de crédito ----------
  // Pagos mensuales de una tarjeta desde que se registró hasta 'hasta'.
  // Los ya pagados salen de x.pagos; los pendientes son el pago del mes, sin pasarse de lo que se debe
  // (x.deuda ya tiene descontados los pagos hechos).
  function cuotasTarjeta(x, hasta) {
    const res = [];
    if (!(x.monto > 0) || !x.dia) return res;
    let resta = r2(x.deuda || 0);
    for (const [y, m] of meses(x.inicio, hasta)) {
      const f = fechaMes(y, m, x.dia);
      if (f < x.inicio) continue;
      const mes = `${y}-${pad(m)}`;
      const p = x.pagos && x.pagos[mes];
      if (p) { res.push({ mes, fecha: f, monto: p.monto, pagado: true }); continue; }
      if (resta <= 0) continue;
      const monto = r2(Math.min(x.monto, resta));
      resta = r2(resta - monto);
      res.push({ mes, fecha: f, monto, pagado: false });
    }
    return res;
  }

  // Pagos pendientes de una tarjeta: los atrasados + el próximo.
  function pendientesTarjeta(x, hoy) {
    hoy = hoy || hoyISO();
    const res = [];
    for (const c of cuotasTarjeta(x, addDays(hoy, 400))) {
      if (c.pagado) continue;
      res.push(c);
      if (c.fecha >= hoy) break;
    }
    return res;
  }

  // ---------- semanas ----------
  function calcularSemanas(st, hoy) {
    hoy = hoy || hoyISO();
    const desde = lunesDe(hoy);
    const hasta = addDays(desde, SEMANAS * 7 - 1);
    const occ = ocurrencias(st, desde, hasta).sort((a, b) =>
      (a.pos < b.pos ? -1 : a.pos > b.pos ? 1 : 0) ||
      (b.hecho - a.hecho) ||
      ((a.tipo === 'ingreso' ? 0 : 1) - (b.tipo === 'ingreso' ? 0 : 1)) ||
      String(a.concepto).localeCompare(String(b.concepto)));

    // El saldo actual ya incluye todo lo marcado como hecho; solo se proyecta lo pendiente.
    let saldo = saldoTotal(st);
    const semanas = [];
    for (let i = 0; i < SEMANAS; i++) {
      const ini = addDays(desde, i * 7);
      const fin = addDays(ini, 6);
      const items = occ.filter((o) => o.pos >= ini && o.pos <= fin);
      const inicial = saldo;
      let ing = 0, gas = 0, min = saldo;
      for (const o of items) {
        if (!o.hecho) {
          if (o.tipo === 'ingreso') { saldo = r2(saldo + o.monto); ing = r2(ing + o.monto); }
          else { saldo = r2(saldo - o.monto); gas = r2(gas + o.monto); }
        }
        o.saldo = saldo;
        if (saldo < min) min = saldo;
      }
      semanas.push({ ini, fin, inicial, items, ing, gas, final: saldo, negativo: min < 0 });
    }
    return semanas;
  }

  // ---------- totales ----------
  // Pagos mensuales pendientes de una deuda: los atrasados sin pagar + el próximo.
  function pendientesMensual(st, x, hoy) {
    hoy = hoy || hoyISO();
    const res = [];
    if (x.modo !== 'mensual' || x.estado === 'pagado') return res;
    for (const [y, m] of meses(x.inicio, addDays(hoy, 400))) {
      const f = fechaMes(y, m, x.dia);
      if (f < x.inicio) continue;
      const key = `d:${x.id}:${y}-${pad(m)}`;
      if (st.hechos[key]) continue;
      res.push({ key, fecha: f });
      if (f >= hoy) break;
    }
    return res;
  }

  const totalMeDeben = (st) => r2(st.meDeben.filter((x) => x.estado !== 'pagado').reduce((a, x) => a + x.monto, 0));

  function totalDebo(st, hoy) {
    let t = 0;
    for (const x of st.debo) {
      if (x.modo === 'mensual') t += pendientesMensual(st, x, hoy).length * x.monto;
      else if (x.modo === 'tarjeta') t += Math.max(0, x.deuda || 0); // en tarjetas cuenta todo lo que debes
      else if (x.estado !== 'pagado') t += x.monto;
    }
    return r2(t);
  }

  root.Calc = {
    SEMANAS, pad, toISO, fromISO, hoyISO, addDays, diffDays, lunesDe, fechaMes, meses, r2,
    vacio, normalizar, saldoTotal, ocurrencias, calcularSemanas, pendientesMensual, cuotasTarjeta, pendientesTarjeta,
    totalMeDeben, totalDebo,
  };
})(typeof window !== 'undefined' ? window : globalThis);

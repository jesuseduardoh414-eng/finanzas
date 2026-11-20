(function () {
  'use strict';
  const C = window.Calc;
  const CFG = window.FIN_CONFIG || {};
  const LS = { clave: 'fin_clave', cache: 'fin_cache', pend: 'fin_pendiente' };

  // ---------- utilidades ----------
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const nf = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const money = (n) => nf.format(C.r2(n));
  const signed = (o) => (o.tipo === 'ingreso' ? '+' : '−') + money(o.monto);
  const num = (v) => {
    const n = parseFloat(String(v ?? '').replace(/[$,\s]/g, ''));
    return isFinite(n) ? n : NaN;
  };
  const find = (arr, id) => arr.find((x) => x.id === id);
  const negc = (n) => (n < 0 ? 'neg' : '');

  const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  const DIAS_L = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const fCorta = (s) => {
    const d = C.fromISO(s);
    return `${DIAS[d.getDay()]} ${C.pad(d.getDate())}/${C.pad(d.getMonth() + 1)}`;
  };
  const fLarga = (s) => {
    const d = C.fromISO(s);
    return `${DIAS[d.getDay()]} ${C.pad(d.getDate())}/${C.pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  };
  const fRango = (a, b) => {
    const x = C.fromISO(a), y = C.fromISO(b);
    return x.getMonth() === y.getMonth()
      ? `${x.getDate()} – ${y.getDate()} ${MESES[y.getMonth()]}`
      : `${x.getDate()} ${MESES[x.getMonth()]} – ${y.getDate()} ${MESES[y.getMonth()]}`;
  };
  const nombreMes = (s) => MESES[C.fromISO(s).getMonth()];

  // ---------- estado ----------
  let st = C.vacio();
  let clave = null;
  let tab = 'inicio';
  let enApp = false;
  let ocMap = new Map();

  // ---------- Supabase ----------
  async function rpc(fn, body) {
    const key = CFG.supabaseAnonKey;
    const headers = { 'Content-Type': 'application/json', apikey: key };
    if (key.startsWith('eyJ')) headers.Authorization = 'Bearer ' + key; // anon key clásica (JWT)
    const res = await fetch(CFG.supabaseUrl.replace(/\/+$/, '') + '/rest/v1/rpc/' + fn, {
      method: 'POST', headers, body: JSON.stringify(body),
    });
    const txt = await res.text();
    let data = null;
    try { data = txt ? JSON.parse(txt) : null; } catch (_) { /* respuesta no JSON */ }
    if (!res.ok) {
      const e = new Error((data && data.message) || 'HTTP ' + res.status);
      e.invalida = !!(data && data.message === 'clave_invalida');
      throw e;
    }
    return data;
  }

  let timer = null, guardando = false, sucio = false;

  // Guarda en el teléfono al instante y sube a Supabase poco después.
  function guardar() {
    localStorage.setItem(LS.cache, JSON.stringify(st));
    localStorage.setItem(LS.pend, '1');
    sucio = true;
    setSync('guardando');
    clearTimeout(timer);
    timer = setTimeout(subir, 600);
  }

  async function subir() {
    if (guardando || !sucio) return;
    guardando = true;
    sucio = false;
    setSync('guardando');
    let ok = false;
    try {
      await rpc('fin_guardar', { p_clave: clave, p_datos: st });
      ok = true;
    } catch (e) {
      sucio = true;
      guardando = false;
      if (e.invalida) return salir('Tu clave ya no es válida. Escríbela de nuevo.');
      setSync('offline');
      return;
    }
    guardando = false;
    if (ok && sucio) return subir(); // hubo cambios mientras se guardaba
    localStorage.removeItem(LS.pend);
    setSync('ok');
  }

  // Trae lo último de Supabase (o sube lo pendiente si hay cambios sin guardar).
  async function sincronizar() {
    if (localStorage.getItem(LS.pend)) {
      sucio = true;
      return subir();
    }
    if (guardando || sucio) return;
    try {
      const d = await rpc('fin_cargar', { p_clave: clave });
      if (guardando || sucio || localStorage.getItem(LS.pend)) return;
      const nuevo = C.normalizar(d);
      const cambio = JSON.stringify(nuevo) !== JSON.stringify(st);
      st = nuevo;
      localStorage.setItem(LS.cache, JSON.stringify(st));
      setSync('ok');
      if (cambio) render();
    } catch (e) {
      if (e.invalida) return salir('Tu clave ya no es válida. Escríbela de nuevo.');
      setSync('offline');
    }
  }

  function setSync(estado) {
    const el = $('#sync');
    const t = {
      ok: '✓ Guardado',
      guardando: 'Guardando…',
      offline: '⚠ Sin conexión · guardado en el teléfono',
    }[estado] || '';
    el.textContent = t;
    el.className = 'sync ' + estado;
    el.hidden = !t;
  }

  // ---------- arranque ----------
  function configurado() {
    const u = CFG.supabaseUrl || '', k = CFG.supabaseAnonKey || '';
    return u && k && !/TU-PROYECTO|TU-ANON/.test(u + k);
  }

  async function iniciar() {
    registrarSW();
    if (!configurado()) {
      return pantalla('Falta configurar Supabase', 'Edita <b>config.js</b> con la URL y la anon key de tu proyecto de Supabase.');
    }
    clave = localStorage.getItem(LS.clave);
    if (!clave) return pantallaClave();

    const cache = localStorage.getItem(LS.cache);
    if (cache) {
      try { st = C.normalizar(JSON.parse(cache)); } catch (_) { st = C.vacio(); }
      mostrarApp();
      sincronizar();
      return;
    }
    pantalla('Cargando…', '');
    try {
      st = C.normalizar(await rpc('fin_cargar', { p_clave: clave }));
      localStorage.setItem(LS.cache, JSON.stringify(st));
      mostrarApp();
      setSync('ok');
    } catch (e) {
      if (e.invalida) return salir();
      pantalla('Sin conexión', 'No se pudieron cargar tus datos. Revisa tu internet.', true);
    }
  }

  function pantalla(titulo, html, reintentar) {
    enApp = false;
    $('#tabs').hidden = true;
    $('#fab').hidden = true;
    $('#sync').hidden = true;
    $('#titulo').textContent = 'Finanzas';
    $('#vista').innerHTML = `<section class="card setup"><h2>${titulo}</h2><p>${html}</p>
      ${reintentar ? '<button class="btn pri block" data-act="reintentar">Reintentar</button>' : ''}</section>`;
  }

  function pantallaClave(msg) {
    pantalla('Clave de acceso', 'Escribe la clave que pusiste en Supabase. Solo se pide una vez en este dispositivo.');
    $('.setup').insertAdjacentHTML('beforeend', `
      <form class="form" id="f-clave">
        <input name="clave" type="password" autocomplete="current-password" placeholder="Tu clave" required>
        <p class="error">${esc(msg || '')}</p>
        <button class="btn pri block" type="submit">Entrar</button>
      </form>`);
    const f = $('#f-clave');
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const c = f.clave.value.trim();
      if (!c) return;
      const btn = $('button', f);
      btn.disabled = true;
      $('.error', f).textContent = '';
      try {
        const d = await rpc('fin_cargar', { p_clave: c });
        clave = c;
        st = C.normalizar(d);
        localStorage.setItem(LS.clave, c);
        localStorage.setItem(LS.cache, JSON.stringify(st));
        localStorage.removeItem(LS.pend);
        mostrarApp();
        setSync('ok');
      } catch (err) {
        $('.error', f).textContent = err.invalida ? 'Clave incorrecta.' : 'No se pudo conectar: ' + err.message;
        btn.disabled = false;
      }
    });
  }

  function salir(msg) {
    [LS.clave, LS.cache, LS.pend].forEach((k) => localStorage.removeItem(k));
    clave = null;
    sucio = false;
    st = C.vacio();
    cerrar();
    pantallaClave(msg);
  }

  function mostrarApp() {
    enApp = true;
    $('#tabs').hidden = false;
    $('#fab').hidden = false;
    render();
  }

  function registrarSW() {
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  // ---------- vistas ----------
  const TITULOS = { inicio: 'Inicio', semanas: 'Semanas', medeben: 'Me deben', debo: 'Debo', recs: 'Recurrentes' };

  function render() {
    if (!enApp) return;
    $('#titulo').textContent = TITULOS[tab];
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('activo', b.dataset.tab === tab));
    const vistas = { inicio: vInicio, semanas: vSemanas, medeben: vMeDeben, debo: vDebo, recs: vRecs };
    $('#vista').innerHTML = vistas[tab]();
  }

  const vacioMsg = (t) => `<p class="vacio">${t}</p>`;

  function vInicio() {
    const sem = C.calcularSemanas(st);
    const md = C.totalMeDeben(st);
    const db = C.totalDebo(st);
    const neto = C.r2(st.saldo + md - db);
    return `
      <section class="card saldo" data-act="editar-saldo">
        <div class="lbl">Saldo actual</div>
        <div class="big ${negc(st.saldo)}">${money(st.saldo)}</div>
        <div class="hint">Toca para editar</div>
      </section>
      <div class="grid2">
        <section class="card mini" data-act="ir" data-tab="medeben">
          <div class="lbl">Me deben</div><div class="val ing">${money(md)}</div><div class="hint">pendiente</div>
        </section>
        <section class="card mini" data-act="ir" data-tab="debo">
          <div class="lbl">Debo</div><div class="val">${money(db)}</div><div class="hint">pendiente</div>
        </section>
      </div>
      <section class="card fila">
        <div><div class="lbl">Balance neto</div><div class="hint">saldo + me deben − debo</div></div>
        <div class="val ${negc(neto)}">${money(neto)}</div>
      </section>
      <section class="card" data-act="ir" data-tab="semanas">
        <div class="lbl">Saldo proyectado</div>
        <div class="fila linea"><span>Fin de esta semana <small>${fCorta(sem[0].fin)}</small></span><b class="${negc(sem[0].final)}">${money(sem[0].final)}</b></div>
        <div class="fila linea"><span>Fin de la siguiente <small>${fCorta(sem[1].fin)}</small></span><b class="${negc(sem[1].final)}">${money(sem[1].final)}</b></div>
      </section>
      <section class="card">
        <div class="lbl">Respaldo</div>
        <div class="botones">
          <button class="btn" data-act="exportar">Exportar JSON</button>
          <button class="btn" data-act="importar">Importar JSON</button>
        </div>
      </section>`;
  }

  function vSemanas() {
    const sem = C.calcularSemanas(st);
    ocMap = new Map();
    return sem.map((s, i) => {
      const titulo = i === 0 ? 'Esta semana' : i === 1 ? 'Próxima semana' : 'Semana';
      const filas = s.items.map((o) => { ocMap.set(o.key, o); return filaMov(o); }).join('');
      return `
        <section class="card semana ${s.negativo ? 'alerta' : ''}">
          <header class="sem-h">
            <div><b>${titulo}</b><span>${fRango(s.ini, s.fin)}</span></div>
            ${s.negativo ? '<span class="tag neg">Saldo negativo</span>' : ''}
          </header>
          <div class="fila sub"><span>${i === 0 ? 'Saldo actual' : 'Saldo inicial'}</span><b class="${negc(s.inicial)}">${money(s.inicial)}</b></div>
          ${filas ? `<ul class="movs">${filas}</ul>` : vacioMsg('Sin movimientos')}
          <div class="tot">
            <div class="fila"><span>Ingresos</span><b class="ing">+${money(s.ing)}</b></div>
            <div class="fila"><span>Gastos</span><b>−${money(s.gas)}</b></div>
            <div class="fila final"><span>Saldo final</span><b class="${negc(s.final)}">${money(s.final)}</b></div>
          </div>
        </section>`;
    }).join('');
  }

  function filaMov(o) {
    const tags = [];
    if (o.atrasado) tags.push('<span class="tag warn">atrasado</span>');
    if (o.etiqueta) tags.push(`<span class="tag">${esc(o.etiqueta)}</span>`);
    const neg = !o.hecho && o.saldo < 0;
    const k = esc(o.key);
    return `
      <li class="mov ${o.hecho ? 'hecho' : ''} ${neg ? 'neg-row' : ''}">
        <button class="check" data-act="hecho" data-key="${k}" aria-pressed="${o.hecho}" aria-label="${o.hecho ? 'Desmarcar' : 'Marcar como hecho'}">✓</button>
        <div class="mov-main" data-act="detalle" data-key="${k}">
          <div class="l1"><span class="concepto">${esc(o.concepto)}</span><span class="monto ${o.tipo === 'ingreso' ? 'ing' : ''}">${signed(o)}</span></div>
          <div class="l2"><span>${fCorta(o.fecha)} ${tags.join(' ')}</span><span class="${neg ? 'neg' : ''}">${o.hecho ? 'hecho' : money(o.saldo)}</span></div>
        </div>
      </li>`;
  }

  function vMeDeben() {
    const total = C.totalMeDeben(st);
    const grupos = new Map();
    for (const x of st.meDeben) {
      const k = x.persona.trim().toLowerCase();
      if (!grupos.has(k)) grupos.set(k, { nombre: x.persona.trim(), items: [], pend: 0 });
      const g = grupos.get(k);
      g.items.push(x);
      if (x.estado !== 'pagado') g.pend = C.r2(g.pend + x.monto);
    }
    const lista = [...grupos.values()].sort((a, b) => b.pend - a.pend || a.nombre.localeCompare(b.nombre));
    const orden = (a, b) => (a.estado === 'pagado') - (b.estado === 'pagado') || String(a.fecha || '9999').localeCompare(String(b.fecha || '9999'));
    return `
      <section class="card fila"><div class="lbl">Total pendiente</div><div class="val ing">${money(total)}</div></section>
      <button class="btn pri block" data-act="nuevo-medeben">+ Agregar</button>
      ${lista.length ? lista.map((g) => `
        <section class="card">
          <header class="fila grupo-h"><b>${esc(g.nombre)}</b><span class="${g.pend ? 'ing' : 'muted'}">${g.pend ? money(g.pend) : 'Todo pagado'}</span></header>
          <ul class="items">${g.items.sort(orden).map(itemMeDeben).join('')}</ul>
        </section>`).join('') : vacioMsg('Nadie te debe nada por ahora.')}`;
  }

  function itemMeDeben(x) {
    const pag = x.estado === 'pagado';
    const vencido = !pag && x.fecha && x.fecha < C.hoyISO();
    return `
      <li class="item ${pag ? 'pagado' : ''}" data-act="editar-medeben" data-id="${x.id}">
        <div class="item-main">
          ${x.concepto ? `<div class="l1">${esc(x.concepto)}</div>` : ''}
          <div class="${x.concepto ? 'l2' : 'l1'}">${x.fecha ? fCorta(x.fecha) : 'Sin fecha'} ${vencido ? '<span class="tag warn">vencido</span>' : ''}</div>
        </div>
        <div class="item-r">
          <b>${money(x.monto)}</b>
          <button class="estado ${pag ? 'ok' : ''}" data-act="pago-medeben" data-id="${x.id}">${pag ? 'Pagado' : 'Pendiente'}</button>
        </div>
      </li>`;
  }

  function vDebo() {
    const total = C.totalDebo(st);
    const prox = (x) => {
      if (x.estado === 'pagado') return '~';
      if (x.modo === 'mensual') { const p = C.pendientesMensual(st, x)[0]; return p ? p.fecha : '~'; }
      return x.fecha || '9999';
    };
    const items = [...st.debo].sort((a, b) => prox(a).localeCompare(prox(b)));
    return `
      <section class="card fila"><div class="lbl">Total pendiente</div><div class="val">${money(total)}</div></section>
      <button class="btn pri block" data-act="nuevo-debo">+ Agregar</button>
      ${items.length ? `<section class="card"><ul class="items">${items.map(itemDebo).join('')}</ul></section>` : vacioMsg('No tienes deudas registradas.')}`;
  }

  function itemDebo(x) {
    const titulo = esc(x.aQuien) + (x.concepto ? ` <span class="muted">· ${esc(x.concepto)}</span>` : '');
    const pag = x.estado === 'pagado';
    let sub, monto, boton;
    if (x.modo === 'mensual') {
      const pend = C.pendientesMensual(st, x);
      const atr = pend.filter((p) => p.fecha < C.hoyISO()).length;
      sub = `Mensual · antes del día ${x.dia}` +
        (pag ? ' · terminada' : pend[0] ? ` · próximo ${fCorta(pend[0].fecha)}` : '') +
        (atr ? ` <span class="tag warn">${atr} atrasado${atr > 1 ? 's' : ''}</span>` : '');
      monto = `${money(x.monto)}<small>/mes</small>`;
      boton = pag || !pend[0]
        ? '<span class="estado ok">Terminada</span>'
        : `<button class="estado" data-act="pago-mes" data-id="${x.id}">Pagar ${nombreMes(pend[0].fecha)}</button>`;
    } else {
      const vencido = !pag && x.fecha && x.fecha < C.hoyISO();
      sub = `Pago único · ${x.fecha ? 'límite ' + fCorta(x.fecha) : 'sin fecha'}` + (vencido ? ' <span class="tag warn">vencido</span>' : '');
      monto = money(x.monto);
      boton = `<button class="estado ${pag ? 'ok' : ''}" data-act="pago-debo" data-id="${x.id}">${pag ? 'Pagado' : 'Pendiente'}</button>`;
    }
    return `
      <li class="item ${pag ? 'pagado' : ''}" data-act="editar-debo" data-id="${x.id}">
        <div class="item-main"><div class="l1">${titulo}</div><div class="l2">${sub}</div></div>
        <div class="item-r"><b>${monto}</b>${boton}</div>
      </li>`;
  }

  function descRec(r) {
    if (r.clase === 'semanal') {
      const dia = DIAS_L[C.fromISO(r.inicio).getDay()];
      return r.montoB
        ? `Cada ${dia} · alterna ${money(r.monto)} / ${money(r.montoB)} · desde ${fCorta(r.inicio)}`
        : `Cada ${dia} · desde ${fCorta(r.inicio)}`;
    }
    if (r.clase === 'cadaDias') return `Cada ${r.cadaDias} días · desde ${fCorta(r.inicio)}`;
    return 'Mensual sin día fijo · estimado a fin de mes';
  }

  function vRecs() {
    return `
      <button class="btn pri block" data-act="nuevo-rec">+ Agregar</button>
      ${st.recs.length ? `<section class="card"><ul class="items">${st.recs.map((r) => `
        <li class="item" data-act="editar-rec" data-id="${r.id}">
          <div class="item-main"><div class="l1">${esc(r.concepto)}</div><div class="l2">${descRec(r)}</div></div>
          <div class="item-r"><b class="${r.tipo === 'ingreso' ? 'ing' : ''}">${r.tipo === 'ingreso' ? '+' : '−'}${money(r.monto)}</b></div>
        </li>`).join('')}</ul></section>` : vacioMsg('Agrega tu sueldo, recargas y otros movimientos que se repiten.')}`;
  }

  // ---------- acciones ----------
  function aplicar(delta, msg) {
    if (delta) st.saldo = C.r2(st.saldo + delta);
    guardar();
    cerrar();
    render();
    toast(delta ? `${msg} · saldo ${delta > 0 ? '+' : '−'}${money(Math.abs(delta))} → ${money(st.saldo)}` : msg);
  }

  function toggleHecho(o) {
    if (!o) return;
    const nuevo = !o.hecho;
    if (o.src === 'mov') {
      const m = find(st.movs, o.id);
      if (!m) return;
      m.hecho = nuevo;
    } else if (o.src === 'meDeben' || o.src === 'debo') {
      const x = find(o.src === 'meDeben' ? st.meDeben : st.debo, o.id);
      if (!x) return;
      x.estado = nuevo ? 'pagado' : 'pendiente';
    } else if (nuevo) {
      st.hechos[o.key] = true;
    } else {
      delete st.hechos[o.key];
    }
    const delta = (o.tipo === 'ingreso' ? 1 : -1) * o.monto * (nuevo ? 1 : -1);
    aplicar(delta, nuevo ? 'Hecho' : 'Desmarcado');
  }

  function togglePagado(cual, id) {
    const x = find(st[cual], id);
    if (!x) return;
    const nuevo = x.estado !== 'pagado';
    x.estado = nuevo ? 'pagado' : 'pendiente';
    const signo = cual === 'meDeben' ? 1 : -1;
    aplicar(signo * x.monto * (nuevo ? 1 : -1), nuevo ? 'Pagado' : 'Pendiente');
  }

  function pagarMes(id) {
    const x = find(st.debo, id);
    if (!x) return;
    const p = C.pendientesMensual(st, x)[0];
    if (!p) return;
    st.hechos[p.key] = true;
    aplicar(-x.monto, `Pago de ${nombreMes(p.fecha)} hecho`);
  }

  function borrar(cual, item, yaAplicado) {
    const nombre = item.concepto || item.persona || item.aQuien || '';
    const extra = yaAplicado ? '\n\nYa está marcado como hecho/pagado: tu saldo actual no cambia.' : '';
    if (!confirm(`¿Eliminar "${nombre}"?${extra}`)) return;
    st[cual] = st[cual].filter((x) => x !== item);
    // limpiar marcas de ocurrencias generadas
    const pref = (cual === 'debo' ? 'd:' : 'r:') + item.id + ':';
    for (const mapa of [st.hechos, st.mover]) for (const k of Object.keys(mapa)) if (k.startsWith(pref)) delete mapa[k];
    aplicar(0, 'Eliminado');
  }

  function exportar() {
    const blob = new Blob([JSON.stringify(st, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `finanzas-${C.hoyISO()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  $('#archivo').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    let d;
    try { d = JSON.parse(await file.text()); } catch (_) { d = null; }
    const valido = d && typeof d === 'object' && ['movs', 'meDeben', 'debo', 'recs'].some((k) => Array.isArray(d[k]));
    if (!valido) return alert('Ese archivo no parece un respaldo de esta app.');
    if (!confirm('¿Reemplazar TODOS tus datos actuales con este respaldo?')) return;
    st = C.normalizar(d);
    aplicar(0, 'Respaldo importado');
  });

  // ---------- hoja inferior (formularios) ----------
  function abrir(html, montar) {
    const panel = $('#sheet .sheet-panel');
    panel.innerHTML = '';
    const w = document.createElement('div');
    w.innerHTML = html;
    panel.appendChild(w);
    $('#sheet').hidden = false;
    document.body.classList.add('modal');
    if (montar) montar(w);
    visibilidad(w);
  }

  function cerrar() {
    $('#sheet').hidden = true;
    document.body.classList.remove('modal');
    $('#sheet .sheet-panel').innerHTML = '';
  }

  $('#sheet').addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) cerrar();
  });

  // Muestra/oculta campos según otro campo: data-show="modo=mensual" o "clase=semanal|cadaDias"
  function visibilidad(w) {
    const f = $('form', w);
    if (!f) return;
    w.querySelectorAll('[data-show]').forEach((el) => {
      const [k, v] = el.dataset.show.split('=');
      const on = v.split('|').includes(f.elements[k].value);
      el.hidden = !on;
      el.querySelectorAll('input,select').forEach((i) => { i.disabled = !on; });
    });
  }

  const seg = (name, opts, val) => `<div class="seg">${opts.map(([v, t]) =>
    `<label><input type="radio" name="${name}" value="${v}" ${v === val ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div>`;

  const botonesForm = (ed) => `
    <p class="error"></p>
    <div class="acciones">
      <button class="btn pri" type="submit">Guardar</button>
      ${ed ? '<button class="btn danger" type="button" data-borrar>Eliminar</button>' : ''}
      <button class="btn ghost" type="button" data-close>Cancelar</button>
    </div>`;

  function montarForm(w, alGuardar, alBorrar) {
    const f = $('form', w);
    f.addEventListener('change', () => visibilidad(w));
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(f));
      const msg = alGuardar(d);
      if (msg) $('.error', f).textContent = msg;
    });
    const b = $('[data-borrar]', w);
    if (b && alBorrar) b.addEventListener('click', alBorrar);
  }

  function formSaldo() {
    abrir(`
      <h2>Saldo actual</h2>
      <form class="form">
        <label>¿Cuánto tienes ahora?<input name="saldo" type="number" step="any" value="${st.saldo}" required></label>
        ${botonesForm(false)}
      </form>`, (w) => {
      montarForm(w, (d) => {
        const n = num(d.saldo);
        if (!isFinite(n)) return 'Escribe un número';
        st.saldo = C.r2(n);
        aplicar(0, 'Saldo actualizado');
      });
      const i = $('input', w);
      i.focus();
      i.select();
    });
  }

  const efectoMov = (x) => (x.hecho ? (x.tipo === 'ingreso' ? 1 : -1) * x.monto : 0);

  function formMov(m) {
    const ed = !!m;
    const v = m || { tipo: 'gasto', concepto: '', monto: '', fecha: C.hoyISO(), hecho: false };
    abrir(`
      <h2>${ed ? 'Editar movimiento' : 'Nuevo movimiento'}</h2>
      <form class="form">
        ${seg('tipo', [['gasto', 'Gasto'], ['ingreso', 'Ingreso']], v.tipo)}
        <label>Concepto<input name="concepto" value="${esc(v.concepto)}" autocomplete="off" required></label>
        <label>Monto<input name="monto" inputmode="decimal" value="${v.monto}" placeholder="0" required></label>
        <label>Fecha<input name="fecha" type="date" value="${v.fecha}" required></label>
        <label class="check-l"><input type="checkbox" name="hecho" ${v.hecho ? 'checked' : ''}> Ya está hecho (ajusta el saldo actual)</label>
        ${botonesForm(ed)}
      </form>`, (w) => {
      montarForm(w, (d) => {
        const monto = num(d.monto);
        if (!d.concepto.trim()) return 'Escribe un concepto';
        if (!(monto > 0)) return 'Escribe un monto válido';
        if (!d.fecha) return 'Elige una fecha';
        const nuevo = { id: ed ? m.id : uid(), fecha: d.fecha, concepto: d.concepto.trim(), monto: C.r2(monto), tipo: d.tipo, hecho: !!d.hecho };
        const delta = efectoMov(nuevo) - (ed ? efectoMov(m) : 0);
        if (ed) Object.assign(m, nuevo); else st.movs.push(nuevo);
        aplicar(delta, ed ? 'Movimiento actualizado' : 'Movimiento agregado');
      }, () => borrar('movs', m, m.hecho));
      if (!ed) $('input[name=concepto]', w).focus();
    });
  }

  const efectoMeDeben = (x) => (x.estado === 'pagado' ? x.monto : 0);

  function formMeDeben(x) {
    const ed = !!x;
    const v = x || { persona: '', concepto: '', monto: '', fecha: '', estado: 'pendiente' };
    const nombres = [...new Set(st.meDeben.map((p) => p.persona.trim()))];
    abrir(`
      <h2>${ed ? 'Editar' : 'Alguien me debe'}</h2>
      <form class="form">
        <label>Persona<input name="persona" list="personas" value="${esc(v.persona)}" autocomplete="off" required></label>
        <datalist id="personas">${nombres.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
        <label>Concepto <small>(opcional)</small><input name="concepto" value="${esc(v.concepto)}" autocomplete="off"></label>
        <label>Monto<input name="monto" inputmode="decimal" value="${v.monto}" placeholder="0" required></label>
        <label>Fecha esperada <small>(opcional: si la pones, aparece en Semanas)</small><input name="fecha" type="date" value="${v.fecha || ''}"></label>
        <div class="lbl-f">Estado</div>
        ${seg('estado', [['pendiente', 'Pendiente'], ['pagado', 'Pagado']], v.estado)}
        ${botonesForm(ed)}
      </form>`, (w) => {
      montarForm(w, (d) => {
        const monto = num(d.monto);
        if (!d.persona.trim()) return 'Escribe el nombre';
        if (!(monto > 0)) return 'Escribe un monto válido';
        const nuevo = { id: ed ? x.id : uid(), persona: d.persona.trim(), concepto: d.concepto.trim(), monto: C.r2(monto), fecha: d.fecha || null, estado: d.estado };
        const delta = efectoMeDeben(nuevo) - (ed ? efectoMeDeben(x) : 0);
        if (ed) Object.assign(x, nuevo); else st.meDeben.push(nuevo);
        aplicar(delta, ed ? 'Actualizado' : 'Agregado');
      }, () => borrar('meDeben', x, x.estado === 'pagado'));
    });
  }

  const efectoDebo = (x) => (x.modo === 'unico' && x.estado === 'pagado' ? -x.monto : 0);

  function formDebo(x) {
    const ed = !!x;
    const v = x || { aQuien: '', concepto: '', monto: '', modo: 'unico', fecha: '', dia: '', estado: 'pendiente' };
    abrir(`
      <h2>${ed ? 'Editar deuda' : 'Nueva deuda'}</h2>
      <form class="form">
        <label>¿A quién?<input name="aQuien" value="${esc(v.aQuien)}" autocomplete="off" required></label>
        <label>Concepto <small>(opcional)</small><input name="concepto" value="${esc(v.concepto)}" autocomplete="off"></label>
        <label>Monto<input name="monto" inputmode="decimal" value="${v.monto}" placeholder="0" required></label>
        ${seg('modo', [['unico', 'Pago único'], ['mensual', 'Mensual']], v.modo)}
        <label data-show="modo=unico">Fecha límite <small>(opcional)</small><input name="fecha" type="date" value="${v.fecha || ''}"></label>
        <label data-show="modo=mensual">Día límite del mes<input name="dia" type="number" min="1" max="31" inputmode="numeric" value="${v.dia || ''}" placeholder="Ej. 8"></label>
        <div class="lbl-f">Estado</div>
        ${seg('estado', [['pendiente', 'Pendiente'], ['pagado', 'Pagado']], v.estado)}
        <p class="hint" data-show="modo=mensual">Cada mes se genera el pago en Semanas. Márcalo como <b>Pagado</b> solo cuando termines de pagar la deuda completa.</p>
        ${botonesForm(ed)}
      </form>`, (w) => {
      montarForm(w, (d) => {
        const monto = num(d.monto);
        if (!d.aQuien.trim()) return 'Escribe a quién le debes';
        if (!(monto > 0)) return 'Escribe un monto válido';
        const dia = parseInt(d.dia, 10);
        if (d.modo === 'mensual' && !(dia >= 1 && dia <= 31)) return 'Día del mes entre 1 y 31';
        const nuevo = {
          id: ed ? x.id : uid(), aQuien: d.aQuien.trim(), concepto: d.concepto.trim(), monto: C.r2(monto),
          modo: d.modo, fecha: d.modo === 'unico' ? d.fecha || null : null, dia: d.modo === 'mensual' ? dia : null,
          inicio: (ed && x.inicio) || C.hoyISO(), estado: d.estado,
        };
        const delta = efectoDebo(nuevo) - (ed ? efectoDebo(x) : 0);
        if (ed) Object.assign(x, nuevo); else st.debo.push(nuevo);
        aplicar(delta, ed ? 'Deuda actualizada' : 'Deuda agregada');
      }, () => borrar('debo', x, x.modo === 'unico' && x.estado === 'pagado'));
    });
  }

  function formRec(r) {
    const ed = !!r;
    const v = r || { clase: 'semanal', concepto: '', tipo: 'ingreso', monto: '', montoB: '', cadaDias: '', inicio: C.hoyISO() };
    abrir(`
      <h2>${ed ? 'Editar recurrente' : 'Nuevo recurrente'}</h2>
      <form class="form">
        <label>¿Cada cuándo?
          <select name="clase">
            <option value="semanal" ${v.clase === 'semanal' ? 'selected' : ''}>Cada semana (ej. sueldo)</option>
            <option value="cadaDias" ${v.clase === 'cadaDias' ? 'selected' : ''}>Cada X días</option>
            <option value="mensual" ${v.clase === 'mensual' ? 'selected' : ''}>Mensual sin día fijo (estimado)</option>
          </select>
        </label>
        ${seg('tipo', [['ingreso', 'Ingreso'], ['gasto', 'Gasto']], v.tipo)}
        <label>Concepto<input name="concepto" value="${esc(v.concepto)}" autocomplete="off" required></label>
        <label>Monto<input name="monto" inputmode="decimal" value="${v.monto}" placeholder="0" required></label>
        <label data-show="clase=semanal">Monto semanas alternas <small>(opcional: semana A = monto de arriba, semana B = este)</small><input name="montoB" inputmode="decimal" value="${v.montoB || ''}" placeholder="Igual cada semana"></label>
        <label data-show="clase=cadaDias">Cada cuántos días<input name="cadaDias" type="number" min="1" inputmode="numeric" value="${v.cadaDias || ''}" placeholder="Ej. 15"></label>
        <label data-show="clase=semanal|cadaDias">Primera fecha<input name="inicio" type="date" value="${v.inicio || C.hoyISO()}"></label>
        <p class="hint" data-show="clase=mensual">Se pone como estimado el último día de cada mes. Desde Semanas lo puedes mover a la fecha real.</p>
        ${botonesForm(ed)}
      </form>`, (w) => {
      montarForm(w, (d) => {
        const monto = num(d.monto);
        if (!d.concepto.trim()) return 'Escribe un concepto';
        if (!(monto > 0)) return 'Escribe un monto válido';
        const nuevo = { id: ed ? r.id : uid(), clase: d.clase, concepto: d.concepto.trim(), tipo: d.tipo, monto: C.r2(monto), montoB: null, cadaDias: null, inicio: (ed && r.inicio) || C.hoyISO() };
        if (d.clase === 'semanal' || d.clase === 'cadaDias') {
          if (!d.inicio) return 'Elige la primera fecha';
          nuevo.inicio = d.inicio;
        }
        if (d.clase === 'semanal' && String(d.montoB || '').trim()) {
          const b = num(d.montoB);
          if (!(b > 0)) return 'Monto de semanas alternas inválido';
          nuevo.montoB = C.r2(b);
        }
        if (d.clase === 'cadaDias') {
          const n = parseInt(d.cadaDias, 10);
          if (!(n >= 1)) return 'Escribe cada cuántos días';
          nuevo.cadaDias = n;
        }
        if (ed) Object.assign(r, nuevo); else st.recs.push(nuevo);
        aplicar(0, ed ? 'Recurrente actualizado' : 'Recurrente agregado');
      }, () => borrar('recs', r, false));
    });
  }

  const ORIGEN = { mov: 'Movimiento único', meDeben: 'De “Me deben”', debo: 'De “Debo” (pago único)', deboMes: 'De “Debo” (mensual)', rec: 'Movimiento recurrente' };

  function detalleOc(o) {
    if (!o) return;
    abrir(`
      <h2>${esc(o.concepto)}</h2>
      <p class="det"><b class="${o.tipo === 'ingreso' ? 'ing' : ''}">${signed(o)}</b> · ${fLarga(o.fecha)}${o.atrasado ? ' · <span class="tag warn">atrasado</span>' : ''}</p>
      <p class="hint">${ORIGEN[o.src]}${o.hecho ? ' · hecho' : ''}</p>
      <div class="acciones">
        <button class="btn pri" data-s="hecho">${o.hecho ? 'Desmarcar hecho' : 'Marcar como hecho'}</button>
        ${o.movible && !o.hecho ? '<button class="btn" data-s="mover">Mover fecha</button>' : ''}
        <button class="btn" data-s="editar">Editar</button>
        <button class="btn ghost" data-close>Cerrar</button>
      </div>`, (w) => {
      w.addEventListener('click', (e) => {
        const b = e.target.closest('[data-s]');
        if (!b) return;
        const s = b.dataset.s;
        if (s === 'hecho') return toggleHecho(o);
        if (s === 'mover') return formMover(o);
        if (s === 'editar') {
          if (o.src === 'mov') return formMov(find(st.movs, o.id));
          if (o.src === 'meDeben') return formMeDeben(find(st.meDeben, o.id));
          if (o.src === 'debo' || o.src === 'deboMes') return formDebo(find(st.debo, o.id));
          if (o.src === 'rec') return formRec(find(st.recs, o.id));
        }
      });
    });
  }

  function formMover(o) {
    abrir(`
      <h2>Mover “${esc(o.concepto)}”</h2>
      <form class="form">
        <label>Nueva fecha<input name="fecha" type="date" value="${o.fecha}" required></label>
        <p class="error"></p>
        <div class="acciones">
          <button class="btn pri" type="submit">Guardar</button>
          ${st.mover[o.key] ? '<button class="btn" type="button" data-reset>Regresar a fin de mes</button>' : ''}
          <button class="btn ghost" type="button" data-close>Cancelar</button>
        </div>
      </form>`, (w) => {
      montarForm(w, (d) => {
        if (!d.fecha) return 'Elige una fecha';
        if (d.fecha === o.fechaDefault) delete st.mover[o.key];
        else st.mover[o.key] = d.fecha;
        aplicar(0, 'Fecha movida');
      });
      const r = $('[data-reset]', w);
      if (r) r.addEventListener('click', () => { delete st.mover[o.key]; aplicar(0, 'Regresado a fin de mes'); });
    });
  }

  // ---------- eventos globales ----------
  $('#vista').addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const id = el.dataset.id;
    switch (el.dataset.act) {
      case 'reintentar': return location.reload();
      case 'editar-saldo': return formSaldo();
      case 'ir': tab = el.dataset.tab; render(); return window.scrollTo(0, 0);
      case 'exportar': return exportar();
      case 'importar': return $('#archivo').click();
      case 'hecho': return toggleHecho(ocMap.get(el.dataset.key));
      case 'detalle': return detalleOc(ocMap.get(el.dataset.key));
      case 'nuevo-medeben': return formMeDeben();
      case 'editar-medeben': return formMeDeben(find(st.meDeben, id));
      case 'pago-medeben': return togglePagado('meDeben', id);
      case 'nuevo-debo': return formDebo();
      case 'editar-debo': return formDebo(find(st.debo, id));
      case 'pago-debo': return togglePagado('debo', id);
      case 'pago-mes': return pagarMes(id);
      case 'nuevo-rec': return formRec();
      case 'editar-rec': return formRec(find(st.recs, id));
    }
  });

  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    tab = b.dataset.tab;
    render();
    window.scrollTo(0, 0);
  });

  $('#fab').addEventListener('click', () => formMov());

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && enApp && clave) {
      render(); // por si cambió el día
      sincronizar();
    }
  });
  window.addEventListener('online', () => { if (enApp && clave) sincronizar(); });

  let toastT;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(() => { t.hidden = true; }, 2800);
  }

  iniciar();
})();

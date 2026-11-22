(function () {
  'use strict';
  const C = window.Calc;
  const CFG = window.FIN_CONFIG || {};
  const LS = { cache: 'fin_cache', pend: 'fin_pendiente' };

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
  let bajando = false, remotoPendiente = false, ultimoGuardado = null;
  const hojaAbierta = () => !$('#sheet').hidden;

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
      ultimoGuardado = await rpc('fin_guardar', { p_clave: clave, p_datos: st });
      ok = true;
    } catch (e) {
      sucio = true;
      guardando = false;
      if (e.invalida) return sinAcceso();
      setSync('offline');
      return;
    }
    guardando = false;
    if (ok && sucio) return subir(); // hubo cambios mientras se guardaba
    localStorage.removeItem(LS.pend);
    setSync('ok');
  }

  // Trae lo último de Supabase (o sube lo pendiente si hay cambios sin guardar).
  // Con un formulario abierto espera a que se cierre, para no perder lo que estás capturando.
  async function sincronizar() {
    if (!clave) return;
    if (localStorage.getItem(LS.pend)) {
      sucio = true;
      return subir();
    }
    if (guardando || sucio || bajando) return;
    if (hojaAbierta()) { remotoPendiente = true; return; }
    bajando = true;
    try {
      const d = await rpc('fin_cargar', { p_clave: clave });
      if (guardando || sucio || localStorage.getItem(LS.pend)) return;
      if (hojaAbierta()) { remotoPendiente = true; return; }
      const nuevo = C.normalizar(d);
      const cambio = JSON.stringify(nuevo) !== JSON.stringify(st);
      st = nuevo;
      localStorage.setItem(LS.cache, JSON.stringify(st));
      setSync('ok');
      if (cambio) render();
    } catch (e) {
      if (e.invalida) return sinAcceso();
      setSync('offline');
    } finally {
      bajando = false;
    }
  }

  // ---------- tiempo real ----------
  // La base de datos avisa (Supabase Realtime) cada vez que se guardan los datos desde cualquier dispositivo.
  let canal = null;
  function tiempoReal() {
    if (canal || !window.supabase || !window.supabase.createClient) return;
    try {
      const cli = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      canal = cli.channel('finanzas')
        .on('broadcast', { event: 'cambio' }, (m) => {
          const at = m && m.payload && m.payload.actualizado;
          if (at && at === ultimoGuardado) return; // lo guardó este mismo dispositivo
          sincronizar();
        })
        .subscribe((estado) => {
          if (estado === 'SUBSCRIBED') sincronizar(); // al (re)conectar, por si algo cambió mientras tanto
        });
    } catch (_) {
      canal = null; // sin tiempo real: queda la revisión periódica
    }
  }

  // ---------- actualización automática de la app ----------
  // Si se publicó una versión nueva (cambia la huella ETag de algún archivo), la app se recarga sola.
  const ARCHIVOS_APP = ['./', 'app.js', 'calc.js', 'styles.css', 'config.js'];
  let firmaApp = null;
  async function revisarVersion() {
    if (!/^https?:$/.test(location.protocol)) return;
    try {
      const etags = await Promise.all(ARCHIVOS_APP.map((f) =>
        fetch(f, { method: 'HEAD', cache: 'no-store' }).then((r) => (r.ok && r.headers.get('etag')) || '')));
      if (etags.some((e) => !e)) return;
      const firma = etags.join('|');
      if (firmaApp === null) { firmaApp = firma; return; }
      if (firma === firmaApp || hojaAbierta() || sucio || guardando) return;
      const ultima = Number(sessionStorage.getItem('fin_recarga') || 0);
      if (Date.now() - ultima < 5 * 60 * 1000) return; // nunca más de una recarga cada 5 minutos
      sessionStorage.setItem('fin_recarga', String(Date.now()));
      sessionStorage.setItem('fin_actualizada', '1');
      location.reload();
    } catch (_) { /* sin conexión */ }
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
    return u && k && CFG.clave && !/TU-PROYECTO|TU-ANON/.test(u + k);
  }

  async function iniciar() {
    registrarSW();
    if (!configurado()) {
      return pantalla('Falta configurar Supabase', 'Edita <b>config.js</b> con la URL, la anon key y la clave de tus datos.');
    }
    clave = CFG.clave;
    localStorage.removeItem('fin_clave'); // de la versión que pedía clave

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
      if (e.invalida) return sinAcceso();
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

  // La clave de config.js no existe en Supabase. Los cambios locales se conservan en el teléfono.
  function sinAcceso() {
    cerrar();
    pantalla('No se encontraron tus datos', 'Supabase no reconoce la clave de <b>config.js</b>. Revisa que coincida con la de la tabla <b>finanzas</b>.', true);
  }

  function mostrarApp() {
    enApp = true;
    $('#tabs').hidden = false;
    $('#fab').hidden = false;
    render();
    tiempoReal();
    revisarVersion(); // toma la huella de la versión actual
    if (sessionStorage.getItem('fin_actualizada')) {
      sessionStorage.removeItem('fin_actualizada');
      toast('App actualizada a la última versión');
    }
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

  const ICONOS = {
    efectivo: '<svg viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/></svg>',
    tarjeta: '<svg viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/></svg>',
    otra: '<svg viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="12" rx="2"/><path d="M3 9V7a2 2 0 0 1 2-2h11v2"/><circle cx="16.5" cy="13" r="1.2"/></svg>',
  };
  const icono = (c) => `<span class="ico">${ICONOS[c.tipo] || ICONOS.otra}</span>`;

  function vInicio() {
    const sem = C.calcularSemanas(st);
    const saldo = C.saldoTotal(st);
    const md = C.totalMeDeben(st);
    const db = C.totalDebo(st);
    const neto = C.r2(saldo + md - db);
    const varias = st.cuentas.length > 1;
    return `
      <section class="card saldo">
        <div class="lbl">Saldo actual</div>
        <div class="big ${negc(saldo)}">${money(saldo)}</div>
        <ul class="cuentas">
          ${st.cuentas.map((c) => `
            <li data-act="editar-cuenta" data-id="${esc(c.id)}">
              ${icono(c)}
              <span class="nom">${esc(c.nombre)}${varias && c.id === st.principal ? ' <span class="tag">principal</span>' : ''}</span>
              <b class="${negc(c.saldo)}">${money(c.saldo)}</b>
            </li>`).join('')}
        </ul>
        <button class="link" data-act="nueva-cuenta">+ Agregar tarjeta, efectivo u otra cuenta</button>
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
      ${vInstalar()}
      <section class="card">
        <div class="lbl">Respaldo</div>
        <div class="botones">
          <button class="btn" data-act="exportar">Exportar JSON</button>
          <button class="btn" data-act="importar">Importar JSON</button>
        </div>
      </section>`;
  }

  // ---------- acceso directo (instalar en la pantalla de inicio) ----------
  let avisoInstalar = null; // evento beforeinstallprompt (Android / Chrome)
  const instalada = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const esIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    avisoInstalar = e;
    if (tab === 'inicio') render();
  });
  window.addEventListener('appinstalled', () => {
    avisoInstalar = null;
    render();
    toast('App instalada en tu pantalla de inicio');
  });

  async function instalar() {
    if (!avisoInstalar) return;
    avisoInstalar.prompt();
    await avisoInstalar.userChoice.catch(() => {});
    avisoInstalar = null;
    render();
  }

  function vInstalar() {
    const movil = /android|iphone|ipad|ipod/i.test(navigator.userAgent) || esIOS();
    if (instalada() || (!avisoInstalar && !movil)) return '';
    if (avisoInstalar) {
      return `
        <section class="card fila">
          <div><div class="lbl">Acceso directo</div><div class="hint">Ponla en la pantalla de inicio de tu celular</div></div>
          <button class="btn pri" data-act="instalar">Instalar</button>
        </section>`;
    }
    const pasos = esIOS()
      ? 'En Safari toca <b>Compartir</b> (el cuadro con la flecha) y luego <b>Agregar a inicio</b>.'
      : 'En el menú <b>⋮</b> del navegador elige <b>Instalar app</b> o <b>Agregar a pantalla principal</b>.';
    return `<section class="card"><div class="lbl">Acceso directo</div><p class="hint">${pasos}</p></section>`;
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
    // Préstamos en el orden en que te los pidió (el id lleva la hora de creación).
    const orden = (a, b) => String(a.fechaPrestamo || '').localeCompare(String(b.fechaPrestamo || '')) || String(a.id).localeCompare(String(b.id));
    return `
      <section class="card fila"><div class="lbl">Total que me deben</div><div class="val ing">${money(total)}</div></section>
      <button class="btn pri block" data-act="nuevo-medeben">+ Agregar persona</button>
      ${lista.length ? lista.map((g) => `
        <section class="card">
          <header class="fila grupo-h">
            <div><b>${esc(g.nombre)}</b><div class="hint">${g.items.length === 1 ? '1 préstamo'
              : `${g.items.length} préstamos · ${money(g.items.reduce((a, x) => a + x.monto, 0))} en total`}</div></div>
            <div class="der">${g.pend ? `<div class="hint">Me debe</div><b class="ing">${money(g.pend)}</b>` : '<span class="muted">Todo pagado</span>'}</div>
          </header>
          <ul class="items">${g.items.sort(orden).map((x, i) => itemMeDeben(x, i + 1)).join('')}</ul>
          <button class="link" data-act="nuevo-prestamo" data-persona="${esc(g.nombre)}">+ Otro préstamo a ${esc(g.nombre)}</button>
        </section>`).join('') : vacioMsg('Nadie te debe nada por ahora.')}`;
  }

  function itemMeDeben(x, n) {
    const pag = x.estado === 'pagado';
    const vencido = !pag && x.fecha && x.fecha < C.hoyISO();
    const fechas = [
      x.fechaPrestamo ? 'te pidió ' + fCorta(x.fechaPrestamo) : '',
      x.fecha ? 'paga ' + fCorta(x.fecha) : '',
    ].filter(Boolean).join(' · ');
    return `
      <li class="item ${pag ? 'pagado' : ''}" data-act="editar-medeben" data-id="${x.id}">
        <div class="item-main">
          <div class="l1">Préstamo ${n}${x.concepto ? ` · ${esc(x.concepto)}` : ''}</div>
          <div class="l2">${fechas || 'sin fechas'} ${vencido ? '<span class="tag warn">vencido</span>' : ''}</div>
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
      if (x.modo === 'tarjeta') { const p = C.pendientesTarjeta(x)[0]; return p ? p.fecha : '~'; }
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
    } else if (x.modo === 'tarjeta') {
      const pend = C.pendientesTarjeta(x);
      const atr = pend.filter((p) => p.fecha < C.hoyISO()).length;
      const deuda = Math.max(0, x.deuda || 0);
      const lineas = [
        'Tarjeta' + (x.limite ? ` · límite ${money(x.limite)} · disponible <b class="${negc(x.limite - deuda)}">${money(x.limite - deuda)}</b>` : ''),
        `Pago ${money(x.monto)} antes del día ${x.dia}` + (pend[0] ? ` · próximo ${fCorta(pend[0].fecha)}` : ''),
      ];
      sub = lineas.join('<br>') + (atr ? ` <span class="tag warn">${atr} atrasado${atr > 1 ? 's' : ''}</span>` : '');
      monto = `${money(deuda)}<small> debes</small>`;
      boton = deuda <= 0 || !pend[0]
        ? '<span class="estado ok">Liquidada</span>'
        : `<button class="estado" data-act="pago-tarjeta" data-id="${x.id}">Pagar ${nombreMes(pend[0].fecha)}</button>`;
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
  // Cuenta por id; si no existe (o es null) usa la principal.
  const cuentaDe = (id) => find(st.cuentas, id) || find(st.cuentas, st.principal) || st.cuentas[0];

  // cambios: [[idCuenta, delta], ...] — se suman a cada cuenta y se avisa qué cambió.
  function aplicar(cambios, msg) {
    const porCuenta = new Map();
    for (const [id, delta] of cambios || []) {
      if (!delta) continue;
      const c = cuentaDe(id);
      porCuenta.set(c, C.r2((porCuenta.get(c) || 0) + delta));
    }
    const partes = [];
    for (const [c, delta] of porCuenta) {
      if (!delta) continue;
      c.saldo = C.r2(c.saldo + delta);
      partes.push(`${c.nombre} ${delta > 0 ? '+' : '−'}${money(Math.abs(delta))}`);
    }
    guardar();
    cerrar();
    render();
    toast(partes.length ? `${msg} · ${partes.join(', ')}` : msg);
  }

  const negar = (cambios) => cambios.map(([c, d]) => [c, -d]);

  // Con una sola cuenta la usa directo; con varias pregunta en cuál.
  function elegirCuenta(titulo, sugerida, alElegir) {
    if (st.cuentas.length < 2) return alElegir(st.cuentas[0].id);
    const def = cuentaDe(sugerida).id;
    abrir(`
      <h2>${titulo}</h2>
      <div class="acciones">
        ${st.cuentas.map((c) => `
          <button class="btn cuenta-btn ${c.id === def ? 'sel' : ''}" data-cuenta="${esc(c.id)}">
            ${icono(c)}<span class="nom">${esc(c.nombre)}</span><span class="muted">${money(c.saldo)}</span>
          </button>`).join('')}
        <button class="btn ghost" data-close>Cancelar</button>
      </div>`, (w) => {
      w.addEventListener('click', (e) => {
        const b = e.target.closest('[data-cuenta]');
        if (b) alElegir(b.dataset.cuenta);
      });
    });
  }
  const preguntaCuenta = (tipo) => (tipo === 'ingreso' ? '¿A qué cuenta entró?' : '¿De qué cuenta salió?');

  // Pago de tarjeta: pregunta cuánto pagaste y de qué cuenta; baja lo que debes.
  function formPagoTarjeta(x, cuota) {
    abrir(`
      <h2>Pagar ${esc(x.aQuien)} · ${nombreMes(cuota.fecha)}</h2>
      <form class="form">
        <p class="hint">Debes ${money(Math.max(0, x.deuda || 0))} · pago del mes ${money(cuota.monto)}</p>
        <label>¿Cuánto pagaste?<input name="monto" inputmode="decimal" value="${cuota.monto}" required></label>
        ${selCuenta('cuenta', '¿De qué cuenta salió?', null)}
        ${botonesForm(false)}
      </form>`, (w) => {
      montarForm(w, (d) => {
        const monto = C.r2(num(d.monto));
        if (!(monto > 0)) return 'Escribe un monto válido';
        const cta = d.cuenta || null;
        x.pagos = x.pagos || {};
        x.pagos[cuota.mes] = { monto, cuenta: cta };
        x.deuda = C.r2((x.deuda || 0) - monto);
        aplicar([[cta, -monto]], `Pago de ${nombreMes(cuota.fecha)} hecho`);
      });
      const i = $('input[name=monto]', w);
      i.focus();
      i.select();
    });
  }

  function deshacerPagoTarjeta(x, mes) {
    const p = x.pagos && x.pagos[mes];
    if (!p) return;
    delete x.pagos[mes];
    x.deuda = C.r2((x.deuda || 0) + p.monto);
    aplicar([[p.cuenta, p.monto]], 'Pago desmarcado');
  }

  function toggleHecho(o) {
    if (!o) return;
    if (o.src === 'tarjeta') {
      const x = find(st.debo, o.id);
      if (!x) return;
      return o.hecho ? deshacerPagoTarjeta(x, o.mes) : formPagoTarjeta(x, o);
    }
    const signo = o.tipo === 'ingreso' ? 1 : -1;
    const m = o.src === 'mov' ? find(st.movs, o.id) : null;
    const x = o.src === 'meDeben' ? find(st.meDeben, o.id) : o.src === 'debo' ? find(st.debo, o.id) : null;
    if ((o.src === 'mov' && !m) || ((o.src === 'meDeben' || o.src === 'debo') && !x)) return;

    if (o.hecho) { // desmarcar: se revierte en la cuenta donde se aplicó
      let cta;
      if (m) { cta = m.cuenta; m.hecho = false; }
      else if (x) { cta = x.cuentaPago; x.estado = 'pendiente'; x.cuentaPago = null; }
      else { cta = typeof st.hechos[o.key] === 'string' ? st.hechos[o.key] : null; delete st.hechos[o.key]; }
      return aplicar([[cta, -signo * o.monto]], 'Desmarcado');
    }
    elegirCuenta(preguntaCuenta(o.tipo), m ? m.cuenta : null, (cta) => {
      if (m) { m.hecho = true; m.cuenta = cta; }
      else if (x) { x.estado = 'pagado'; x.cuentaPago = cta; }
      else st.hechos[o.key] = cta;
      aplicar([[cta, signo * o.monto]], 'Hecho');
    });
  }

  function togglePagado(cual, id) {
    const x = find(st[cual], id);
    if (!x) return;
    const signo = cual === 'meDeben' ? 1 : -1;
    if (x.estado === 'pagado') {
      const cta = x.cuentaPago;
      x.estado = 'pendiente';
      x.cuentaPago = null;
      return aplicar([[cta, -signo * x.monto]], 'Pendiente');
    }
    elegirCuenta(preguntaCuenta(signo > 0 ? 'ingreso' : 'gasto'), null, (cta) => {
      x.estado = 'pagado';
      x.cuentaPago = cta;
      aplicar([[cta, signo * x.monto]], 'Pagado');
    });
  }

  function pagarMes(id) {
    const x = find(st.debo, id);
    if (!x) return;
    const p = C.pendientesMensual(st, x)[0];
    if (!p) return;
    elegirCuenta(preguntaCuenta('gasto'), null, (cta) => {
      st.hechos[p.key] = cta;
      aplicar([[cta, -x.monto]], `Pago de ${nombreMes(p.fecha)} hecho`);
    });
  }

  function borrar(cual, item, yaAplicado) {
    const nombre = item.concepto || item.persona || item.aQuien || '';
    const extra = yaAplicado ? '\n\nYa está marcado como hecho/pagado: el saldo de tus cuentas no cambia.' : '';
    if (!confirm(`¿Eliminar "${nombre}"?${extra}`)) return;
    st[cual] = st[cual].filter((x) => x !== item);
    // limpiar marcas de ocurrencias generadas
    const pref = (cual === 'debo' ? 'd:' : 'r:') + item.id + ':';
    for (const mapa of [st.hechos, st.mover]) for (const k of Object.keys(mapa)) if (k.startsWith(pref)) delete mapa[k];
    aplicar([], 'Eliminado');
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
    aplicar([], 'Respaldo importado');
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
    // Llegó un cambio de otro dispositivo mientras el formulario estaba abierto: aplicarlo ahora.
    if (remotoPendiente) {
      remotoPendiente = false;
      setTimeout(sincronizar, 0);
    }
  }

  $('#sheet').addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) cerrar();
  });

  // Muestra/oculta campos según otros: data-show="modo=mensual", "clase=semanal|cadaDias",
  // "modo=unico&estado=pagado" o, para casillas, "hecho=si".
  function visibilidad(w) {
    const f = $('form', w);
    if (!f) return;
    const valor = (k) => {
      const el = f.elements[k];
      return el && el.type === 'checkbox' ? (el.checked ? 'si' : 'no') : el ? el.value : '';
    };
    w.querySelectorAll('[data-show]').forEach((el) => {
      const on = el.dataset.show.split('&').every((cond) => {
        const [k, v] = cond.split('=');
        return v.split('|').includes(valor(k));
      });
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

  // Selector de cuenta (solo si hay más de una). show: condición data-show opcional.
  const selCuenta = (name, label, val, show) => (st.cuentas.length < 2 ? '' : `
    <label ${show ? `data-show="${show}"` : ''}>${label}
      <select name="${name}">${st.cuentas.map((c) =>
        `<option value="${esc(c.id)}" ${c.id === cuentaDe(val).id ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}
      </select>
    </label>`);

  function formCuenta(c) {
    const ed = !!c;
    const v = c || { nombre: '', tipo: 'tarjeta', saldo: '' };
    const conPrincipal = !ed || st.cuentas.length > 1;
    abrir(`
      <h2>${ed ? 'Editar cuenta' : 'Nueva cuenta'}</h2>
      <form class="form">
        ${seg('tipo', [['efectivo', 'Efectivo'], ['tarjeta', 'Tarjeta'], ['otra', 'Otra']], v.tipo)}
        <label>Nombre<input name="nombre" value="${esc(v.nombre)}" placeholder="Ej. BBVA, Nu, Mercado Pago" autocomplete="off" required></label>
        <label>¿Cuánto tienes ahí?<input name="saldo" type="number" step="any" value="${v.saldo}" placeholder="0" required></label>
        ${conPrincipal ? `<label class="check-l"><input type="checkbox" name="principal" ${ed && st.principal === c.id ? 'checked' : ''}> Cuenta principal <small>(sale seleccionada al registrar pagos)</small></label>` : ''}
        ${botonesForm(ed && st.cuentas.length > 1)}
      </form>`, (w) => {
      montarForm(w, (d) => {
        const n = num(d.saldo);
        if (!d.nombre.trim()) return 'Escribe un nombre';
        if (!isFinite(n)) return 'Escribe cuánto tienes';
        const nueva = { id: ed ? c.id : uid(), nombre: d.nombre.trim(), tipo: d.tipo, saldo: C.r2(n) };
        if (ed) Object.assign(c, nueva); else st.cuentas.push(nueva);
        if (d.principal) st.principal = nueva.id;
        aplicar([], ed ? 'Cuenta actualizada' : 'Cuenta agregada');
      }, () => {
        if (!confirm(`¿Eliminar "${c.nombre}"? Su saldo (${money(c.saldo)}) dejará de contarse.`)) return;
        st.cuentas = st.cuentas.filter((x) => x !== c);
        if (st.principal === c.id) st.principal = st.cuentas[0].id;
        aplicar([], 'Cuenta eliminada');
      });
      if (ed) { const i = $('input[name=saldo]', w); i.focus(); i.select(); }
      else $('input[name=nombre]', w).focus();
    });
  }

  const efMov = (m) => (m.hecho ? [[m.cuenta, (m.tipo === 'ingreso' ? 1 : -1) * m.monto]] : []);

  function formMov(m) {
    const ed = !!m;
    const v = m || { tipo: 'gasto', concepto: '', monto: '', fecha: C.hoyISO(), hecho: false, cuenta: null };
    abrir(`
      <h2>${ed ? 'Editar movimiento' : 'Nuevo movimiento'}</h2>
      <form class="form">
        ${seg('tipo', [['gasto', 'Gasto'], ['ingreso', 'Ingreso']], v.tipo)}
        <label>Concepto<input name="concepto" value="${esc(v.concepto)}" autocomplete="off" required></label>
        <label>Monto<input name="monto" inputmode="decimal" value="${v.monto}" placeholder="0" required></label>
        <label>Fecha<input name="fecha" type="date" value="${v.fecha}" required></label>
        <label class="check-l"><input type="checkbox" name="hecho" ${v.hecho ? 'checked' : ''}> Ya está hecho (ajusta tu saldo)</label>
        ${selCuenta('cuenta', 'Cuenta', v.cuenta, 'hecho=si')}
        ${botonesForm(ed)}
      </form>`, (w) => {
      montarForm(w, (d) => {
        const monto = num(d.monto);
        if (!d.concepto.trim()) return 'Escribe un concepto';
        if (!(monto > 0)) return 'Escribe un monto válido';
        if (!d.fecha) return 'Elige una fecha';
        const nuevo = {
          id: ed ? m.id : uid(), fecha: d.fecha, concepto: d.concepto.trim(), monto: C.r2(monto), tipo: d.tipo,
          hecho: !!d.hecho, cuenta: d.cuenta || (ed ? m.cuenta : null) || null,
        };
        const antes = ed ? efMov(m) : [];
        if (ed) Object.assign(m, nuevo); else st.movs.push(nuevo);
        aplicar([...negar(antes), ...efMov(nuevo)], ed ? 'Movimiento actualizado' : 'Movimiento agregado');
      }, () => borrar('movs', m, m.hecho));
      if (!ed) $('input[name=concepto]', w).focus();
    });
  }

  // Un préstamo afecta tus cuentas si salió dinero al prestarlo y cuando te lo pagan.
  const efMeDeben = (x) => [
    ...(x.estado === 'pagado' ? [[x.cuentaPago, x.monto]] : []),
    ...(x.cuentaSalida ? [[x.cuentaSalida, -x.monto]] : []),
  ];

  function formMeDeben(x, persona) {
    const ed = !!x;
    const v = x || { persona: persona || '', concepto: '', monto: '', fechaPrestamo: C.hoyISO(), fecha: '', estado: 'pendiente', cuentaPago: null, cuentaSalida: null };
    const nombres = [...new Set(st.meDeben.map((p) => p.persona.trim()))];
    const titulo = ed ? `Préstamo de ${esc(x.persona)}` : persona ? `Otro préstamo a ${esc(persona)}` : 'Nueva persona';
    abrir(`
      <h2>${titulo}</h2>
      <form class="form">
        <label>Persona<input name="persona" list="personas" value="${esc(v.persona)}" autocomplete="off" required></label>
        <datalist id="personas">${nombres.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
        <label>¿Cuánto te pidió?<input name="monto" inputmode="decimal" value="${v.monto}" placeholder="0" required></label>
        <label>¿Cuándo te lo pidió?<input name="fechaPrestamo" type="date" value="${v.fechaPrestamo || ''}"></label>
        <label>Concepto <small>(opcional)</small><input name="concepto" value="${esc(v.concepto)}" autocomplete="off"></label>
        <label>¿Cuándo te va a pagar? <small>(opcional: si la pones, aparece en Semanas)</small><input name="fecha" type="date" value="${v.fecha || ''}"></label>
        <label>¿Salió dinero de tus cuentas?
          <select name="cuentaSalida">
            <option value="">No, solo registrarlo</option>
            ${st.cuentas.map((c) => `<option value="${esc(c.id)}" ${c.id === v.cuentaSalida ? 'selected' : ''}>Sí, de ${esc(c.nombre)}</option>`).join('')}
          </select>
        </label>
        <div class="lbl-f">Estado</div>
        ${seg('estado', [['pendiente', 'Pendiente'], ['pagado', 'Pagado']], v.estado)}
        ${selCuenta('cuentaPago', '¿A qué cuenta te pagó?', v.cuentaPago, 'estado=pagado')}
        ${botonesForm(ed)}
      </form>`, (w) => {
      montarForm(w, (d) => {
        const monto = num(d.monto);
        if (!d.persona.trim()) return 'Escribe el nombre';
        if (!(monto > 0)) return 'Escribe un monto válido';
        const pagado = d.estado === 'pagado';
        const nuevo = {
          id: ed ? x.id : uid(), persona: d.persona.trim(), concepto: d.concepto.trim(), monto: C.r2(monto),
          fechaPrestamo: d.fechaPrestamo || null, fecha: d.fecha || null, estado: d.estado,
          cuentaPago: pagado ? d.cuentaPago || (ed ? x.cuentaPago : null) || null : null,
          cuentaSalida: d.cuentaSalida || null,
        };
        const antes = ed ? efMeDeben(x) : [];
        if (ed) Object.assign(x, nuevo); else st.meDeben.push(nuevo);
        aplicar([...negar(antes), ...efMeDeben(nuevo)], ed ? 'Préstamo actualizado' : 'Préstamo agregado');
      }, () => borrar('meDeben', x, x.estado === 'pagado' || !!x.cuentaSalida));
      $(persona || ed ? 'input[name=monto]' : 'input[name=persona]', w).focus();
    });
  }

  const efDebo = (x) => (x.modo === 'unico' && x.estado === 'pagado' ? [[x.cuentaPago, -x.monto]] : []);

  function formDebo(x) {
    const ed = !!x;
    const v = x || { aQuien: '', concepto: '', monto: '', modo: 'unico', fecha: '', dia: '', estado: 'pendiente', cuentaPago: null, deuda: '', limite: '' };
    abrir(`
      <h2>${ed ? 'Editar deuda' : 'Nueva deuda'}</h2>
      <form class="form">
        <label>¿A quién?<input name="aQuien" value="${esc(v.aQuien)}" placeholder="Ej. Mercado Pago, C&amp;A" autocomplete="off" required></label>
        <label>Concepto <small>(opcional)</small><input name="concepto" value="${esc(v.concepto)}" autocomplete="off"></label>
        ${seg('modo', [['unico', 'Pago único'], ['mensual', 'Mensual'], ['tarjeta', 'Tarjeta']], v.modo)}
        <label data-show="modo=unico|mensual">Monto<input name="monto" inputmode="decimal" value="${v.monto}" placeholder="0" required></label>
        <label data-show="modo=tarjeta">¿Cuánto debes en total?<input name="deuda" inputmode="decimal" value="${v.deuda ?? ''}" placeholder="Ej. 868.14" required></label>
        <label data-show="modo=tarjeta">Pago del mes<input name="monto" inputmode="decimal" value="${v.monto}" placeholder="Ej. 289.38" required></label>
        <label data-show="modo=tarjeta">Límite de crédito <small>(opcional)</small><input name="limite" inputmode="decimal" value="${v.limite || ''}" placeholder="Ej. 1500"></label>
        <label data-show="modo=unico">Fecha límite <small>(opcional)</small><input name="fecha" type="date" value="${v.fecha || ''}"></label>
        <label data-show="modo=mensual|tarjeta">Día límite de pago<input name="dia" type="number" min="1" max="31" inputmode="numeric" value="${v.dia || ''}" placeholder="Ej. 13"></label>
        <div class="form-grupo" data-show="modo=unico|mensual">
          <div class="lbl-f">Estado</div>
          ${seg('estado', [['pendiente', 'Pendiente'], ['pagado', 'Pagado']], v.estado)}
        </div>
        ${selCuenta('cuentaPago', '¿De qué cuenta salió?', v.cuentaPago, 'modo=unico&estado=pagado')}
        <p class="hint" data-show="modo=mensual">Cada mes se genera el pago en Semanas. Márcalo como <b>Pagado</b> solo cuando termines de pagar la deuda completa.</p>
        <p class="hint" data-show="modo=tarjeta">Cada mes se genera el pago en Semanas hasta terminar de pagar. Al pagarlo, baja lo que debes. Si haces compras o cambia tu pago del mes, actualízalo aquí.</p>
        ${botonesForm(ed)}
      </form>`, (w) => {
      montarForm(w, (d) => {
        const monto = num(d.monto);
        const tarjeta = d.modo === 'tarjeta';
        if (!d.aQuien.trim()) return 'Escribe a quién le debes';
        if (tarjeta && !(num(d.deuda) >= 0)) return 'Escribe cuánto debes en total';
        if (!(monto > 0)) return tarjeta ? 'Escribe el pago del mes' : 'Escribe un monto válido';
        const dia = parseInt(d.dia, 10);
        if (d.modo !== 'unico' && !(dia >= 1 && dia <= 31)) return 'Día de pago entre 1 y 31';
        const limite = num(d.limite);
        if (tarjeta && String(d.limite || '').trim() && !(limite > 0)) return 'Límite de crédito inválido';
        const nuevo = {
          id: ed ? x.id : uid(), aQuien: d.aQuien.trim(), concepto: d.concepto.trim(), monto: C.r2(monto),
          modo: d.modo, fecha: d.modo === 'unico' ? d.fecha || null : null, dia: d.modo === 'unico' ? null : dia,
          inicio: (ed && x.inicio) || C.hoyISO(), estado: tarjeta ? 'pendiente' : d.estado,
          cuentaPago: d.modo === 'unico' && d.estado === 'pagado' ? d.cuentaPago || (ed ? x.cuentaPago : null) || null : null,
          deuda: tarjeta ? C.r2(num(d.deuda)) : undefined,
          limite: tarjeta && limite > 0 ? C.r2(limite) : undefined,
          pagos: tarjeta ? (ed && x.pagos) || {} : undefined,
        };
        const antes = ed ? efDebo(x) : [];
        if (ed) Object.assign(x, nuevo); else st.debo.push(nuevo);
        aplicar([...negar(antes), ...efDebo(nuevo)], ed ? 'Deuda actualizada' : 'Deuda agregada');
      }, () => borrar('debo', x, (x.modo === 'unico' && x.estado === 'pagado') || Object.keys(x.pagos || {}).length > 0));
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
        aplicar([], ed ? 'Recurrente actualizado' : 'Recurrente agregado');
      }, () => borrar('recs', r, false));
    });
  }

  const ORIGEN = { mov: 'Movimiento único', meDeben: 'De “Me deben”', debo: 'De “Debo” (pago único)', deboMes: 'De “Debo” (mensual)', tarjeta: 'De “Debo” (tarjeta)', rec: 'Movimiento recurrente' };

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
          if (o.src === 'debo' || o.src === 'deboMes' || o.src === 'tarjeta') return formDebo(find(st.debo, o.id));
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
        aplicar([], 'Fecha movida');
      });
      const r = $('[data-reset]', w);
      if (r) r.addEventListener('click', () => { delete st.mover[o.key]; aplicar([], 'Regresado a fin de mes'); });
    });
  }

  // ---------- eventos globales ----------
  $('#vista').addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const id = el.dataset.id;
    switch (el.dataset.act) {
      case 'reintentar': return location.reload();
      case 'nueva-cuenta': return formCuenta();
      case 'editar-cuenta': return formCuenta(find(st.cuentas, id));
      case 'nuevo-prestamo': return formMeDeben(null, el.dataset.persona);
      case 'ir': tab = el.dataset.tab; render(); return window.scrollTo(0, 0);
      case 'instalar': return instalar();
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
      case 'pago-tarjeta': {
        const x = find(st.debo, id);
        const p = x && C.pendientesTarjeta(x)[0];
        return p && formPagoTarjeta(x, p);
      }
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

  // Al volver a la app (desde otra app, otra pestaña o la pantalla de inicio del celular).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && enApp && clave) {
      if (!hojaAbierta()) render(); // por si cambió el día
      sincronizar();
      revisarVersion();
    }
  });
  window.addEventListener('pageshow', (e) => { if (e.persisted && enApp && clave) { sincronizar(); revisarVersion(); } });
  window.addEventListener('focus', () => { if (enApp && clave) sincronizar(); });
  window.addEventListener('online', () => { if (enApp && clave) { sincronizar(); revisarVersion(); } });
  // Respaldo por si el tiempo real se cae: revisa cada 30 s mientras la app está a la vista.
  setInterval(() => {
    if (document.visibilityState === 'visible' && enApp && clave) {
      sincronizar();
      revisarVersion();
    }
  }, 30000);

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

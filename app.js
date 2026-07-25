/* RutaFútbol PY – lógica de la aplicación (Vanilla JS, sin proceso de build). */
(function () {
  'use strict';

  var app = document.getElementById('app');
  var dialog = document.getElementById('detailDialog');
  var dialogContent = document.getElementById('dialogContent');
  var installButton = document.getElementById('installButton');
  var iosHint = document.getElementById('iosHint');
  var offlineBanner = document.getElementById('offlineBanner');

  // Leaflet se carga bajo demanda (solo en la vista Mapa) para que un CDN lento
  // o sin conexión nunca bloquee el arranque de la aplicación.
  var LEAFLET_JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
  var LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
  var LEAFLET_JS_SRI = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';
  var LEAFLET_CSS_SRI = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';

  // Claves existentes del Pasaporte: no cambiar, mantienen compatibilidad
  // con los datos ya guardados por los usuarios.
  var STORAGE_MATCHES = 'ruta-saved-matches';
  var STORAGE_STADIUMS = 'ruta-visited-stadiums';

  function showFatal(message) {
    if (!app) return;
    app.innerHTML =
      '<div class="card empty"><strong>No se pudo iniciar la aplicación.</strong>' +
      '<p>' + message + '</p>' +
      '<p><a href="./">Reintentar</a></p></div>';
  }

  // Si un error de JavaScript dejara la pantalla vacía (solo cabecera y
  // navegación), mostramos un aviso en lugar de una página en blanco.
  window.addEventListener('error', function () {
    if (app && !app.firstChild) {
      showFatal('Ocurrió un error inesperado de JavaScript. Recargá la página.');
    }
  });

  if (!window.RUTA_DATA || !Array.isArray(window.RUTA_DATA.matches) || !Array.isArray(window.RUTA_DATA.stadiums)) {
    showFatal('No se pudieron cargar los datos (data.js). Verificá que todos los archivos del proyecto estén publicados juntos.');
    return;
  }

  var DATA = window.RUTA_DATA;
  var mapInstance = null;
  var deferredPrompt = null;
  var userPosition = null;
  var navToken = 0;
  var leafletPromise = null;
  var nativeDialog = !!dialog && typeof dialog.showModal === 'function';

  // La página 404 marca una bandera para evitar bucles de redirección;
  // al arrancar correctamente la limpiamos.
  try { sessionStorage.removeItem('ruta-404-redirect'); } catch (e) { /* sin sessionStorage */ }

  /* ---------- Utilidades ---------- */

  function fmtDate(value) {
    var p = value.split('-');
    return new Intl.DateTimeFormat('es-PY', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' })
      .format(new Date(Date.UTC(+p[0], +p[1] - 1, +p[2], 12)));
  }

  function fmtLongDate(value) {
    var p = value.split('-');
    return new Intl.DateTimeFormat('es-PY', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' })
      .format(new Date(Date.UTC(+p[0], +p[1] - 1, +p[2], 12)));
  }

  function keyOf(m) {
    return m.date + 'T' + m.time;
  }

  function initials(name) {
    var parts = name.split(/\s+/).filter(Boolean).filter(function (x) {
      return ['Club', 'Sportivo', 'Estadio'].indexOf(x) === -1;
    });
    var out = parts.slice(0, 2).map(function (x) { return x[0]; }).join('').toUpperCase();
    return out || name.slice(0, 2).toUpperCase();
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>'"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[c];
    });
  }

  function haversine(a, b) {
    var R = 6371;
    var toRad = function (x) { return x * Math.PI / 180; };
    var dLat = toRad(b.lat - a.lat);
    var dLng = toRad(b.lng - a.lng);
    var q = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(q));
  }

  function getSaved(key) {
    try {
      var raw = localStorage.getItem(key);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function toggleSaved(key, id) {
    var list = getSaved(key);
    var idx = list.indexOf(id);
    if (idx === -1) list.push(id); else list.splice(idx, 1);
    try { localStorage.setItem(key, JSON.stringify(list)); } catch (e) { /* almacenamiento lleno o bloqueado */ }
    return idx === -1;
  }

  /* ---------- Diálogo de detalles (con reserva para Safari < 15.4) ---------- */

  function openDialog() {
    if (nativeDialog) {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.classList.add('as-fallback');
      dialog.setAttribute('open', '');
      document.body.classList.add('dialog-open');
    }
  }

  function closeDialogBox() {
    if (nativeDialog) {
      if (dialog.open) dialog.close();
    } else {
      dialog.classList.remove('as-fallback');
      dialog.removeAttribute('open');
      document.body.classList.remove('dialog-open');
    }
  }

  /* ---------- Tarjetas ---------- */

  function matchCard(m) {
    var distance = userPosition ? haversine(userPosition, m).toFixed(1) + ' km' : m.city;
    return '<article class="card match-card" data-match="' + escapeHtml(m.id) + '">' +
      '<div class="match-meta"><span>' + fmtDate(m.date) + ' · ' + m.time + ' hs</span>' +
      '<span><b class="round-pill">Fecha ' + m.round + '</b> <b class="status-pill">' + escapeHtml(m.status) + '</b></span></div>' +
      '<div class="teams">' +
      '<div class="team"><div class="team-badge">' + initials(m.home) + '</div><span>' + escapeHtml(m.home) + '</span></div>' +
      '<div class="versus">VS</div>' +
      '<div class="team"><div class="team-badge">' + initials(m.away) + '</div><span>' + escapeHtml(m.away) + '</span></div>' +
      '</div>' +
      '<div class="venue"><span>⌖</span><div><strong>' + escapeHtml(m.stadium) + '</strong><br>' +
      escapeHtml(distance) + ' · ' + escapeHtml(m.department) + '</div></div>' +
      '</article>';
  }

  function stadiumCard(s) {
    var regular = (s.regularClubs && s.regularClubs.length) ? s.regularClubs.join(', ') : 'Sede neutral / temporal';
    var temporary = (s.temporaryClubs && s.temporaryClubs.length)
      ? '<div class="small"><strong>Uso temporal:</strong> ' + escapeHtml(s.temporaryClubs.join(', ')) + '</div>'
      : '';
    return '<article class="card stadium-card">' +
      '<div><span class="status-pill source-pill">Coordenadas verificadas</span></div>' +
      '<h3>' + escapeHtml(s.name) + '</h3>' +
      (s.alias ? '<div class="muted small">' + escapeHtml(s.alias) + '</div>' : '') +
      '<div class="muted small">' + escapeHtml(s.city) + ' · ' + escapeHtml(s.department) + '</div>' +
      '<div class="small"><strong>Club habitual:</strong> ' + escapeHtml(regular) + '</div>' +
      temporary +
      '<div class="stadium-actions">' +
      '<button class="ghost-button" data-open-stadium="' + escapeHtml(s.id) + '">Ver ficha</button>' +
      '<a class="ghost-button" href="' + escapeHtml(s.maps) + '" target="_blank" rel="noopener">Cómo llegar</a>' +
      '</div></article>';
  }

  function upcomingMatches() {
    return DATA.matches.slice().sort(function (a, b) {
      return keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0;
    });
  }

  /* ---------- Vistas ---------- */

  function renderHome() {
    var next = upcomingMatches().slice(0, 3);
    app.innerHTML =
      '<section class="hero"><h1>Encontrá tu próximo partido en Paraguay.</h1>' +
      '<p>Las primeras tres fechas del Clausura 2026, estadios verificados y rutas directas.</p>' +
      '<div class="hero-actions"><a class="primary" href="#/partidos">Ver ' + DATA.matches.length + ' partidos</a>' +
      '<button class="secondary" id="locateHome">Usar mi ubicación</button></div></section>' +
      '<div class="stat-row">' +
      '<div class="stat"><strong>' + DATA.matches.length + '</strong><span>partidos</span></div>' +
      '<div class="stat"><strong>' + DATA.stadiums.length + '</strong><span>estadios</span></div>' +
      '<div class="stat"><strong>' + DATA.clubs.length + '</strong><span>clubes</span></div>' +
      '</div>' +
      '<div class="section-head"><h2>Próximos partidos</h2><a href="#/partidos">Ver todos</a></div>' +
      '<section class="grid match-grid">' + next.map(matchCard).join('') + '</section>' +
      '<div class="section-head"><h2>Estadios de las fechas 1–3</h2><a href="#/estadios">Explorar</a></div>' +
      '<section class="grid stadium-grid">' + DATA.stadiums.slice(0, 4).map(stadiumCard).join('') + '</section>';
    var locate = document.getElementById('locateHome');
    if (locate) {
      locate.addEventListener('click', function () {
        requestLocation().then(function () { renderHome(); });
      });
    }
    bindCards();
  }

  function groupMatches(list) {
    var rounds = [];
    list.forEach(function (m) { if (rounds.indexOf(m.round) === -1) rounds.push(m.round); });
    rounds.sort();
    return rounds.map(function (round) {
      var roundMatches = list.filter(function (m) { return m.round === round; });
      var dates = [];
      roundMatches.forEach(function (m) { if (dates.indexOf(m.date) === -1) dates.push(m.date); });
      dates.sort();
      return '<section class="round-section">' +
        '<div class="round-heading"><h3>Fecha ' + round + '</h3><span>' + roundMatches.length + ' partidos</span></div>' +
        dates.map(function (date) {
          return '<div class="date-group"><h4>' + fmtLongDate(date) + '</h4><div class="grid match-grid">' +
            roundMatches.filter(function (m) { return m.date === date; }).map(matchCard).join('') +
            '</div></div>';
        }).join('') +
        '</section>';
    }).join('');
  }

  function renderMatches() {
    app.innerHTML =
      '<div class="section-head"><div><h2>Partidos</h2>' +
      '<div class="muted small">Torneo Clausura 2026 · Fechas 1 a 3</div></div>' +
      '<a class="status-pill source-pill" href="' + escapeHtml(DATA.meta.sourceUrl) + '" target="_blank" rel="noopener">Fuente APF</a></div>' +
      '<div class="filters match-filters">' +
      '<input id="matchSearch" class="search" placeholder="Buscar club, ciudad o estadio"/>' +
      '<div class="round-filter" id="roundFilter">' +
      '<button class="active" data-round="all">Todas</button>' +
      '<button data-round="1">Fecha 1</button>' +
      '<button data-round="2">Fecha 2</button>' +
      '<button data-round="3">Fecha 3</button>' +
      '</div>' +
      '<button id="sortDistance" class="ghost-button">Cerca</button></div>' +
      '<div id="matchList"></div>';

    var input = document.getElementById('matchSearch');
    var sortButton = document.getElementById('sortDistance');
    var round = 'all';
    var byDistance = false;

    var draw = function () {
      var term = input.value.trim().toLowerCase();
      var list = upcomingMatches().filter(function (m) {
        return [m.home, m.away, m.city, m.stadium].join(' ').toLowerCase().indexOf(term) !== -1;
      }).filter(function (m) {
        return round === 'all' || String(m.round) === round;
      });
      if (byDistance && userPosition) {
        list.sort(function (a, b) { return haversine(userPosition, a) - haversine(userPosition, b); });
      }
      sortButton.classList.toggle('active-filter', byDistance);
      document.getElementById('matchList').innerHTML = list.length
        ? (byDistance
          ? '<section class="grid match-grid">' + list.map(matchCard).join('') + '</section>'
          : groupMatches(list))
        : '<div class="card empty">No se encontraron partidos.</div>';
      bindCards();
    };

    input.addEventListener('input', draw);
    var roundButtons = document.querySelectorAll('#roundFilter [data-round]');
    roundButtons.forEach(function (b) {
      b.addEventListener('click', function () {
        roundButtons.forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        round = b.getAttribute('data-round');
        byDistance = false;
        draw();
      });
    });
    sortButton.addEventListener('click', function () {
      if (byDistance) {
        byDistance = false;
        draw();
        return;
      }
      requestLocation().then(function () {
        byDistance = !!userPosition;
        draw();
      });
    });
    draw();
  }

  function renderStadiums() {
    app.innerHTML =
      '<div class="section-head"><div><h2>Estadios</h2>' +
      '<div class="muted small">' + DATA.stadiums.length + ' sedes usadas en las fechas 1–3</div></div>' +
      '<span class="status-pill source-pill">Google Maps</span></div>' +
      '<div class="filters">' +
      '<input id="stadiumSearch" class="search" placeholder="Buscar estadio, club o ciudad"/>' +
      '<button id="nearStadiums" class="ghost-button">Cerca de mí</button></div>' +
      '<section id="stadiumList" class="grid stadium-grid"></section>';

    var input = document.getElementById('stadiumSearch');
    var nearButton = document.getElementById('nearStadiums');
    var nearest = false;

    var draw = function () {
      var term = input.value.trim().toLowerCase();
      var list = DATA.stadiums.filter(function (s) {
        var haystack = [s.name, s.alias, s.city, s.department]
          .concat(s.regularClubs || [])
          .concat(s.temporaryClubs || [])
          .join(' ')
          .toLowerCase();
        return haystack.indexOf(term) !== -1;
      });
      if (nearest && userPosition) {
        list = list.slice().sort(function (a, b) { return haversine(userPosition, a) - haversine(userPosition, b); });
      }
      nearButton.classList.toggle('active-filter', nearest);
      document.getElementById('stadiumList').innerHTML =
        list.map(stadiumCard).join('') || '<div class="card empty">No se encontraron estadios.</div>';
      bindCards();
    };

    input.addEventListener('input', draw);
    nearButton.addEventListener('click', function () {
      if (nearest) {
        nearest = false;
        draw();
        return;
      }
      requestLocation().then(function () {
        nearest = !!userPosition;
        draw();
      });
    });
    draw();
  }

  function loadLeaflet() {
    if (window.L) return Promise.resolve(true);
    if (leafletPromise) return leafletPromise;
    leafletPromise = new Promise(function (resolve) {
      if (!document.querySelector('link[data-leaflet]')) {
        var css = document.createElement('link');
        css.rel = 'stylesheet';
        css.href = LEAFLET_CSS;
        css.integrity = LEAFLET_CSS_SRI;
        css.crossOrigin = 'anonymous';
        css.setAttribute('data-leaflet', '');
        document.head.appendChild(css);
      }
      var script = document.createElement('script');
      script.src = LEAFLET_JS;
      script.integrity = LEAFLET_JS_SRI;
      script.crossOrigin = 'anonymous';
      script.onload = function () { resolve(!!window.L); };
      script.onerror = function () {
        leafletPromise = null; // permite reintentar en la próxima visita al mapa
        resolve(false);
      };
      document.head.appendChild(script);
    });
    return leafletPromise;
  }

  function renderMap() {
    var token = navToken;
    app.innerHTML =
      '<div class="section-head"><div><h2>Mapa futbolero</h2>' +
      '<div class="muted small">' + DATA.stadiums.length + ' estadios · ' + DATA.matches.length + ' partidos</div></div>' +
      '<button id="locateMap" class="ghost-button">Mi ubicación</button></div>' +
      '<div id="map" class="map-wrap"><div class="map-fallback">Cargando mapa…</div></div>';

    document.getElementById('locateMap').addEventListener('click', function () {
      requestLocation().then(function () {
        if (!userPosition || !mapInstance || !window.L) return;
        window.L.circleMarker([userPosition.lat, userPosition.lng], {
          radius: 8, color: '#fff', fillColor: '#D52B1E', fillOpacity: 1, weight: 3
        }).addTo(mapInstance).bindPopup('Tu ubicación aproximada').openPopup();
        mapInstance.setView([userPosition.lat, userPosition.lng], 12);
      });
    });

    loadLeaflet().then(function (ok) {
      if (token !== navToken) return; // el usuario ya cambió de vista
      var mapEl = document.getElementById('map');
      if (!mapEl) return;
      if (!ok || !window.L) {
        mapEl.innerHTML =
          '<div class="map-fallback"><strong>Mapa no disponible sin conexión.</strong>' +
          '<p>Los enlaces de Google Maps siguen disponibles en las fichas de cada estadio.</p></div>';
        return;
      }
      var L = window.L;
      mapInstance = L.map('map', { zoomControl: true }).setView([-25.30, -57.58], 8);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19
      }).addTo(mapInstance);
      var bounds = [];
      DATA.stadiums.forEach(function (s) {
        bounds.push([s.lat, s.lng]);
        var games = DATA.matches.filter(function (m) { return m.stadiumId === s.id; }).map(function (m) {
          return '<li>F' + m.round + ': ' + escapeHtml(m.home) + ' vs ' + escapeHtml(m.away) +
            ' · ' + fmtDate(m.date) + ' ' + m.time + '</li>';
        }).join('');
        L.circleMarker([s.lat, s.lng], {
          radius: 8, color: '#0B5F3C', fillColor: '#F4C542', fillOpacity: .95, weight: 2
        }).addTo(mapInstance).bindPopup(
          '<div class="map-popup"><strong>' + escapeHtml(s.name) + '</strong>' +
          '<span>' + escapeHtml(s.city) + '</span><ul>' + games + '</ul>' +
          '<a href="' + escapeHtml(s.maps) + '" target="_blank" rel="noopener">Abrir en Google Maps</a></div>'
        );
      });
      mapInstance.fitBounds(bounds, { padding: [30, 30] });
    });
  }

  function renderPassport() {
    var savedIds = getSaved(STORAGE_MATCHES);
    var visitedIds = getSaved(STORAGE_STADIUMS);
    var saved = DATA.matches.filter(function (m) { return savedIds.indexOf(m.id) !== -1; });
    var stad = DATA.stadiums.filter(function (s) { return visitedIds.indexOf(s.id) !== -1; });
    app.innerHTML =
      '<section class="passport">' +
      '<div class="passport-card"><div class="small">PASAPORTE FUTBOLERO</div>' +
      '<h2>Tu ruta, en un solo lugar</h2>' +
      '<p>Guardá partidos y marcá estadios visitados. Todo queda en este dispositivo.</p>' +
      '<div class="passport-stats">' +
      '<span><strong>' + saved.length + '</strong> partidos guardados</span>' +
      '<span><strong>' + stad.length + '</strong> estadios visitados</span>' +
      '</div></div>' +
      '<div class="section-head"><h2>Partidos guardados</h2><a href="#/partidos">Agregar</a></div>' +
      '<section class="grid match-grid">' +
      (saved.length ? saved.map(matchCard).join('') : '<div class="card empty">Todavía no guardaste partidos.</div>') +
      '</section>' +
      '<div class="section-head"><h2>Estadios visitados</h2><a href="#/estadios">Explorar</a></div>' +
      '<section class="grid stadium-grid">' +
      (stad.length ? stad.map(stadiumCard).join('') : '<div class="card empty">Todavía no marcaste estadios visitados.</div>') +
      '</section></section>';
    bindCards();
  }

  /* ---------- Fichas de detalle ---------- */

  function showMatch(id) {
    var m = null;
    DATA.matches.forEach(function (x) { if (x.id === id) m = x; });
    if (!m) return;
    var saved = getSaved(STORAGE_MATCHES).indexOf(m.id) !== -1;
    dialogContent.innerHTML =
      '<div class="dialog-body">' +
      '<div class="dialog-badges"><span class="round-pill">Fecha ' + m.round + '</span>' +
      '<span class="status-pill">' + escapeHtml(m.status) + '</span></div>' +
      '<h2>' + escapeHtml(m.home) + ' vs ' + escapeHtml(m.away) + '</h2>' +
      '<p><strong>' + fmtLongDate(m.date) + ' · ' + m.time + ' hs</strong><br>' +
      escapeHtml(m.stadium) + ', ' + escapeHtml(m.city) + '</p>' +
      '<div class="teams">' +
      '<div class="team"><div class="team-badge">' + initials(m.home) + '</div><span>' + escapeHtml(m.home) + '</span></div>' +
      '<div class="versus">VS</div>' +
      '<div class="team"><div class="team-badge">' + initials(m.away) + '</div><span>' + escapeHtml(m.away) + '</span></div>' +
      '</div>' +
      '<div class="detail-source">' +
      '<a href="' + escapeHtml(m.maps) + '" target="_blank" rel="noopener">Cómo llegar</a>' +
      '<a href="' + escapeHtml(m.apfProgram) + '" target="_blank" rel="noopener">Fuente oficial APF</a>' +
      '<button id="saveMatch" class="ghost-button">' + (saved ? 'Quitar de guardados' : 'Guardar partido') + '</button>' +
      '</div>' +
      '<p class="muted small">Revisado: ' + escapeHtml(m.checkedAt) + ' · Calidad ' + escapeHtml(m.quality) + '</p>' +
      '</div>';
    openDialog();
    document.getElementById('saveMatch').addEventListener('click', function () {
      toggleSaved(STORAGE_MATCHES, m.id);
      showMatch(m.id);
    });
  }

  function showStadium(id) {
    var s = null;
    DATA.stadiums.forEach(function (x) { if (x.id === id) s = x; });
    if (!s) return;
    var visited = getSaved(STORAGE_STADIUMS).indexOf(s.id) !== -1;
    dialogContent.innerHTML =
      '<div class="dialog-body">' +
      '<span class="status-pill source-pill">Ubicación verificada</span>' +
      '<h2>' + escapeHtml(s.name) + '</h2>' +
      (s.alias ? '<p class="muted">' + escapeHtml(s.alias) + '</p>' : '') +
      '<p><strong>' + escapeHtml(s.city) + ', ' + escapeHtml(s.department) + '</strong></p>' +
      '<p><strong>Club habitual:</strong> ' + escapeHtml((s.regularClubs && s.regularClubs.length) ? s.regularClubs.join(', ') : 'Sede neutral / temporal') + '</p>' +
      ((s.temporaryClubs && s.temporaryClubs.length) ? '<p><strong>Uso temporal:</strong> ' + escapeHtml(s.temporaryClubs.join(', ')) + '</p>' : '') +
      '<div class="detail-source">' +
      '<a href="' + escapeHtml(s.maps) + '" target="_blank" rel="noopener">Abrir en Google Maps</a>' +
      '<button id="visitStadium" class="ghost-button">' + (visited ? 'Quitar visita' : 'Marcar visitado') + '</button>' +
      '</div>' +
      '<p class="muted small">Coordenadas: ' + s.lat + ', ' + s.lng + '</p>' +
      '</div>';
    openDialog();
    document.getElementById('visitStadium').addEventListener('click', function () {
      toggleSaved(STORAGE_STADIUMS, s.id);
      showStadium(s.id);
    });
  }

  function bindCards() {
    document.querySelectorAll('[data-match]').forEach(function (el) {
      el.addEventListener('click', function () { showMatch(el.getAttribute('data-match')); });
    });
    document.querySelectorAll('[data-open-stadium]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        showStadium(el.getAttribute('data-open-stadium'));
      });
    });
  }

  /* ---------- Geolocalización ---------- */

  function requestLocation() {
    return new Promise(function (resolve) {
      if (!navigator.geolocation) { resolve(false); return; }
      navigator.geolocation.getCurrentPosition(
        function (p) {
          userPosition = { lat: p.coords.latitude, lng: p.coords.longitude };
          resolve(true);
        },
        function () { resolve(false); },
        { enableHighAccuracy: false, timeout: 9000, maximumAge: 300000 }
      );
    });
  }

  /* ---------- Enrutador ---------- */

  function route() {
    navToken += 1;
    var name = (location.hash.split('/')[1] || 'inicio').split('?')[0];
    document.querySelectorAll('.bottom-nav a').forEach(function (a) {
      a.classList.toggle('active', a.getAttribute('data-route') === name);
    });
    if (mapInstance) {
      mapInstance.remove();
      mapInstance = null;
    }
    closeDialogBox();
    var views = {
      inicio: renderHome,
      partidos: renderMatches,
      mapa: renderMap,
      estadios: renderStadiums,
      pasaporte: renderPassport
    };
    (views[name] || renderHome)();
    app.focus({ preventScroll: true });
  }

  window.addEventListener('hashchange', route);

  document.getElementById('closeDialog').addEventListener('click', closeDialogBox);
  dialog.addEventListener('click', function (e) {
    if (e.target === dialog) closeDialogBox();
  });
  document.getElementById('menuButton').addEventListener('click', function () {
    location.hash = '#/inicio';
  });

  /* ---------- Instalación (PWA) ---------- */

  var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var isStandalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
    window.navigator.standalone === true;

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    installButton.hidden = false;
  });

  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    installButton.hidden = true;
    iosHint.hidden = true;
  });

  // iOS no dispara beforeinstallprompt: mostramos el botón con la guía manual.
  if (isIOS && !isStandalone) installButton.hidden = false;

  installButton.addEventListener('click', function () {
    if (deferredPrompt) {
      var promptEvent = deferredPrompt;
      deferredPrompt = null;
      promptEvent.prompt();
      promptEvent.userChoice.then(function () { installButton.hidden = true; });
    } else {
      iosHint.hidden = !iosHint.hidden;
    }
  });

  /* ---------- Estado de conexión ---------- */

  function updateOnline() {
    offlineBanner.hidden = navigator.onLine !== false;
  }
  window.addEventListener('online', updateOnline);
  window.addEventListener('offline', updateOnline);
  updateOnline();

  /* ---------- Service Worker ---------- */

  if ('serviceWorker' in navigator &&
    (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js').catch(function () { /* sin SW no se bloquea la app */ });
    });
  }

  /* ---------- Arranque ---------- */

  if (!location.hash) {
    location.hash = '#/inicio'; // dispara hashchange → route()
  } else {
    route();
  }
})();

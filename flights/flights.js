/* Faris Travel – flight search (Duffel via flights/api.php) */
(function () {
  var API = 'flights/api.php';
  var PAGE = 10;

  var form = document.getElementById('ftForm');
  if (!form) return;
  var box = document.getElementById('ftResults');
  var go = document.getElementById('ftGo');
  var departEl = document.getElementById('ftDepart');
  var returnEl = document.getElementById('ftReturn');

  var trip = 'round';
  var pax = { adults: 1, children: 0, infants: 0 };
  var state = { offers: [], sort: 'price', direct: false, shown: PAGE, travelers: 1, live: false };

  // ---------- helpers ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function iso(d) { return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); }
  function addDays(n) { var d = new Date(); d.setDate(d.getDate() + n); return iso(d); }
  function hhmm(s) { return s.slice(11, 16); }
  function dayLabel(s) {
    return new Date(s.slice(0, 10) + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }
  function dur(m) { return Math.floor(m / 60) + 'h ' + ('0' + (m % 60)).slice(-2) + 'm'; }
  function money(a, c) {
    try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: c }).format(a); }
    catch (e) { return c + ' ' + a; }
  }
  function dayShift(a, b) { return Math.round((new Date(b.slice(0, 10)) - new Date(a.slice(0, 10))) / 864e5); }

  // ---------- dates ----------
  departEl.min = addDays(1);
  departEl.value = addDays(21);
  returnEl.min = departEl.value;
  returnEl.value = addDays(35);
  departEl.addEventListener('change', function () {
    returnEl.min = departEl.value;
    if (returnEl.value && returnEl.value < departEl.value) returnEl.value = departEl.value;
  });

  // ---------- trip type ----------
  form.querySelectorAll('[data-trip]').forEach(function (b) {
    b.addEventListener('click', function () {
      trip = b.dataset.trip;
      form.querySelectorAll('[data-trip]').forEach(function (x) { x.classList.toggle('on', x === b); });
      returnEl.disabled = trip === 'oneway';
    });
  });

  // ---------- airport autocomplete ----------
  function autocomplete(input) {
    var list = null, items = [], active = -1, timer = null, seq = 0;

    function close() { if (list) { list.remove(); list = null; } active = -1; }
    function pick(p) {
      input.value = p.city + ' (' + p.code + ')';
      input.dataset.code = p.code;
      close();
    }
    function draw() {
      close();
      if (!items.length) return;
      list = document.createElement('ul');
      list.className = 'ft-suggest';
      list.setAttribute('role', 'listbox');
      list.innerHTML = items.map(function (p, i) {
        return '<li role="option" data-i="' + i + '"><b>' + esc(p.code) + '</b><span>' + esc(p.name) + '</span><small>' +
          (p.type === 'city' ? 'All airports · ' : '') + esc(p.city) + (p.country ? ', ' + esc(p.country) : '') + '</small></li>';
      }).join('');
      list.addEventListener('mousedown', function (e) {
        var li = e.target.closest('li');
        if (li) { e.preventDefault(); pick(items[+li.dataset.i]); }
      });
      input.parentNode.appendChild(list);
    }
    function highlight() {
      if (!list) return;
      [].forEach.call(list.children, function (li, i) { li.classList.toggle('on', i === active); });
    }

    input.addEventListener('focus', function () { input.select(); });
    input.addEventListener('input', function () {
      input.dataset.code = /^[a-z]{3}$/i.test(input.value.trim()) ? input.value.trim().toUpperCase() : '';
      clearTimeout(timer);
      var q = input.value.trim();
      if (q.length < 2) { items = []; close(); return; }
      timer = setTimeout(function () {
        var mine = ++seq;
        fetch(API + '?action=places&q=' + encodeURIComponent(q))
          .then(function (r) { return r.ok ? r.json() : []; })
          .then(function (d) { if (mine === seq && document.activeElement === input) { items = d; active = -1; draw(); } })
          .catch(function () {});
      }, 220);
    });
    input.addEventListener('keydown', function (e) {
      if (!list) return;
      if (e.key === 'ArrowDown') { active = Math.min(active + 1, items.length - 1); highlight(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { active = Math.max(active - 1, 0); highlight(); e.preventDefault(); }
      else if (e.key === 'Enter') { e.preventDefault(); pick(items[Math.max(active, 0)]); }
      else if (e.key === 'Escape') close();
    });
    input.addEventListener('blur', function () { setTimeout(close, 120); });
  }

  var fromEl = document.getElementById('ftFrom');
  var toEl = document.getElementById('ftTo');
  autocomplete(fromEl);
  autocomplete(toEl);

  document.getElementById('ftSwap').addEventListener('click', function () {
    var v = fromEl.value, c = fromEl.dataset.code;
    fromEl.value = toEl.value; fromEl.dataset.code = toEl.dataset.code;
    toEl.value = v; toEl.dataset.code = c;
  });

  // ---------- travelers ----------
  var paxBtn = document.getElementById('ftPaxBtn');
  var paxBox = document.getElementById('ftPax');

  function paxLabel() {
    var p = [pax.adults + (pax.adults > 1 ? ' Adults' : ' Adult')];
    if (pax.children) p.push(pax.children + (pax.children > 1 ? ' Children' : ' Child'));
    if (pax.infants) p.push(pax.infants + (pax.infants > 1 ? ' Infants' : ' Infant'));
    paxBtn.textContent = p.join(', ');
    var total = pax.adults + pax.children + pax.infants;
    paxBox.querySelectorAll('.ft-step').forEach(function (s) {
      var k = s.dataset.k, n = pax[k];
      s.querySelector('span').textContent = n;
      s.querySelector('[data-d="-1"]').disabled = n <= (k === 'adults' ? 1 : 0) || (k === 'adults' && n <= pax.infants);
      s.querySelector('[data-d="1"]').disabled = total >= 9 || (k === 'infants' && n >= pax.adults);
    });
  }
  function togglePax(open) {
    paxBox.hidden = !open;
    paxBtn.setAttribute('aria-expanded', open);
  }
  paxBtn.addEventListener('click', function () { togglePax(paxBox.hidden); });
  document.getElementById('ftPaxDone').addEventListener('click', function () { togglePax(false); });
  paxBox.addEventListener('click', function (e) {
    var b = e.target.closest('[data-d]');
    if (!b) return;
    pax[b.parentNode.dataset.k] += +b.dataset.d;
    paxLabel();
  });
  document.addEventListener('click', function (e) {
    if (!paxBox.hidden && !paxBox.contains(e.target) && e.target !== paxBtn) togglePax(false);
  });
  paxLabel();

  // ---------- search ----------
  function showError(msg) {
    box.innerHTML = '<p class="ft-error">' + esc(msg) + '</p>';
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var from = fromEl.dataset.code, to = toEl.dataset.code;
    if (!from || !to) return showError('Please choose both airports from the suggestions list.');
    if (from === to) return showError('Departure and arrival airports must be different.');
    if (!departEl.value) return showError('Please choose a departure date.');
    if (trip === 'round' && !returnEl.value) return showError('Please choose a return date.');

    go.disabled = true;
    go.textContent = 'Searching…';
    box.innerHTML = '<div class="ft-loading"><i></i>Checking airlines for the best fares…</div>' +
      '<div class="ft-skel"></div><div class="ft-skel"></div><div class="ft-skel"></div>';

    fetch(API + '?action=search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: from, to: to,
        depart: departEl.value,
        'return': trip === 'round' ? returnEl.value : '',
        adults: pax.adults, children: pax.children, infants: pax.infants,
        cabin: document.getElementById('ftCabin').value
      })
    })
      .then(function (r) {
        return r.json().catch(function () { return { error: 'Unexpected server response (' + r.status + ').' }; });
      })
      .then(function (d) {
        if (d.error) return showError(d.error);
        state.offers = d.offers;
        state.live = d.live;
        state.travelers = d.travelers;
        state.shown = PAGE;
        state.direct = false;
        state.sort = 'price';
        render();
      })
      .catch(function () { showError('Could not connect. Please check your connection and try again.'); })
      .then(function () {
        go.disabled = false;
        go.textContent = 'Search Flights →';
      });
  });

  // ---------- results ----------
  function legHtml(s) {
    var a = s.segments[0], b = s.segments[s.segments.length - 1];
    var stops = s.segments.length - 1;
    var shift = dayShift(a.dep, b.arr);
    var ops = s.segments.map(function (g) { return g.operator; }).filter(function (v, i, arr) { return arr.indexOf(v) === i; });
    var via = s.segments.slice(1).map(function (g) { return g.from; }).join(', ');

    return '<div class="ft-leg">' +
      '<div class="ft-pt"><strong>' + hhmm(a.dep) + '</strong><span>' + esc(s.from) + '</span></div>' +
      '<div class="ft-mid">' + dur(s.minutes) +
        '<div class="ft-line">' + s.segments.slice(1).map(function () { return '<i></i>'; }).join('') + '</div>' +
        (stops ? '<span class="ft-stop">' + stops + ' stop' + (stops > 1 ? 's' : '') + ' · ' + esc(via) + '</span>' : '<span class="ft-direct">Direct</span>') +
      '</div>' +
      '<div class="ft-pt"><strong>' + hhmm(b.arr) + (shift > 0 ? '<sup>+' + shift + '</sup>' : '') + '</strong><span>' + esc(s.to) + '</span></div>' +
      '<div class="ft-op">' + dayLabel(a.dep) + ' · ' + s.segments.map(function (g) { return esc(g.flight); }).join(' / ') +
        ' · Operated by ' + esc(ops.join(', ')) + '</div>' +
    '</div>';
  }

  function offerHtml(o) {
    var tags = (o.refundable ? '<em>Refundable</em>' : '') + (o.changeable ? '<em>Changeable</em>' : '');
    return '<article class="ft-offer">' +
      '<div class="ft-air">' + (o.logo ? '<img src="' + esc(o.logo) + '" alt="" loading="lazy">' : '') +
        '<div>' + esc(o.airline) + (o.cabin ? '<small>' + esc(o.cabin) + '</small>' : '') + '</div></div>' +
      '<div class="ft-slices">' + o.slices.map(legHtml).join('') + '</div>' +
      '<div class="ft-price"><div><strong>' + money(o.price, o.currency) + '</strong>' +
        '<small>Total for ' + state.travelers + ' traveler' + (state.travelers > 1 ? 's' : '') + '</small></div>' +
        (tags ? '<div class="ft-tags">' + tags + '</div>' : '') + '</div>' +
    '</article>';
  }

  function render() {
    var all = state.offers;
    if (!all.length) {
      box.innerHTML = '<p class="ft-empty">No flights found for this search. Try different dates or a nearby airport.</p>';
      return;
    }

    var list = state.direct ? all.filter(function (o) { return o.stops === 0; }) : all.slice();
    list.sort(state.sort === 'price'
      ? function (a, b) { return a.price - b.price; }
      : function (a, b) { return a.minutes - b.minutes || a.price - b.price; });

    var cheapest = all.reduce(function (m, o) { return Math.min(m, +o.price); }, Infinity);
    var fastest = all.reduce(function (m, o) { return Math.min(m, o.minutes); }, Infinity);
    var hasDirect = all.some(function (o) { return o.stops === 0; });
    var s0 = all[0].slices[0];

    box.innerHTML =
      (!state.live ? '<p class="ft-note"><b>Test mode.</b> Results come from Duffel’s sandbox airline (“Duffel Airways”). Real airlines and fares appear once the live account is connected.</p>' : '') +
      '<div class="ft-bar" style="margin-top:18px">' +
        '<p class="ft-count"><b>' + list.length + '</b> flights' +
          '<small>' + esc(s0.fromCity) + ' → ' + esc(s0.toCity) + (all[0].slices.length > 1 ? ' · round trip' : ' · one way') + '</small></p>' +
        '<div class="ft-sort">' +
          '<button type="button" data-sort="price" class="' + (state.sort === 'price' ? 'on' : '') + '">Cheapest<small>' + money(cheapest, all[0].currency) + '</small></button>' +
          '<button type="button" data-sort="time" class="' + (state.sort === 'time' ? 'on' : '') + '">Fastest<small>' + dur(fastest) + '</small></button>' +
        '</div>' +
        (hasDirect ? '<label class="ft-check"><input type="checkbox" id="ftDirect"' + (state.direct ? ' checked' : '') + '> Direct only</label>' : '') +
      '</div>' +
      (list.length ? list.slice(0, state.shown).map(offerHtml).join('') : '<p class="ft-empty">No direct flights. Untick “Direct only” to see all options.</p>') +
      (list.length > state.shown ? '<button type="button" class="btn ft-more" id="ftMore">Show more flights (' + (list.length - state.shown) + ')</button>' : '');
  }

  box.addEventListener('click', function (e) {
    var s = e.target.closest('[data-sort]');
    if (s) { state.sort = s.dataset.sort; state.shown = PAGE; render(); }
    if (e.target.id === 'ftMore') { state.shown += PAGE; render(); }
  });
  box.addEventListener('change', function (e) {
    if (e.target.id === 'ftDirect') { state.direct = e.target.checked; state.shown = PAGE; render(); }
  });
})();

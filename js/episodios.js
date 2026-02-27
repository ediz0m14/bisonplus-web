(function() {
  'use strict';

  var TMDB_KEY = '0606cd80dcd2a4e953505725aa5ea13d';

  /* ── Estado ── */
  var activeServer  = 0;
  var activeLangKey = '';
  var toastTimer    = null;
  var allEpisodes   = [];

  /* Dominio: usa LW_BLOG_URL si esta definido, sino el dominio actual del blog */
  var blogBase = (LW_BLOG_URL || window.location.origin).replace(/\/+$/, '');

  /* LW_SERIE_URL: si es ruta relativa (empieza con "/") le pegamos el dominio automaticamente */
  if (LW_SERIE_URL && LW_SERIE_URL.charAt(0) === '/') {
    LW_SERIE_URL = blogBase + LW_SERIE_URL;
  }

  /* Construye la URL de un episodio incluyendo LW_DATE
     Resultado: https://blog.com/2026/02/dr-stone-1x3.html */
  function buildEpUrl(season, epNum) {
    var date = (LW_DATE || '').replace(/\/+$/, '');
    if (date) return blogBase + '/' + date + '/' + LW_SLUG + '-' + season + 'x' + epNum + '.html';
    return blogBase + '/' + LW_SLUG + '-' + season + 'x' + epNum + '.html';
  }

  /* ════════════════════
     FETCH HELPER
  ════════════════════ */
  function apiFetch(url) {
    return fetch(url).then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  /* ════════════════════
     INIT
  ════════════════════ */
  function init() {
    var malId  = parseInt(LW_MAL_ID)  || 0;
    var tmdbId = parseInt(LW_TMDB_ID) || 0;
    var season = parseInt(LW_SEASON)  || 1;
    var epNum  = parseInt(LW_EPISODE) || 1;

    if (!tmdbId) {
      showError('Define LW_TMDB_ID en la configuración.');
      hideLoading(); return;
    }

    document.getElementById('lwe-loading-msg').textContent = 'Cargando episodio ' + season + 'x' + epNum + '…';

    /* Llamadas paralelas */
    var jikanP = malId
      ? apiFetch('https://api.jikan.moe/v4/anime/' + malId)
          .catch(function() {
            return new Promise(function(res) {
              setTimeout(function(){
                apiFetch('https://api.jikan.moe/v4/anime/' + malId)
                  .then(res).catch(function(){ res(null); });
              }, 1200);
            });
          })
      : Promise.resolve(null);

    var tmdbShowP   = apiFetch('https://api.themoviedb.org/3/tv/' + tmdbId + '?api_key=' + TMDB_KEY + '&language=es-MX');
    var tmdbSeasonP = apiFetch('https://api.themoviedb.org/3/tv/' + tmdbId + '/season/' + season + '?api_key=' + TMDB_KEY + '&language=es-MX');

    Promise.all([jikanP, tmdbShowP, tmdbSeasonP])
      .then(function(res) {
        var jikanRaw = res[0];
        var jikan    = jikanRaw && jikanRaw.data ? jikanRaw.data : jikanRaw;
        var show     = res[1];
        var seasonData = res[2];

        allEpisodes = seasonData.episodes || [];

        /* Episodio actual */
        var ep = allEpisodes.find(function(e){ return e.episode_number === epNum; })
               || allEpisodes[epNum - 1]
               || {};

        var data = buildData(jikan, show, ep, season, epNum);
        renderWidget(data);
        renderMiniEpList(allEpisodes, season, epNum);
        renderNavigation(allEpisodes, season, epNum);
        renderServers();

        hideLoading();
        document.getElementById('lwe-widget').style.display = 'block';

        /* Scroll automático al episodio actual en la mini lista */
        setTimeout(function() {
          var cur = document.querySelector('.lwe-ep-item.current');
          if (cur) cur.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          /* Animar barras de rating */
          document.querySelectorAll('.lwe-rbar-fill[data-pct]').forEach(function(b) {
            b.style.width = Math.min(parseFloat(b.getAttribute('data-pct')), 100) + '%';
          });
        }, 400);
      })
      .catch(function(err) {
        console.error('Error:', err);
        showError('No se pudo conectar con las APIs. Verifica los IDs en la configuración.');
        hideLoading();
      });
  }

  /* ════════════════════
     BUILD DATA
  ════════════════════ */
  function buildData(jikan, show, ep, season, epNum) {
    /* ── Títulos serie ── */
    var titleEs = '', titleRomanized = '', titleOriginal = '';
    if (jikan) {
      titleRomanized = jikan.title          || '';
      titleOriginal  = jikan.title_japanese || '';
      if (jikan.titles) {
        var esT = jikan.titles.find(function(t){
          return t.type === 'Spanish' || (t.title && /[áéíóúñ¿¡]/i.test(t.title));
        });
        if (esT) titleEs = esT.title;
      }
      if (!titleEs) titleEs = jikan.title_english || titleRomanized;
    }
    if (!titleEs && show) titleEs = show.name || show.original_name || 'Sin título';
    if (!titleRomanized && show) titleRomanized = show.original_name || '';
    var serieTitle = titleEs || titleRomanized || 'Sin título';

    /* ── Poster (MAL) ── */
    var poster = '';
    if (jikan && jikan.images) {
      var jpgImgs = jikan.images.jpg || {};
      poster = jpgImgs.large_image_url || jpgImgs.image_url || '';
    }
    if (!poster && show && show.poster_path) {
      poster = 'https://image.tmdb.org/t/p/w500' + show.poster_path;
    }

    /* ── Still / backdrop del episodio ── */
    var still = '';
    if (ep.still_path) still = 'https://image.tmdb.org/t/p/original' + ep.still_path;
    if (!still && show && show.backdrop_path) still = 'https://image.tmdb.org/t/p/original' + show.backdrop_path;

    /* ── Título del episodio ── */
    var epTitle = ep.name || ('Episodio ' + epNum);

    /* ── Sinopsis episodio ── */
    var epOverview = ep.overview || 'Sin sinopsis disponible para este episodio.';

    /* ── Géneros ── */
    var genreMap = {
      'Action':'Acción','Adventure':'Aventura','Comedy':'Comedia','Drama':'Drama',
      'Fantasy':'Fantasía','Horror':'Terror','Mystery':'Misterio','Romance':'Romance',
      'Sci-Fi':'Ciencia ficción','Science Fiction':'Ciencia ficción',
      'Slice of Life':'Vida cotidiana','Sports':'Deportes','Supernatural':'Sobrenatural',
      'Thriller':'Suspenso','Music':'Música','Psychological':'Psicológico',
      'Mecha':'Mecha','Isekai':'Isekai','Historical':'Histórico','Military':'Militar',
      'School':'Escolar','Magic':'Magia','Animation':'Animación',
    };
    var genres = [];
    if (jikan) {
      genres = (jikan.genres||[]).concat(jikan.themes||[]).map(function(g){ return genreMap[g.name]||g.name; });
    } else if (show && show.genres) {
      genres = show.genres.map(function(g){ return genreMap[g.name]||g.name; });
    }

    /* ── Ratings ── */
    var ratings = [];
    if (show && show.vote_average && show.vote_average > 0) {
      ratings.push({
        source:'TMDB', icon:'TMDB',
        score: show.vote_average.toFixed(1)+' / 10',
        votes: show.vote_count ? fmtVotes(show.vote_count) : '',
        pct:   (show.vote_average/10)*100, color:'#01d277'
      });
    }
    if (jikan && jikan.score && jikan.score > 0) {
      ratings.push({
        source:'MyAnimeList', icon:'MAL',
        score: jikan.score.toFixed(2)+' / 10',
        votes: jikan.scored_by ? fmtVotes(jikan.scored_by) : '',
        pct:   (jikan.score/10)*100, color:'#2e51a2'
      });
    }

    /* ── Fecha emisión episodio ── */
    var epDate = 'N/D';
    if (ep.air_date) {
      try {
        epDate = new Date(ep.air_date).toLocaleDateString('es-MX',{day:'numeric',month:'long',year:'numeric'});
      } catch(e) { epDate = ep.air_date; }
    }

    /* ── Runtime ── */
    var runtime = 'N/D';
    if (ep.runtime) runtime = ep.runtime + ' min';
    else if (show && show.episode_run_time && show.episode_run_time.length) runtime = show.episode_run_time[0] + ' min';
    else if (jikan && jikan.duration) runtime = jikan.duration.replace(/ per ep\.?/i,'').trim();

    /* ── Studio ── */
    var studio = '';
    if (jikan) studio = (jikan.studios||[]).map(function(s){return s.name;}).join(', ');
    if (!studio && show && show.networks) studio = show.networks.slice(0,2).map(function(n){return n.name;}).join(', ');
    if (!studio) studio = 'N/D';

    /* ── Estado ── */
    var statusMap = {'Finished Airing':'Finalizado','Currently Airing':'En emisión','Ended':'Finalizado','Returning Series':'En emisión'};
    var status = '';
    if (show && show.status) status = statusMap[show.status] || show.status;
    else if (jikan && jikan.status) status = statusMap[jikan.status] || jikan.status;

    return {
      serieTitle, titleRomanized, titleOriginal,
      poster, still, genres, ratings, studio, status,
      epTitle, epOverview, epDate, runtime,
      season, epNum,
      totalEps: (show && show.number_of_episodes) || allEpisodes.length,
      malId: (jikan && jikan.mal_id) || 0,
      epRating: ep.vote_average || 0,
      epVoteCount: ep.vote_count || 0,
    };
  }

  /* ════════════════════
     RENDER WIDGET
  ════════════════════ */
  function renderWidget(d) {
    /* Hero still */
    if (d.still) document.getElementById('lwe-hero-bg').style.backgroundImage = "url('" + d.still + "')";

    /* Player poster */
    if (d.still || d.poster) {
      document.getElementById('lwe-player-poster').style.backgroundImage = "url('" + (d.still || d.poster) + "')";
    }

    /* Botón volver a la serie */
    var backEl = document.getElementById('lwe-serie-back');
    backEl.href = LW_SERIE_URL || '#';
    document.getElementById('lwe-serie-name').textContent = d.serieTitle;

    /* Título del episodio */
    document.getElementById('lwe-ep-title').textContent = d.epTitle;

    /* Subtítulo: nombre serie + badge SxE */
    var sxe = d.season + 'x' + d.epNum;
    document.getElementById('lwe-ep-subtitle').innerHTML =
      '<span style="color:#8a8a8a;font-size:.85rem;font-weight:500;">' + escHtml(d.serieTitle) + '</span>' +
      '<span style="width:1px;height:12px;background:#2a2a2a;display:inline-block;"></span>' +
      '<span class="lwe-badge-ep">' + sxe + '</span>';

    /* Meta row: rating ep + fecha + runtime */
    var metaParts = [];
    if (d.epRating > 0) {
      metaParts.push('<span style="color:#f5c518;font-weight:700;font-size:.88rem;">★ ' + d.epRating.toFixed(1) +
        (d.epVoteCount ? ' <span style="color:#555;font-weight:400;font-size:.75rem;">(' + fmtVotes(d.epVoteCount) + ')</span>' : '') +
        '</span>');
    }
    if (d.epDate !== 'N/D') {
      metaParts.push('<span style="width:1px;height:14px;background:#2a2a2a;display:inline-block;"></span>');
      metaParts.push('<span style="color:#8a8a8a;font-size:.82rem;">📅 ' + escHtml(d.epDate) + '</span>');
    }
    if (d.runtime !== 'N/D') {
      metaParts.push('<span style="width:1px;height:14px;background:#2a2a2a;display:inline-block;"></span>');
      metaParts.push('<span style="color:#8a8a8a;font-size:.82rem;">⏱ ' + escHtml(d.runtime) + '</span>');
    }
    document.getElementById('lwe-meta-row').innerHTML = metaParts.join('');

    /* Géneros */
    document.getElementById('lwe-genres-row').innerHTML = d.genres.map(function(g) {
      var href = blogBase + '/search/label/' + encodeURIComponent(g);
      return '<a href="' + href + '" class="lwe-genre-pill" rel="tag">' + escHtml(g) + '</a>';
    }).join('');

    /* Sinopsis episodio */
    document.getElementById('lwe-ep-overview').textContent = d.epOverview;

    /* Header mini lista */
    document.getElementById('lwe-ep-list-season').textContent = d.season;
    document.getElementById('lwe-ver-todos').href = LW_SERIE_URL || '#';

    /* Panel derecho — poster */
    if (d.poster) document.getElementById('lwe-poster').src = d.poster;

    /* Panel — título serie */
    var panelMain = d.titleRomanized || d.serieTitle;
    document.getElementById('lwe-panel-title').textContent = panelMain;

    var subHtml = '';
    subHtml += '<div style="font-size:.7rem;color:#666;margin-bottom:3px;">' +
      '<span style="color:#444;font-weight:700;text-transform:uppercase;font-size:.6rem;letter-spacing:.1em;margin-right:4px;">ROM</span>' +
      escHtml(panelMain) + '</div>';
    if (d.serieTitle && d.serieTitle !== panelMain) {
      subHtml += '<div style="font-size:.7rem;color:#666;margin-bottom:3px;">' +
        '<span style="color:#444;font-weight:700;text-transform:uppercase;font-size:.6rem;letter-spacing:.1em;margin-right:4px;">ES</span>' +
        escHtml(d.serieTitle) + '</div>';
    }
    if (d.titleOriginal && d.titleOriginal !== panelMain && d.titleOriginal !== d.serieTitle) {
      subHtml += '<div style="font-size:.7rem;color:#555;">' +
        '<span style="color:#444;font-weight:700;text-transform:uppercase;font-size:.6rem;letter-spacing:.1em;margin-right:4px;">ORI</span>' +
        escHtml(d.titleOriginal) + '</div>';
    }
    document.getElementById('lwe-panel-original').innerHTML = subHtml;

    document.getElementById('lwe-panel-genres').innerHTML = d.genres.slice(0,4).map(function(g){
      var href = blogBase + '/search/label/' + encodeURIComponent(g);
      return '<a href="' + href + '" class="lwe-genre-chip-link" rel="tag">' + escHtml(g) + '</a>';
    }).join('');

    /* Ratings */
    renderRatings(d.ratings);

    /* Ficha episodio */
    var fichaRows = [
      ['Temporada',   'T' + d.season],
      ['Episodio',    d.season + 'x' + d.epNum],
      ['Duración',    d.runtime],
      ['Emisión',     d.epDate],
      ['Estudio',     d.studio],
    ];
    if (d.status)  fichaRows.push(['Estado',   d.status]);
    if (d.totalEps)fichaRows.push(['Total eps', d.totalEps]);
    if (d.malId)   fichaRows.push(['MAL', '<a href="https://myanimelist.net/anime/' + d.malId + '" target="_blank" rel="noopener" style="color:#2e51a2;text-decoration:none;">Ver en MyAnimeList ↗</a>']);
    if (LW_TMDB_ID) fichaRows.push(['TMDB', '<a href="https://www.themoviedb.org/tv/' + LW_TMDB_ID + '/season/' + d.season + '/episode/' + d.epNum + '" target="_blank" rel="noopener" style="color:#01d277;text-decoration:none;">Ver en TMDB ↗</a>']);

    document.getElementById('lwe-ficha').innerHTML = fichaRows.map(function(r){
      return '<div style="display:flex;justify-content:space-between;gap:8px;">' +
        '<span style="color:#666;">' + r[0] + '</span>' +
        '<span style="color:#e0e0e0;font-weight:500;text-align:right;">' + r[1] + '</span>' +
      '</div>';
    }).join('');

    /* SEO */
    injectSEO(d);
  }

  /* ════════════════════
     MINI LISTA EPISODIOS
  ════════════════════ */
  function renderMiniEpList(episodes, season, currentEp) {
    var cont  = document.getElementById('lwe-ep-scroll');
    var today = new Date();

    cont.innerHTML = episodes.map(function(ep) {
      var epNum     = ep.episode_number;
      var title     = ep.name || ('Episodio ' + epNum);
      var airDate   = ep.air_date ? new Date(ep.air_date) : null;
      var isUnlocked = airDate ? (airDate <= today) : false;
      var isCurrent  = epNum === currentEp;
      var sxe        = season + 'x' + epNum;
      var epUrl      = buildEpUrl(season, epNum);

      var thumb = ep.still_path
        ? 'https://image.tmdb.org/t/p/w185' + ep.still_path
        : '';

      var dateStr = '';
      if (airDate) {
        try { dateStr = airDate.toLocaleDateString('es-MX',{day:'numeric',month:'short',year:'numeric'}); }
        catch(e) { dateStr = ep.air_date; }
      }

      var thumbHtml = '<div class="lwe-ep-mini-thumb">' +
        (thumb ? '<img src="' + thumb + '" alt="' + escHtml(title) + '" loading="lazy">' :
          '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#2a2a2a;font-size:1rem;">▶</div>') +
        '<span class="lwe-ep-mini-num">' + sxe + '</span>' +
        (!isUnlocked ? '<div class="lwe-ep-mini-lock">🔒</div>' : '') +
        '</div>';

      var infoHtml = '<div style="min-width:0;flex:1;">' +
        '<div class="lwe-ep-mini-title">' + escHtml(title) + '</div>' +
        (dateStr ? '<div class="lwe-ep-mini-date">' + dateStr + '</div>' : '') +
        '</div>';

      var dotHtml = isCurrent ? '<div class="lwe-ep-mini-current-dot"></div>' : '';

      var classes = 'lwe-ep-item' + (isCurrent ? ' current' : '') + (!isUnlocked ? ' locked' : '');

      if (isUnlocked && !isCurrent) {
        return '<a href="' + epUrl + '" class="' + classes + '">' + thumbHtml + infoHtml + dotHtml + '</a>';
      } else {
        return '<div class="' + classes + '">' + thumbHtml + infoHtml + dotHtml + '</div>';
      }
    }).join('');
  }

  /* ════════════════════
     NAVEGACIÓN PREV/NEXT
  ════════════════════ */
  function renderNavigation(episodes, season, currentEp) {
    var today  = new Date();
    var sorted = episodes.slice().sort(function(a,b){ return a.episode_number - b.episode_number; });

    var prevEp = null, nextEp = null;
    sorted.forEach(function(ep) {
      if (ep.episode_number < currentEp) prevEp = ep;
      if (ep.episode_number > currentEp && !nextEp) {
        var airDate = ep.air_date ? new Date(ep.air_date) : null;
        if (airDate && airDate <= today) nextEp = ep;
        else if (!airDate) nextEp = ep;
      }
    });

    var prevBtn = document.getElementById('lwe-prev-btn');
    var nextBtn = document.getElementById('lwe-next-btn');

    if (prevEp) {
      prevBtn.href = buildEpUrl(season, prevEp.episode_number);
      prevBtn.classList.remove('disabled');
      document.getElementById('lwe-prev-title').textContent = prevEp.name || (season + 'x' + prevEp.episode_number);
    }

    if (nextEp) {
      nextBtn.href = buildEpUrl(season, nextEp.episode_number);
      nextBtn.classList.remove('disabled');
      document.getElementById('lwe-next-title').textContent = nextEp.name || (season + 'x' + nextEp.episode_number);
    }
  }

  /* ════════════════════
     RATINGS
  ════════════════════ */
  function renderRatings(ratings) {
    var el = document.getElementById('lwe-ratings');
    if (!ratings.length) {
      el.innerHTML = '<p style="color:#555;font-size:.8rem;">Sin calificaciones disponibles.</p>';
      return;
    }
    el.innerHTML = ratings.map(function(r) {
      var badge = r.icon === 'MAL'
        ? '<span class="lwe-badge-mal">MAL</span>'
        : '<span class="lwe-badge-tmdb">TMDB</span>';
      return '<div>' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:7px;">' +
          '<div style="display:flex;align-items:center;gap:8px;">' +
            badge +
            '<span style="font-weight:700;color:#fff;font-size:.88rem;">' + escHtml(r.score) +
              (r.votes ? ' <span style="color:#666;font-weight:400;font-size:.75rem;">(' + escHtml(r.votes) + ')</span>' : '') +
            '</span>' +
          '</div>' +
          '<span style="color:#555;font-size:.75rem;">' + escHtml(r.source) + '</span>' +
        '</div>' +
        '<div class="lwe-rbar-bg">' +
          '<div class="lwe-rbar-fill" data-pct="' + r.pct + '" style="width:0;background:' + r.color + ';"></div>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  /* ════════════════════
     REPRODUCTOR
  ════════════════════ */
  activeLangKey = (function() {
    var first = LW_LANGS.find(function(l){ return l.enabled; });
    return first ? first.key : '';
  })();

  function getActiveLangServers() {
    var lang = LW_LANGS.find(function(l){ return l.key === activeLangKey; });
    return (lang && lang.servers) ? lang.servers : [];
  }

  function buildLangSelector() {
    var sel = document.getElementById('lwe-lang-select');
    sel.innerHTML = '';
    LW_LANGS.forEach(function(l) {
      if (!l.enabled) return;
      var opt = document.createElement('option');
      opt.value = l.key;
      opt.textContent = l.flag + ' ' + l.label;
      if (l.key === activeLangKey) opt.selected = true;
      sel.appendChild(opt);
    });
    var cur = LW_LANGS.find(function(l){ return l.key === activeLangKey; });
    if (cur) document.getElementById('lwe-lang-flag').textContent = cur.flag;
  }

  function renderServers() {
    buildLangSelector();
    var servers = getActiveLangServers();
    var cont = document.getElementById('lwe-server-tabs');
    if (!servers.length) {
      cont.innerHTML = '<span style="color:#555;font-size:.8rem;">Sin servidores para este idioma.</span>';
      return;
    }
    cont.innerHTML = servers.map(function(s, i) {
      return '<button class="lwe-server-tab ' + (i===0?'active':'') + '" onclick="lweSwitchServer(this,' + i + ')">' + escHtml(s.name) + '</button>';
    }).join('');
    activeServer = 0;
    var first = servers[0];
    document.getElementById('lwe-play-label').textContent = 'Reproducir: ' + first.name;
  }

  window.lweChangeLang = function(sel) {
    activeLangKey = sel.value;
    var lang = LW_LANGS.find(function(l){ return l.key === activeLangKey; });
    document.getElementById('lwe-lang-flag').textContent = lang ? lang.flag : '🌐';
    var existing = document.getElementById('lwe-active-player');
    if (existing) existing.remove();
    var overlay = document.getElementById('lwe-play-overlay');
    var poster  = document.getElementById('lwe-player-poster');
    overlay.style.display = 'flex'; poster.style.display = 'block';
    var servers = getActiveLangServers();
    var cont = document.getElementById('lwe-server-tabs');
    cont.innerHTML = servers.map(function(s, i) {
      return '<button class="lwe-server-tab ' + (i===0?'active':'') + '" onclick="lweSwitchServer(this,' + i + ')">' + escHtml(s.name) + '</button>';
    }).join('');
    activeServer = 0;
    document.getElementById('lwe-play-label').textContent = servers.length ? ('Reproducir: ' + servers[0].name) : 'Reproducir';
    lweToast('OK', (lang ? lang.flag + ' ' : '') + (lang ? lang.label : sel.value));
  };

  window.lweSwitchServer = function(el, idx) {
    activeServer = idx;
    document.querySelectorAll('.lwe-server-tab').forEach(function(t){ t.classList.remove('active'); });
    el.classList.add('active');
    var existing = document.getElementById('lwe-active-player');
    if (existing) existing.remove();
    var overlay = document.getElementById('lwe-play-overlay');
    var poster  = document.getElementById('lwe-player-poster');
    overlay.style.display = 'flex'; poster.style.display = 'block';
    document.getElementById('lwe-play-label').textContent = 'Reproducir: ' + el.textContent;
    lweToast('OK', 'Servidor: ' + el.textContent);
  };

  window.lweStartPlayer = function() {
    var servers = getActiveLangServers();
    var server  = servers[activeServer] || { name: '?', url: '' };
    var overlay = document.getElementById('lwe-play-overlay');
    var poster  = document.getElementById('lwe-player-poster');
    var pw      = document.getElementById('lwe-player-wrap');
    overlay.style.display = 'none';
    poster.style.display  = 'none';
    var div = document.createElement('div');
    div.id = 'lwe-active-player';
    div.style.cssText = 'position:absolute;inset:0;';
    if (server.url) {
      var iframe = document.createElement('iframe');
      iframe.src = server.url;
      iframe.style.cssText = 'width:100%;height:100%;border:none;';
      iframe.allowFullscreen = true;
      div.appendChild(iframe);
    } else {
      div.style.cssText += 'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;background:#0d0d0d;';
      var langLabel = (LW_LANGS.find(function(l){ return l.key===activeLangKey; })||{}).label || activeLangKey;
      div.innerHTML =
        '<svg style="width:42px;height:42px;color:#00b4ff;" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>' +
        '<p style="color:#555;font-size:.82rem;font-family:Outfit,sans-serif;text-align:center;padding:0 24px;">' +
          'Servidor: <strong style="color:#e0e0e0;">' + escHtml(server.name) + '</strong> ' +
          '| Idioma: <strong style="color:#00b4ff;">' + escHtml(langLabel) + '</strong><br>' +
          '<span style="color:#333;font-size:.72rem;margin-top:4px;display:block;">Agrega la URL del embed en LW_LANGS</span>' +
        '</p>';
    }
    pw.appendChild(div);
  };

  /* ════════════════════
     SEO — TVEpisode
  ════════════════════ */
  function injectSEO(d) {
    var sxe      = d.season + 'x' + d.epNum;
    var seoTitle = d.serieTitle + ' ' + sxe + ' — ' + d.epTitle + ' | Ver Online Latino';
    var seoDesc  = (d.epOverview || '').slice(0, 160);
    var seoImg   = d.still || d.poster || '';
    var seoUrl   = window.location.href;

    try { document.title = seoTitle; } catch(e) {}

    function setMetaName(name, val) {
      var el = document.querySelector('meta[name="'+name+'"]');
      if (!el) { el=document.createElement('meta');el.setAttribute('name',name);document.head.appendChild(el); }
      el.setAttribute('content', val);
    }
    function setMetaProp(prop, val) {
      var el = document.querySelector('meta[property="'+prop+'"]');
      if (!el) { el=document.createElement('meta');el.setAttribute('property',prop);document.head.appendChild(el); }
      el.setAttribute('content', val);
    }

    setMetaName('description',         seoDesc);
    setMetaName('robots',              'index, follow');
    setMetaName('author',              'BisonPlus');
    setMetaProp('og:title',            seoTitle);
    setMetaProp('og:description',      seoDesc);
    setMetaProp('og:image',            seoImg);
    setMetaProp('og:url',              seoUrl);
    setMetaProp('og:type',             'video.episode');
    setMetaProp('og:site_name',        'BisonPlus');
    setMetaName('twitter:card',        'summary_large_image');
    setMetaName('twitter:title',       seoTitle);
    setMetaName('twitter:description', seoDesc);
    setMetaName('twitter:image',       seoImg);

    var canon = document.querySelector('link[rel="canonical"]');
    if (!canon) { canon=document.createElement('link');canon.setAttribute('rel','canonical');document.head.appendChild(canon); }
    canon.setAttribute('href', seoUrl);

    /* JSON-LD TVEpisode */
    var jsonLd = {
      '@context':      'https://schema.org',
      '@type':         'TVEpisode',
      'name':           d.epTitle,
      'episodeNumber':  d.epNum,
      'partOfSeason': {
        '@type':        'TVSeason',
        'seasonNumber':  d.season
      },
      'partOfSeries': {
        '@type': 'TVSeries',
        'name':   d.serieTitle,
        'url':    LW_SERIE_URL || ''
      },
      'description':    d.epOverview,
      'image':          seoImg,
      'datePublished':  d.epDate,
      'url':            seoUrl,
      'inLanguage':     'es'
    };
    var existing = document.getElementById('lwe-jsonld');
    if (!existing) {
      existing = document.createElement('script');
      existing.type = 'application/ld+json';
      existing.id   = 'lwe-jsonld';
      document.head.appendChild(existing);
    }
    existing.textContent = JSON.stringify(jsonLd, null, 2);
  }

  /* ════════════════════
     UTILIDADES GLOBALES
  ════════════════════ */
  window.lweShare = function(net) {
    var url   = encodeURIComponent(window.location.href);
    var title = encodeURIComponent(document.title);
    var links = {
      twitter:  'https://twitter.com/intent/tweet?text=' + title + '&url=' + url,
      facebook: 'https://www.facebook.com/sharer/sharer.php?u=' + url,
    };
    if (links[net]) window.open(links[net], '_blank', 'width=600,height=400');
  };
  window.lweCopyLink = function() {
    try { navigator.clipboard.writeText(window.location.href); } catch(e) {}
    lweToast('OK', 'Enlace copiado');
  };

  function lweToast(icon, msg) {
    clearTimeout(toastTimer);
    document.getElementById('lwe-toast-icon').textContent = icon;
    document.getElementById('lwe-toast-msg').textContent  = msg;
    document.getElementById('lwe-toast').classList.add('lwe-show');
    toastTimer = setTimeout(function(){ document.getElementById('lwe-toast').classList.remove('lwe-show'); }, 2800);
  }
  function showError(msg) {
    var w = document.getElementById('lwe-widget');
    w.style.display = 'block';
    w.innerHTML = '<div class="lwe-error">⚠️ ' + msg + '</div>';
  }
  function hideLoading() {
    var el = document.getElementById('lwe-loading');
    if (el) el.style.display = 'none';
  }
  function fmtVotes(n) {
    n = parseInt(String(n).replace(/,/g,''));
    if (isNaN(n)||n===0) return '';
    if (n>=1000000) return (n/1000000).toFixed(1)+'M';
    if (n>=1000)    return Math.round(n/1000)+'k';
    return String(n);
  }
  function escHtml(str) {
    return String(str)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  /* Arranca */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();

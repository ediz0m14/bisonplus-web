(function() {
  'use strict';

  /* ── Claves API ── */
  var TMDB_KEY = '0606cd80dcd2a4e953505725aa5ea13d';

  /* ── Estado ── */
  var trailerYtId   = '';
  var toastTimer    = null;
  var tmdbSeasons   = [];
  var activeSeason  = 1;
  var tmdbShowId    = 0;
  var globalData    = null;
  var episodesCache = {};
  var sortDesc      = false;
  var lwsTrailerKey   = '';
  var lwsTrailerTitle = '';

  /* Dominio: usa LW_BLOG_URL si esta definido, sino el dominio actual */
  var blogBase = (LW_BLOG_URL || window.location.origin).replace(/\/+$/, '');

  /* Construye la URL de un episodio incluyendo LW_DATE
     Resultado: https://blog.com/2026/02/dr-stone-1x3.html */
  function buildEpUrl(season, epNum) {
    var date = (LW_DATE || '').replace(/\/+$/, '');
    if (date) return blogBase + '/' + date + '/' + LW_SLUG + '-' + season + 'x' + epNum + '.html';
    return blogBase + '/' + LW_SLUG + '-' + season + 'x' + epNum + '.html';
  }

  /* ════════════════════════════
     EXTRAE ID NUMÉRICO
  ════════════════════════════ */
  function extractId(input) {
    if (!input) return null;
    var str = String(input).trim();
    if (/^\d+$/.test(str)) return parseInt(str);
    var m = str.match(/\/(movie|tv|anime)\/(\d+)/);
    if (m) return parseInt(m[2]);
    return null;
  }

  /* ════════════════════════════
     FETCH HELPER
  ════════════════════════════ */
  function apiFetch(url) {
    return fetch(url).then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  /* ════════════════════════════
     INIT
  ════════════════════════════ */
  function init() {
    var malId  = parseInt(LW_MAL_ID)  || 0;
    var tmdbId = extractId(LW_TMDB_ID) || 0;

    if (!malId && !tmdbId) {
      showError('Define LW_MAL_ID y/o LW_TMDB_ID en la configuración.');
      hideLoading(); return;
    }

    tmdbShowId = tmdbId;

    /* Carga en paralelo MAL + TMDB */
    var jikanP = malId
      ? Promise.all([
          apiFetch('https://api.jikan.moe/v4/anime/' + malId),
          apiFetch('https://api.jikan.moe/v4/anime/' + malId + '/videos')
        ]).catch(function(e) {
          /* Rate-limit de Jikan — reintento tras 1.2s */
          return new Promise(function(res) {
            setTimeout(function() {
              Promise.all([
                apiFetch('https://api.jikan.moe/v4/anime/' + malId),
                apiFetch('https://api.jikan.moe/v4/anime/' + malId + '/videos')
              ]).then(res).catch(function() { res([null, null]); });
            }, 1200);
          });
        })
      : Promise.resolve([null, null]);

    var tmdbP = tmdbId
      ? Promise.all([
          apiFetch('https://api.themoviedb.org/3/tv/' + tmdbId + '?api_key=' + TMDB_KEY + '&language=es-MX'),
          apiFetch('https://api.themoviedb.org/3/tv/' + tmdbId + '/videos?api_key=' + TMDB_KEY + '&language=es-MX'),
          apiFetch('https://api.themoviedb.org/3/tv/' + tmdbId + '/videos?api_key=' + TMDB_KEY + '&language=en-US'),
          apiFetch('https://api.themoviedb.org/3/tv/' + tmdbId + '/content_ratings?api_key=' + TMDB_KEY)
        ]).catch(function() { return [null, null, null, null]; })
      : Promise.resolve([null, null, null, null]);

    document.getElementById('lws-loading-msg').textContent = 'Importando datos del anime…';

    Promise.all([jikanP, tmdbP]).then(function(results) {
      var jikanArr = results[0];
      var tmdbArr  = results[1];

      var jikan     = (jikanArr[0] && jikanArr[0].data) ? jikanArr[0].data : null;
      var jikanVids = (jikanArr[1] && jikanArr[1].data) ? jikanArr[1].data : null;
      var tmdb      = tmdbArr[0];
      var videosEs  = tmdbArr[1];
      var videosEn  = tmdbArr[2];
      var ratings   = tmdbArr[3];

      var data = buildData(jikan, jikanVids, tmdb, videosEs, videosEn, ratings);
      globalData = data;
      renderWidget(data);

      /* Cargar temporadas si hay TMDB */
      if (tmdbId && tmdb && tmdb.seasons) {
        /* Filtrar especiales (season_number 0) */
        tmdbSeasons = tmdb.seasons
          .filter(function(s) { return s.season_number > 0; })
          .map(function(s) { return s.season_number; });

        if (tmdbSeasons.length > 0) {
          buildSeasonTabs(tmdbSeasons);
          loadSeason(tmdbSeasons[0]);
        }
      }

      hideLoading();
      document.getElementById('lws-widget').style.display = 'block';

    }).catch(function(err) {
      console.error('Error cargando datos:', err);
      showError('No se pudo conectar con las APIs. Verifica los IDs en la configuración.');
      hideLoading();
    });
  }

  /* ════════════════════════════
     BUILD DATA
  ════════════════════════════ */
  function buildData(jikan, jikanVids, tmdb, videosEs, videosEn, contentRatings) {
    /* ── Títulos (desde Jikan si existe) ── */
    var titleEs        = '';
    var titleRomanized = '';
    var titleOriginal  = '';

    if (jikan) {
      titleRomanized = jikan.title          || '';
      titleOriginal  = jikan.title_japanese || '';
      var titleEnglish = jikan.title_english || '';

      if (jikan.titles && jikan.titles.length) {
        var esT = jikan.titles.find(function(t) {
          return t.type === 'Spanish' || (t.title && /[áéíóúñ¿¡]/i.test(t.title));
        });
        if (esT) titleEs = esT.title;
      }
      if (!titleEs && tmdb) {
        titleEs = tmdb.name || tmdb.original_name || titleEnglish || titleRomanized;
      } else if (!titleEs) {
        titleEs = titleEnglish || titleRomanized;
      }
    } else if (tmdb) {
      titleEs        = tmdb.name || tmdb.original_name || 'Sin título';
      titleRomanized = tmdb.original_name || '';
      titleOriginal  = '';
    }

    var mainTitle = titleEs || titleRomanized || 'Sin título';

    /* ── Sinopsis — priorizar TMDB en español ── */
    var overview = 'Sin sinopsis disponible.';
    if (tmdb && tmdb.overview && tmdb.overview.trim()) {
      overview = tmdb.overview;
    } else if (jikan && jikan.synopsis) {
      overview = jikan.synopsis;
    }

    /* ── Póster — siempre de MAL/Jikan ── */
    var poster = '';
    if (jikan && jikan.images) {
      var jpgImgs = jikan.images.jpg || {};
      poster = jpgImgs.large_image_url || jpgImgs.image_url || '';
    }
    if (!poster && tmdb && tmdb.poster_path) {
      poster = 'https://image.tmdb.org/t/p/w500' + tmdb.poster_path;
    }

    /* ── Backdrop — siempre de TMDB ── */
    var backdrop = '';
    if (tmdb && tmdb.backdrop_path) {
      backdrop = 'https://image.tmdb.org/t/p/original' + tmdb.backdrop_path;
    }
    if (!backdrop) backdrop = poster;

    /* ── Géneros ── */
    var genreMap = {
      'Action': 'Acción', 'Adventure': 'Aventura', 'Comedy': 'Comedia',
      'Drama': 'Drama', 'Fantasy': 'Fantasía', 'Horror': 'Terror',
      'Mystery': 'Misterio', 'Romance': 'Romance', 'Sci-Fi': 'Ciencia ficción',
      'Science Fiction': 'Ciencia ficción',
      'Slice of Life': 'Vida cotidiana', 'Sports': 'Deportes',
      'Supernatural': 'Sobrenatural', 'Thriller': 'Suspenso',
      'Music': 'Música', 'Psychological': 'Psicológico',
      'Mecha': 'Mecha', 'Isekai': 'Isekai', 'Historical': 'Histórico',
      'Military': 'Militar', 'School': 'Escolar', 'Magic': 'Magia',
      'Ecchi': 'Ecchi', 'Harem': 'Harem', 'Demons': 'Demonios',
      'Samurai': 'Samurai', 'Space': 'Espacial', 'Vampire': 'Vampiros',
      'Martial Arts': 'Artes marciales', 'Game': 'Juego', 'Kids': 'Infantil',
      'Animation': 'Animación',
    };
    var genres = [];
    if (jikan) {
      genres = (jikan.genres || []).concat(jikan.themes || []).map(function(g) {
        return genreMap[g.name] || g.name;
      });
    } else if (tmdb && tmdb.genres) {
      genres = tmdb.genres.map(function(g) { return genreMap[g.name] || g.name; });
    }

    /* ── Ratings ── */
    var ratings = [];
    /* TMDB */
    if (tmdb && tmdb.vote_average && tmdb.vote_average > 0) {
      ratings.push({
        source: 'TMDB', icon: 'TMDB',
        score:  tmdb.vote_average.toFixed(1) + ' / 10',
        votes:  tmdb.vote_count ? fmtVotes(tmdb.vote_count) : '',
        pct:    (tmdb.vote_average / 10) * 100,
        color:  '#01d277'
      });
    }
    /* MAL */
    if (jikan && jikan.score && jikan.score > 0) {
      ratings.push({
        source: 'MyAnimeList', icon: 'MAL',
        score:  jikan.score.toFixed(2) + ' / 10',
        votes:  jikan.scored_by ? fmtVotes(jikan.scored_by) : '',
        pct:    (jikan.score / 10) * 100,
        color:  '#2e51a2'
      });
    }

    /* ── Tráiler ── */
    var trailer = null;
    if (LW_TRAILER_YT) {
      trailer = { key: LW_TRAILER_YT, name: 'Tráiler oficial' };
    } else {
      var allVids = [].concat(
        (videosEs && videosEs.results) || [],
        (videosEn && videosEn.results) || []
      );
      if (jikanVids && jikanVids.promo && jikanVids.promo.length) {
        var promo = jikanVids.promo[0];
        if (promo.trailer && promo.trailer.youtube_id) {
          allVids.unshift({ key: promo.trailer.youtube_id, type: 'Trailer', site: 'YouTube', name: promo.title || 'Tráiler oficial' });
        }
      }
      trailer = allVids.find(function(v){ return v.type==='Trailer' && v.site==='YouTube'; })
             || allVids.find(function(v){ return v.type==='Teaser'  && v.site==='YouTube'; })
             || (allVids.length ? allVids[0] : null);
    }

    /* ── Año / Estreno ── */
    var year = '';
    var releaseFormatted = 'N/D';
    if (tmdb && tmdb.first_air_date) {
      year = tmdb.first_air_date.slice(0, 4);
      try {
        releaseFormatted = new Date(tmdb.first_air_date).toLocaleDateString('es-MX', {
          day: 'numeric', month: 'long', year: 'numeric'
        });
      } catch(e) { releaseFormatted = tmdb.first_air_date; }
    } else if (jikan && jikan.aired && jikan.aired.from) {
      year = jikan.aired.from.slice(0, 4);
      try {
        releaseFormatted = new Date(jikan.aired.from).toLocaleDateString('es-MX', {
          day: 'numeric', month: 'long', year: 'numeric'
        });
      } catch(e) { releaseFormatted = jikan.aired.from; }
    }

    /* ── Estado ── */
    var statusMap = {
      'Finished Airing': 'Finalizado',
      'Currently Airing': 'En emisión',
      'Not yet aired': 'Próximamente',
      'Ended': 'Finalizado',
      'Returning Series': 'En emisión',
      'In Production': 'En producción',
      'Planned': 'Planeado',
      'Canceled': 'Cancelado',
    };
    var status = '';
    if (tmdb && tmdb.status) status = statusMap[tmdb.status] || tmdb.status;
    else if (jikan && jikan.status) status = statusMap[jikan.status] || jikan.status;

    /* ── Studio / Director ── */
    var studios = '';
    if (jikan) {
      studios = (jikan.studios || []).map(function(s){ return s.name; }).join(', ') || '';
    }
    if (!studios && tmdb && tmdb.networks) {
      studios = tmdb.networks.slice(0,2).map(function(n){ return n.name; }).join(', ');
    }
    if (!studios) studios = 'N/D';

    /* ── Duración episodio ── */
    var runtime = 'N/D';
    if (jikan && jikan.duration) {
      runtime = jikan.duration.replace(/ per ep\.?/i, '').trim();
    } else if (tmdb && tmdb.episode_run_time && tmdb.episode_run_time.length) {
      runtime = tmdb.episode_run_time[0] + ' min';
    }

    /* ── Clasificación ── */
    var ageRating = '';
    if (contentRatings && contentRatings.results) {
      var cr = contentRatings.results.find(function(r){ return r.iso_3166_1==='MX'; })
            || contentRatings.results.find(function(r){ return r.iso_3166_1==='US'; });
      if (cr && cr.rating) ageRating = cr.rating;
    }
    if (!ageRating && jikan && jikan.rating) ageRating = jikan.rating;

    /* ── Número total de eps ── */
    var totalEps = null;
    if (tmdb && tmdb.number_of_episodes) totalEps = tmdb.number_of_episodes;
    else if (jikan && jikan.episodes) totalEps = jikan.episodes;

    /* ── Número de temporadas ── */
    var totalSeasons = null;
    if (tmdb && tmdb.seasons) {
      totalSeasons = tmdb.seasons.filter(function(s){ return s.season_number > 0; }).length;
    }

    return {
      title:          mainTitle,
      romanizedTitle: (titleRomanized && titleRomanized !== mainTitle) ? titleRomanized : '',
      originalTitle:  titleOriginal,
      year:           year,
      overview:       overview,
      genres:         genres,
      poster:         poster,
      backdrop:       backdrop,
      runtime:        runtime,
      ageRating:      ageRating,
      studio:         studios,
      ratings:        ratings,
      trailer:        trailer,
      releaseDate:    releaseFormatted,
      status:         status,
      totalEps:       totalEps,
      totalSeasons:   totalSeasons,
      malId:          (jikan && jikan.mal_id) ? jikan.mal_id : 0,
    };
  }

  /* ════════════════════════════
     RENDER WIDGET
  ════════════════════════════ */
  function renderWidget(d) {
    /* Hero backdrop */
    var bgEl = document.getElementById('lws-hero-bg');
    if (d.backdrop || d.poster) {
      bgEl.style.backgroundImage = "url('" + (d.backdrop || d.poster) + "')";
    }

    /* Título hero */
    var heroMain = d.romanizedTitle || d.title;
    document.getElementById('lws-title').innerHTML =
      escHtml(heroMain) +
      (d.year ? ' <span style="color:#666;font-weight:300;font-size:.55em;">(' + d.year + ')</span>' : '');

    /* Subtítulos hero */
    var titlesHtml = '';
    if (d.originalTitle && d.originalTitle !== heroMain) {
      titlesHtml += '<p style="color:#888;font-size:.82rem;margin:0;">' +
        '<span style="color:#555;font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-right:6px;">Original</span>' +
        escHtml(d.originalTitle) + '</p>';
    }
    document.getElementById('lws-titles-extra').innerHTML = titlesHtml;

    /* SEO */
    injectSEO(d);

    /* Meta row */
    var metaParts = [];
    var tmdbR = d.ratings.find(function(r){ return r.source==='TMDB'; });
    if (tmdbR) metaParts.push('<span style="color:#01d277;font-weight:700;font-size:.9rem;">★ ' + tmdbR.score.split(' ')[0] + '</span>');
    var malR  = d.ratings.find(function(r){ return r.source==='MyAnimeList'; });
    if (malR) metaParts.push(
      '<span style="width:1px;height:14px;background:#2a2a2a;display:inline-block;"></span>' +
      '<span class="lws-badge-mal">MAL</span>' +
      '<span style="font-weight:700;font-size:.88rem;">' + malR.score.split(' ')[0] +
        (malR.votes ? ' <span style="color:#666;font-weight:400;font-size:.78rem;">(' + malR.votes + ')</span>' : '') +
      '</span>'
    );
    if (d.ageRating) metaParts.push(
      '<span style="width:1px;height:14px;background:#2a2a2a;display:inline-block;"></span>' +
      '<span class="lws-badge-age">' + escHtml(d.ageRating) + '</span>'
    );
    if (d.runtime !== 'N/D') metaParts.push(
      '<span style="width:1px;height:14px;background:#2a2a2a;display:inline-block;"></span>' +
      '<span style="color:#8a8a8a;font-size:.85rem;">⏱ ' + escHtml(d.runtime) + '</span>'
    );
    if (d.status) metaParts.push(
      '<span style="width:1px;height:14px;background:#2a2a2a;display:inline-block;"></span>' +
      '<span style="font-size:.75rem;padding:2px 8px;border-radius:4px;font-weight:700;background:' +
        (d.status === 'En emisión' ? 'rgba(0,180,255,0.15);color:#00b4ff;border:1px solid rgba(0,180,255,0.3)' :
         d.status === 'Finalizado' ? 'rgba(255,255,255,0.06);color:#888;border:1px solid #2a2a2a' :
         'rgba(255,102,0,0.15);color:#ff9944;border:1px solid rgba(255,102,0,0.3)') +
      '">' + escHtml(d.status) + '</span>'
    );
    document.getElementById('lws-meta-row').innerHTML = metaParts.join('');

    /* Géneros hero */
    document.getElementById('lws-genres-row').innerHTML = d.genres.map(function(g) {
      var href = blogBase + '/search/label/' + encodeURIComponent(g);
      return '<a href="' + href + '" class="lws-genre-pill" rel="tag">' + escHtml(g) + '</a>';
    }).join('');

    /* Poster */
    var posterEl = document.getElementById('lws-poster');
    if (d.poster) posterEl.src = d.poster;

    /* Panel título */
    var panelMain = d.romanizedTitle || d.title;
    document.getElementById('lws-panel-title').textContent = panelMain;

    var panelSubHtml = '';
    panelSubHtml += '<div style="font-size:.7rem;color:#666;margin-bottom:3px;">' +
      '<span style="color:#444;font-weight:700;text-transform:uppercase;font-size:.6rem;letter-spacing:.1em;margin-right:4px;">ROM</span>' +
      escHtml(panelMain) + '</div>';
    if (d.title && d.title !== panelMain) {
      panelSubHtml += '<div style="font-size:.7rem;color:#666;margin-bottom:3px;">' +
        '<span style="color:#444;font-weight:700;text-transform:uppercase;font-size:.6rem;letter-spacing:.1em;margin-right:4px;">ES</span>' +
        escHtml(d.title) + '</div>';
    }
    if (d.originalTitle && d.originalTitle !== panelMain && d.originalTitle !== d.title) {
      panelSubHtml += '<div style="font-size:.7rem;color:#555;">' +
        '<span style="color:#444;font-weight:700;text-transform:uppercase;font-size:.6rem;letter-spacing:.1em;margin-right:4px;">ORI</span>' +
        escHtml(d.originalTitle) + '</div>';
    }
    document.getElementById('lws-panel-original').innerHTML = panelSubHtml;

    document.getElementById('lws-panel-genres').innerHTML = d.genres.slice(0,4).map(function(g){
      var href = blogBase + '/search/label/' + encodeURIComponent(g);
      return '<a href="' + href + '" class="lws-genre-chip-link" rel="tag">' + escHtml(g) + '</a>';
    }).join('');

    /* Director / Studio */
    document.getElementById('lws-director').textContent = d.studio;

    /* Ratings */
    renderRatings(d.ratings);

    /* Ficha */
    renderFicha(d);

    /* Sinopsis */
    var synEl = document.getElementById('lws-synopsis');
    synEl.textContent = d.overview;
    if (d.overview.length > 220) {
      document.getElementById('lws-syn-btn').style.display = 'inline';
    }

    /* Tráiler → panel derecho */
    if (d.trailer && d.trailer.key) {
      trailerYtId    = d.trailer.key;
      lwsTrailerKey   = d.trailer.key;
      lwsTrailerTitle = d.title;
      var ts = document.getElementById('lws-trailer-section');
      ts.style.display = 'block';
      document.getElementById('lws-trailer-img').src    = 'https://img.youtube.com/vi/' + trailerYtId + '/hqdefault.jpg';
      document.getElementById('lws-trailer-label').textContent = d.trailer.name || 'Tráiler oficial';
      document.getElementById('lws-modal-label').textContent   = d.title + ' — ' + (d.trailer.name || 'Tráiler');
    }

    /* Animar barras */
    setTimeout(function() {
      document.querySelectorAll('.lws-rbar-fill[data-pct]').forEach(function(b) {
        b.style.width = Math.min(parseFloat(b.getAttribute('data-pct')), 100) + '%';
      });
    }, 350);
  }

  /* ════════════════════════════
     TEMPORADAS + EPISODIOS
  ════════════════════════════ */
  function buildSeasonTabs(seasons) {
    var cont = document.getElementById('lws-season-tabs');
    cont.innerHTML = seasons.map(function(sn, i) {
      return '<button class="lws-season-btn ' + (i===0?'active':'') + '" ' +
        'onclick="lwsSelectSeason(this,' + sn + ')">' +
        'T' + sn + '</button>';
    }).join('');
  }

  window.lwsSelectSeason = function(el, seasonNum) {
    activeSeason = seasonNum;
    document.querySelectorAll('.lws-season-btn').forEach(function(b){ b.classList.remove('active'); });
    el.classList.add('active');
    loadSeason(seasonNum);
  };

  function loadSeason(seasonNum) {
    activeSeason = seasonNum;
    var epList = document.getElementById('lws-ep-list');

    /* Limpiar buscador al cambiar temporada */
    var searchInput = document.getElementById('lws-ep-search');
    if (searchInput) searchInput.value = '';
    document.getElementById('lws-ep-empty').style.display = 'none';

    /* Skeleton mientras carga */
    epList.innerHTML = [1,2,3,4,5].map(function(){
      return '<div style="display:flex;gap:12px;padding:10px;border-radius:10px;border:1px solid #1e1e1e;background:#111;">' +
        '<div class="lws-skel" style="width:112px;min-width:112px;aspect-ratio:16/9;border-radius:6px;"></div>' +
        '<div style="flex:1;display:flex;flex-direction:column;gap:8px;padding:4px 0;">' +
          '<div class="lws-skel" style="height:14px;width:60%;"></div>' +
          '<div class="lws-skel" style="height:10px;width:30%;"></div>' +
          '<div class="lws-skel" style="height:10px;width:90%;"></div>' +
          '<div class="lws-skel" style="height:10px;width:75%;"></div>' +
        '</div>' +
      '</div>';
    }).join('');

    /* Usar cache si ya se cargó */
    if (episodesCache[seasonNum]) {
      renderEpisodes(episodesCache[seasonNum], seasonNum);
      return;
    }

    apiFetch('https://api.themoviedb.org/3/tv/' + tmdbShowId + '/season/' + seasonNum + '?api_key=' + TMDB_KEY + '&language=es-MX')
      .then(function(season) {
        episodesCache[seasonNum] = season.episodes || [];
        renderEpisodes(episodesCache[seasonNum], seasonNum);
      })
      .catch(function() {
        epList.innerHTML = '<p style="color:#555;font-size:.85rem;text-align:center;padding:20px 0;">No se pudieron cargar los episodios.</p>';
      });
  }

  function renderEpisodes(episodes, seasonNum, filterText) {
    var epList = document.getElementById('lws-ep-list');
    var today  = new Date();
    var sn = seasonNum || activeSeason;

    if (!episodes.length) {
      epList.innerHTML = '<p style="color:#555;font-size:.85rem;text-align:center;padding:20px 0;">Sin episodios disponibles para esta temporada.</p>';
      return;
    }

    /* Orden */
    var list = episodes.slice();
    if (sortDesc) list = list.reverse();

    /* Filtro por texto */
    var query = (filterText || '').trim().toLowerCase();
    if (query) {
      list = list.filter(function(ep) {
        var title = (ep.name || '').toLowerCase();
        var num   = String(ep.episode_number);
        return title.indexOf(query) >= 0 || num.indexOf(query) >= 0;
      });
    }

    /* Mostrar/ocultar mensaje vacío */
    var emptyEl = document.getElementById('lws-ep-empty');
    if (!list.length) {
      epList.innerHTML = '';
      document.getElementById('lws-ep-empty-q').textContent = query;
      emptyEl.style.display = 'block';
      return;
    }
    emptyEl.style.display = 'none';

    epList.innerHTML = list.map(function(ep) {
      var epNum    = ep.episode_number;
      var title    = ep.name || ('Episodio ' + epNum);
      var overview = ep.overview || '';
      var airDate  = ep.air_date ? new Date(ep.air_date) : null;
      var isUnlocked = airDate ? (airDate <= today) : false;

      /* Miniatura TMDB */
      var thumb = ep.still_path
        ? 'https://image.tmdb.org/t/p/w300' + ep.still_path
        : '';

      /* Fecha formateada */
      var dateStr = '';
      if (airDate) {
        try {
          dateStr = airDate.toLocaleDateString('es-MX', { day:'numeric', month:'long', year:'numeric' });
        } catch(e) { dateStr = ep.air_date; }
      }

      /* URL del episodio con fecha incluida */
      var epUrl = buildEpUrl(sn, epNum);

      /* Etiqueta SxE en miniatura */
      var labelSxE = sn + 'x' + epNum;

      /* Thumb HTML */
      var thumbHtml = '<div class="lws-ep-thumb">';
      if (thumb) {
        thumbHtml += '<img src="' + thumb + '" alt="' + escHtml(title) + '" loading="lazy">';
      } else {
        thumbHtml += '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#333;font-size:1.4rem;">▶</div>';
      }
      thumbHtml += '<span class="lws-ep-num">' + labelSxE + '</span>';
      if (!isUnlocked) {
        thumbHtml += '<div class="lws-ep-lock">🔒</div>';
      }
      thumbHtml += '</div>';

      if (isUnlocked) {
        return '<a href="' + epUrl + '" class="lws-ep-card">' +
          thumbHtml +
          '<div class="lws-ep-info">' +
            '<div class="lws-ep-title">' + escHtml(title) + '</div>' +
            (dateStr ? '<div class="lws-ep-date">📅 ' + dateStr + '</div>' : '') +
            (overview ? '<div class="lws-ep-overview">' + escHtml(overview) + '</div>' : '') +
          '</div>' +
        '</a>';
      } else {
        return '<div class="lws-ep-card locked">' +
          thumbHtml +
          '<div class="lws-ep-info">' +
            '<div class="lws-ep-title" style="color:#444;">' + escHtml(title) + '</div>' +
            (dateStr ? '<div class="lws-ep-date" style="color:#333;">📅 ' + dateStr + '</div>' : '') +
            '<div class="lws-ep-date" style="color:#333;font-size:.72rem;">🔒 Próximamente</div>' +
          '</div>' +
        '</div>';
      }
    }).join('');
  }

  /* ════════════════════════════
     RENDER HELPERS
  ════════════════════════════ */
  function renderRatings(ratings) {
    var el = document.getElementById('lws-ratings');
    if (!ratings.length) {
      el.innerHTML = '<p style="color:#555;font-size:.8rem;">Sin calificaciones disponibles.</p>';
      return;
    }
    el.innerHTML = ratings.map(function(r) {
      var badge = '';
      if (r.icon === 'MAL') {
        badge = '<span class="lws-badge-mal">MAL</span>';
      } else if (r.icon === 'TMDB') {
        badge = '<span class="lws-badge-tmdb">TMDB</span>';
      } else {
        badge = '<span style="font-size:1rem;">' + (r.icon || '?') + '</span>';
      }
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
        '<div class="lws-rbar-bg">' +
          '<div class="lws-rbar-fill" data-pct="' + r.pct + '" style="width:0;background:' + r.color + ';"></div>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function renderFicha(d) {
    var rows = [
      ['Año',          d.year          || 'N/D'],
      ['Estreno',      d.releaseDate],
      ['Duración ep.', d.runtime],
      ['País',         'Japón'],
      ['Idioma',       'JA'],
      ['Estudio',      d.studio],
    ];
    if (d.romanizedTitle && d.romanizedTitle !== d.title) {
      rows.splice(0, 0, ['Romanizado', d.romanizedTitle]);
    }
    if (d.originalTitle && d.originalTitle !== d.title) {
      rows.splice(0, 0, ['Original', d.originalTitle]);
    }
    if (d.ageRating)    rows.push(['Clasificación', d.ageRating]);
    if (d.totalSeasons) rows.push(['Temporadas',    d.totalSeasons]);
    if (d.totalEps)     rows.push(['Episodios',     d.totalEps]);
    if (d.status)       rows.push(['Estado',        d.status]);
    if (d.malId)        rows.push(['MAL', '<a href="https://myanimelist.net/anime/' + d.malId + '" target="_blank" rel="noopener" style="color:#2e51a2;text-decoration:none;">Ver en MyAnimeList ↗</a>']);
    if (tmdbShowId)     rows.push(['TMDB', '<a href="https://www.themoviedb.org/tv/' + tmdbShowId + '" target="_blank" rel="noopener" style="color:#01d277;text-decoration:none;">Ver en TMDB ↗</a>']);

    document.getElementById('lws-ficha').innerHTML = rows.map(function(r){
      return '<div style="display:flex;justify-content:space-between;gap:8px;">' +
        '<span style="color:#666;">' + r[0] + '</span>' +
        '<span style="color:#e0e0e0;font-weight:500;text-align:right;">' + r[1] + '</span>' +
      '</div>';
    }).join('');
  }

  /* ════════════════════════════
     SEO
  ════════════════════════════ */
  function injectSEO(d) {
    var seoTitleParts = [d.title];
    if (d.romanizedTitle && d.romanizedTitle !== d.title) seoTitleParts.push(d.romanizedTitle);
    if (d.originalTitle  && d.originalTitle  !== d.title && d.originalTitle !== d.romanizedTitle) seoTitleParts.push(d.originalTitle);
    var seoTitle    = seoTitleParts.join(' / ') + (d.year ? ' (' + d.year + ')' : '') + ' - Ver Online Latino';
    var seoDesc     = (d.overview || '').slice(0, 160);
    var seoImg      = d.poster || d.backdrop || '';
    var seoUrl      = window.location.href;
    var seoKeywords = [d.title, d.romanizedTitle, d.originalTitle]
                        .filter(Boolean).concat(d.genres || [])
                        .concat(['ver online', 'anime', 'serie', 'latino', 'subtitulado', d.year])
                        .filter(Boolean).join(', ');

    try { document.title = seoTitle; } catch(e) {}

    function setMetaName(name, val) {
      var el = document.querySelector('meta[name="' + name + '"]');
      if (!el) { el = document.createElement('meta'); el.setAttribute('name', name); document.head.appendChild(el); }
      el.setAttribute('content', val);
    }
    function setMetaProp(prop, val) {
      var el = document.querySelector('meta[property="' + prop + '"]');
      if (!el) { el = document.createElement('meta'); el.setAttribute('property', prop); document.head.appendChild(el); }
      el.setAttribute('content', val);
    }

    setMetaName('description',         seoDesc);
    setMetaName('keywords',            seoKeywords);
    setMetaName('robots',              'index, follow');
    setMetaName('author',              'BisonPlus');
    setMetaProp('og:title',            seoTitle);
    setMetaProp('og:description',      seoDesc);
    setMetaProp('og:image',            seoImg);
    setMetaProp('og:url',              seoUrl);
    setMetaProp('og:type',             'video.tv_show');
    setMetaProp('og:site_name',        'BisonPlus');
    setMetaProp('og:locale',           'es_MX');
    setMetaName('twitter:card',        'summary_large_image');
    setMetaName('twitter:title',       seoTitle);
    setMetaName('twitter:description', seoDesc);
    setMetaName('twitter:image',       seoImg);

    var canon = document.querySelector('link[rel="canonical"]');
    if (!canon) { canon = document.createElement('link'); canon.setAttribute('rel','canonical'); document.head.appendChild(canon); }
    canon.setAttribute('href', seoUrl);

    /* JSON-LD TVSeries */
    var malR  = (d.ratings || []).find(function(r){ return r.source === 'MyAnimeList'; });
    var tmdbR = (d.ratings || []).find(function(r){ return r.source === 'TMDB'; });
    var bestRating = malR || tmdbR;

    var jsonLd = {
      '@context':     'https://schema.org',
      '@type':        'TVSeries',
      'name':          d.title,
      'alternateName': [d.romanizedTitle, d.originalTitle].filter(Boolean),
      'description':   d.overview || '',
      'image':         seoImg,
      'startDate':     d.year || '',
      'genre':         d.genres || [],
      'url':           seoUrl,
      'inLanguage':    'es',
      'aggregateRating': bestRating ? {
        '@type':       'AggregateRating',
        'ratingValue':  bestRating.score.split(' ')[0],
        'bestRating':  '10',
        'ratingCount':  bestRating.votes ? bestRating.votes.replace(/[^0-9]/g,'') : undefined
      } : undefined
    };
    var jsonStr = JSON.stringify(jsonLd, function(k,v){ return v === undefined ? undefined : v; }, 2);
    var existing = document.getElementById('lws-jsonld');
    if (!existing) {
      existing = document.createElement('script');
      existing.type = 'application/ld+json';
      existing.id   = 'lws-jsonld';
      document.head.appendChild(existing);
    }
    existing.textContent = jsonStr;
  }

  /* ════════════════════════════
     INTERACTIVIDAD (globales)
  ════════════════════════════ */
  window.lwsExpandSyn = function() {
    var el = document.getElementById('lws-synopsis');
    el.style['-webkit-line-clamp'] = 'unset';
    el.style.display = 'block';
    document.getElementById('lws-syn-btn').style.display = 'none';
  };

  /* ── Buscador de episodios ── */
  window.lwsFilterEpisodes = function() {
    var query = document.getElementById('lws-ep-search').value;
    var eps   = episodesCache[activeSeason] || [];
    renderEpisodes(eps, activeSeason, query);
  };

  /* ── Orden ASC / DESC ── */
  window.lwsToggleSort = function(btn) {
    sortDesc = !sortDesc;
    btn.classList.toggle('desc', sortDesc);
    document.getElementById('lws-sort-label').textContent = sortDesc ? 'N-1' : '1-N';
    var query = document.getElementById('lws-ep-search').value;
    var eps   = episodesCache[activeSeason] || [];
    renderEpisodes(eps, activeSeason, query);
  };

  window.lwsOpenTrailer = function(id, title) {
    trailerYtId = id;
    document.getElementById('lws-modal-iframe').src = 'https://www.youtube.com/embed/' + id + '?autoplay=1';
    document.getElementById('lws-modal').classList.add('lws-active');
    document.body.style.overflow = 'hidden';
  };
  window.lwsCloseTrailer = function() {
    document.getElementById('lws-modal').classList.remove('lws-active');
    document.getElementById('lws-modal-iframe').src = '';
    document.body.style.overflow = '';
  };
  window.lwsCloseTrailerOutside = function(e) {
    if (e.target === document.getElementById('lws-modal')) window.lwsCloseTrailer();
  };

  window.lwsShare = function(net) {
    var url   = encodeURIComponent(window.location.href);
    var title = encodeURIComponent(document.title);
    var links = {
      twitter:  'https://twitter.com/intent/tweet?text=' + title + '&url=' + url,
      facebook: 'https://www.facebook.com/sharer/sharer.php?u=' + url,
    };
    if (links[net]) window.open(links[net], '_blank', 'width=600,height=400');
    lwsToast('OK', 'Compartiendo en ' + net + '…');
  };
  window.lwsCopyLink = function() {
    try { navigator.clipboard.writeText(window.location.href); } catch(e){}
    lwsToast('OK', 'Enlace copiado');
  };

  /* ── Toast ── */
  function lwsToast(icon, msg) {
    clearTimeout(toastTimer);
    document.getElementById('lws-toast-icon').textContent = icon;
    document.getElementById('lws-toast-msg').textContent  = msg;
    document.getElementById('lws-toast').classList.add('lws-show');
    toastTimer = setTimeout(function(){ document.getElementById('lws-toast').classList.remove('lws-show'); }, 2800);
  }

  /* ── Error ── */
  function showError(msg) {
    var widget = document.getElementById('lws-widget');
    widget.style.display = 'block';
    widget.innerHTML = '<div class="lws-error">⚠️ ' + msg + '</div>';
  }

  /* ── Helpers ── */
  function hideLoading() {
    var el = document.getElementById('lws-loading');
    if (el) el.style.display = 'none';
  }
  function fmtVotes(n) {
    n = parseInt(String(n).replace(/,/g,''));
    if (isNaN(n) || n===0) return '';
    if (n >= 1000000) return (n/1000000).toFixed(1) + 'M';
    if (n >= 1000)    return Math.round(n/1000) + 'k';
    return String(n);
  }
  function escHtml(str) {
    return String(str)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  /* Keyboard */
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') window.lwsCloseTrailer();
  });

  /* Arranca */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();

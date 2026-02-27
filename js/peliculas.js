(function() {
  'use strict';

  /* ── Claves API ── */
  var TMDB_KEY  = '0606cd80dcd2a4e953505725aa5ea13d';
  var OMDB_KEY  = '635bf77e';
  /* TMDB_IMG se usa inline en buildDataFromTMDB y buildDataFromJikan */

  /* ── Estado ── */
  var activeServer = 0;
  var trailerYtId  = '';
  var toastTimer   = null;

  /* ════════════════════════════
     EXTRAE ID NUMÉRICO
  ════════════════════════════ */
  function extractId(input) {
    if (!input) return null;
    var str = String(input).trim();
    // Si ya es número puro
    if (/^\d+$/.test(str)) return parseInt(str);
    // Si es URL: busca /movie/NNNN o /tv/NNNN
    var m = str.match(/\/(movie|tv)\/(\d+)/);
    if (m) return parseInt(m[2]);
    return null;
  }

  /* ════════════════════════════
     FETCH HELPER — JSONP para evitar CORS en Blogger
  ════════════════════════════ */
  var cbIdx = 0;
  function fetchJSON(url) {
    return new Promise(function(resolve, reject) {
      var cbName = '__lwcb' + (cbIdx++);
      var script = document.createElement('script');
      var done = false;
      var timer = setTimeout(function() {
        if (!done) { done = true; cleanup(); reject(new Error('Timeout: ' + url)); }
      }, 12000);
      window[cbName] = function(data) {
        if (!done) { done = true; cleanup(); resolve(data); }
      };
      script.src = url + (url.indexOf('?') >= 0 ? '&' : '?') + 'callback=' + cbName;
      script.onerror = function() {
        if (!done) { done = true; cleanup(); reject(new Error('Script error: ' + url)); }
      };
      function cleanup() {
        clearTimeout(timer);
        delete window[cbName];
        if (script.parentNode) script.parentNode.removeChild(script);
      }
      document.head.appendChild(script);
    });
  }

  /* TMDB no soporta JSONP nativo — usamos fetch con no-cors no sirve para leer data
     Así que usamos la API de TMDB que sí tiene CORS habilitado para requests fetch normales */
  function apiFetch(url) {
    return fetch(url).then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  /* ════════════════════════════
     INIT — detecta fuente automáticamente
  ════════════════════════════ */
  function init() {
    var malId  = parseInt(LW_MAL_ID) || 0;
    var tmdbId = extractId(LW_MOVIE) || 0;

    if (!malId && !tmdbId) {
      showError('Define LW_MAL_ID (anime) o LW_MOVIE (película) en la configuración.');
      hideLoading();
      return;
    }
    /* Anime: Jikan primero, TMDB como complemento opcional */
    if (malId) {
      loadFromJikan(malId, tmdbId);
    } else {
      loadFromTMDB(tmdbId);
    }
  }

  /* ──────────────────────────────
     JIKAN (MyAnimeList) → anime
  ────────────────────────────── */
  function loadFromJikan(malId, tmdbId) {
    var base = 'https://api.jikan.moe/v4/anime/' + malId;
    Promise.all([
      apiFetch(base),
      apiFetch(base + '/videos'),
    ]).then(function(res) {
      var jikan     = res[0].data || {};
      var jikanVids = res[1].data || {};

      /* Complemento TMDB para backdrop si se proporcionó */
      var tmdbExtra = tmdbId
        ? apiFetch('https://api.themoviedb.org/3/movie/' + tmdbId + '?api_key=' + TMDB_KEY + '&language=es-MX')
            .catch(function() { return null; })
        : Promise.resolve(null);

      tmdbExtra.then(function(tmdb) {
        /* OMDB para ratings extra si hay imdb_id */
        var imdbId = jikan.external
          ? (jikan.external.find(function(e){ return e.name === 'MyAnimeList'; }) || {}).url
          : null;
        /* Jikan devuelve mal_id, buscamos imdb en relations — lo dejamos en null y usamos score de MAL */
        var data = buildDataFromJikan(jikan, jikanVids, tmdb);
        renderWidget(data);
        hideLoading();
        document.getElementById('latino-widget').style.display = 'block';
      });

    }).catch(function(err) {
      console.error('Error Jikan/MAL:', err);
      /* Jikan tiene rate-limit (3 req/seg) — reintentamos una vez tras 1s */
      if (!loadFromJikan._retried) {
        loadFromJikan._retried = true;
        setTimeout(function() { loadFromJikan(malId, tmdbId); }, 1200);
      } else {
        showError('No se pudo conectar con MyAnimeList (Jikan). Verifica el LW_MAL_ID: ' + malId);
        hideLoading();
      }
    });
  }

  /* ──────────────────────────────
     TMDB → películas / series
  ────────────────────────────── */
  function loadFromTMDB(id) {
    var base = 'https://api.themoviedb.org/3/movie/' + id;
    var lang = '?api_key=' + TMDB_KEY + '&language=es-MX';

    Promise.all([
      apiFetch(base + lang),
      apiFetch(base + '/credits' + lang),
      apiFetch(base + '/videos' + lang),
      apiFetch(base + '/videos?api_key=' + TMDB_KEY + '&language=en-US'),
      apiFetch(base + '/release_dates?api_key=' + TMDB_KEY),
    ]).then(function(results) {
      var tmdb         = results[0];
      var credits      = results[1];
      var videosEs     = results[2];
      var videosEn     = results[3];
      var releaseDates = results[4];

      var imdbId = tmdb.imdb_id;
      var omdbP  = imdbId
        ? apiFetch('https://www.omdbapi.com/?i=' + imdbId + '&apikey=' + OMDB_KEY + '&tomatoes=true')
        : Promise.resolve(null);

      omdbP.then(function(omdb) {
        var data = buildDataFromTMDB(tmdb, credits, videosEs, videosEn, releaseDates, omdb);
        renderWidget(data);
        hideLoading();
        document.getElementById('latino-widget').style.display = 'block';
      }).catch(function() {
        var data = buildDataFromTMDB(tmdb, credits, videosEs, videosEn, releaseDates, null);
        renderWidget(data);
        hideLoading();
        document.getElementById('latino-widget').style.display = 'block';
      });

    }).catch(function(err) {
      console.error('Error TMDB:', err);
      showError('No se pudo conectar con TMDB. ID: ' + id);
      hideLoading();
    });
  }

  /* ════════════════════════════════════════════════
     BUILD DATA — helper compartido para ratings OMDB
  ════════════════════════════════════════════════ */
  function buildRatingsFromOMDB(omdb) {
    var ratings = [];
    if (!omdb) return ratings;
    if (omdb.imdbRating && omdb.imdbRating !== 'N/A') {
      ratings.push({
        source: 'IMDb', type: 'imdb',
        score:  omdb.imdbRating + ' / 10',
        votes:  omdb.imdbVotes || '',
        pct:    (parseFloat(omdb.imdbRating) / 10) * 100,
        color:  '#f5c518'
      });
    }
    if (omdb.Ratings) {
      var rt = omdb.Ratings.find(function(r){ return r.Source === 'Rotten Tomatoes'; });
      if (rt) {
        var p = parseInt(rt.Value);
        ratings.push({ source: 'Rotten Tomatoes', icon: p >= 60 ? 'RT' : 'RT',
          score: rt.Value, votes: '', pct: p,
          color: p >= 60 ? '#fa4032' : '#aaa', rtFresh: p >= 60 });
      }
      var mc = omdb.Ratings.find(function(r){ return r.Source === 'Metacritic'; });
      if (mc) {
        var pm = parseInt(mc.Value);
        ratings.push({ source: 'Metacritic', icon: 'MC',
          score: mc.Value + ' / 100', votes: '', pct: pm,
          color: pm >= 61 ? '#6ab04c' : pm >= 40 ? '#f9ca24' : '#eb4d4b' });
      }
    }
    return ratings;
  }

  /* ─────────────────────────────────────────────
     BUILD DATA — Jikan / MyAnimeList
  ───────────────────────────────────────────── */
  function buildDataFromJikan(jikan, jikanVids, tmdbExtra) {
    /*
      Jikan devuelve:
        jikan.title            → título romanizado  (Kimi no Na wa.)
        jikan.title_japanese   → título original    (君の名は。)
        jikan.title_english    → título en inglés   (Your Name.)
        jikan.titles[]         → array con todos los títulos alternativos
    */
    var titleEs       = '';
    var titleRomanized = jikan.title         || '';
    var titleOriginal  = jikan.title_japanese || '';
    var titleEnglish   = jikan.title_english  || '';

    /* Buscar título en español entre los títulos alternativos */
    if (jikan.titles && jikan.titles.length) {
      var esTitle = jikan.titles.find(function(t) {
        return t.type === 'Spanish' || (t.title && /[áéíóúñ¿¡]/i.test(t.title));
      });
      if (esTitle) titleEs = esTitle.title;
    }
    /* Si no hay título español, usar el inglés como título principal */
    var mainTitle = titleEs || titleEnglish || titleRomanized;

    /* Tráiler — Jikan devuelve videos de YouTube */
    var trailer = null;
    if (LW_TRAILER_YT) {
      trailer = { key: LW_TRAILER_YT, name: 'Tráiler oficial' };
    } else if (jikanVids && jikanVids.promo && jikanVids.promo.length) {
      var promo = jikanVids.promo[0];
      if (promo.trailer && promo.trailer.youtube_id) {
        trailer = { key: promo.trailer.youtube_id, name: promo.title || 'Tráiler oficial' };
      }
    } else if (jikanVids && jikanVids.episodes && jikanVids.episodes.length) {
      var ep = jikanVids.episodes[0];
      if (ep.youtube_id) trailer = { key: ep.youtube_id, name: 'Vista previa' };
    }

    /* Imagen — Jikan trae varios tamaños */
    var images   = jikan.images || {};
    var jpgImgs  = images.jpg   || {};
    var poster   = jpgImgs.large_image_url || jpgImgs.image_url || '';
    /* Backdrop: si hay TMDB extra úsalo, sino el mismo poster */
    var backdrop = (tmdbExtra && tmdbExtra.backdrop_path)
      ? ('https://image.tmdb.org/t/p/original' + tmdbExtra.backdrop_path)
      : poster;

    /* Géneros — Jikan devuelve en inglés; añadir traducción al español */
    var genreMap = {
      'Action': 'Acción', 'Adventure': 'Aventura', 'Comedy': 'Comedia',
      'Drama': 'Drama', 'Fantasy': 'Fantasía', 'Horror': 'Terror',
      'Mystery': 'Misterio', 'Romance': 'Romance', 'Sci-Fi': 'Ciencia ficción',
      'Slice of Life': 'Vida cotidiana', 'Sports': 'Deportes',
      'Supernatural': 'Sobrenatural', 'Thriller': 'Suspenso',
      'Music': 'Música', 'Psychological': 'Psicológico',
      'Mecha': 'Mecha', 'Isekai': 'Isekai', 'Historical': 'Histórico',
      'Military': 'Militar', 'School': 'Escolar', 'Magic': 'Magia',
      'Ecchi': 'Ecchi', 'Harem': 'Harem', 'Demons': 'Demonios',
      'Samurai': 'Samurai', 'Space': 'Espacial', 'Vampire': 'Vampiros',
      'Martial Arts': 'Artes marciales', 'Game': 'Juego', 'Kids': 'Infantil',
    };
    var genres = (jikan.genres || []).concat(jikan.themes || []).map(function(g) {
      return genreMap[g.name] || g.name;
    });

    /* Ratings — TMDB primero (si hay tmdbExtra), luego MAL */
    var ratings = [];
    if (tmdbExtra && tmdbExtra.vote_average && tmdbExtra.vote_average > 0) {
      ratings.push({
        source: 'TMDB', icon: 'TMDB',
        score:  tmdbExtra.vote_average.toFixed(1) + ' / 10',
        votes:  tmdbExtra.vote_count ? fmtVotes(tmdbExtra.vote_count) : '',
        pct:    (tmdbExtra.vote_average / 10) * 100,
        color:  '#01d277'
      });
    }
    if (jikan.score && jikan.score > 0) {
      ratings.push({
        source: 'MyAnimeList', icon: 'MAL',
        score:  jikan.score.toFixed(2) + ' / 10',
        votes:  jikan.scored_by ? fmtVotes(jikan.scored_by) : '',
        pct:    (jikan.score / 10) * 100,
        color:  '#2e51a2'
      });
    }

    /* Runtime */
    var rawDuration = jikan.duration || '';
    var runtimeStr  = rawDuration.replace(/ per ep\.?/i, '').trim() || 'N/D';

    /* Fecha */
    var releaseFormatted = 'N/D';
    var aired = jikan.aired || {};
    if (aired.from) {
      try {
        releaseFormatted = new Date(aired.from).toLocaleDateString('es-MX', {
          day: 'numeric', month: 'long', year: 'numeric'
        });
      } catch(e) { releaseFormatted = aired.from; }
    }

    /* Año */
    var year = jikan.year ? String(jikan.year) : (aired.from ? aired.from.slice(0,4) : '');

    /* Director / estudio */
    var studios = (jikan.studios || []).map(function(s){ return s.name; }).join(', ') || 'N/D';
    var directors = '';
    if (jikan.staff) {
      var dir = jikan.staff.find(function(p){ return p.positions && p.positions.indexOf('Director') >= 0; });
      if (dir) directors = dir.person.name;
    }
    if (!directors) directors = studios; /* Para anime el estudio es el autor relevante */

    return {
      title:          mainTitle,
      romanizedTitle: (titleRomanized !== mainTitle) ? titleRomanized : '',
      originalTitle:  titleOriginal,
      year:           year,
      overview:       jikan.synopsis || 'Sin sinopsis disponible.',
      genres:         genres,
      poster:         poster,
      backdrop:       backdrop,
      runtime:        runtimeStr,
      ageRating:      jikan.rating || '',
      country:        'Japón',
      language:       'JA',
      studio:         studios,
      director:       directors,
      ratings:        ratings,
      trailer:        trailer,
      imdbId:         '',
      releaseDate:    releaseFormatted,
      budget:         0,
      revenue:        0,
      malId:          jikan.mal_id || 0,
      episodes:       jikan.episodes || null,
      status:         jikan.status || '',
    };
  }

  /* ─────────────────────────────────────────────
     BUILD DATA — TMDB (películas / series)
  ───────────────────────────────────────────── */
  function buildDataFromTMDB(tmdb, credits, videosEs, videosEn, releaseDates, omdb) {
    /* Director */
    var director = 'N/D';
    if (credits && credits.crew) {
      var d = credits.crew.find(function(p){ return p.job === 'Director'; });
      if (d) director = d.name;
    }

    /* Tráiler */
    var trailer = null;
    if (LW_TRAILER_YT) {
      trailer = { key: LW_TRAILER_YT, name: 'Tráiler oficial' };
    } else {
      var allVids = [].concat(
        (videosEs && videosEs.results) || [],
        (videosEn && videosEn.results) || []
      );
      trailer = allVids.find(function(v){ return v.type==='Trailer' && v.site==='YouTube'; })
             || allVids.find(function(v){ return v.type==='Teaser'  && v.site==='YouTube'; })
             || (allVids.length ? allVids[0] : null);
    }

    /* Clasificación por edad */
    var ageRating = '';
    if (releaseDates && releaseDates.results) {
      var rel = releaseDates.results.find(function(r){ return r.iso_3166_1==='MX'; })
             || releaseDates.results.find(function(r){ return r.iso_3166_1==='ES'; })
             || releaseDates.results.find(function(r){ return r.iso_3166_1==='US'; });
      if (rel && rel.release_dates && rel.release_dates[0]) {
        ageRating = rel.release_dates[0].certification || '';
      }
    }

    /* Ratings: TMDB + OMDB */
    var ratings = [];
    if (tmdb.vote_average && tmdb.vote_average > 0) {
      ratings.push({
        source: 'TMDB', icon: 'TMDB',
        score:  tmdb.vote_average.toFixed(1) + ' / 10',
        votes:  tmdb.vote_count ? fmtVotes(tmdb.vote_count) : '',
        pct:    (tmdb.vote_average / 10) * 100,
        color:  '#01d277'
      });
    }
    ratings = ratings.concat(buildRatingsFromOMDB(omdb));

    /* Runtime */
    var rt = tmdb.runtime || 0;
    var runtimeStr = rt ? (Math.floor(rt/60) + 'h ' + (rt%60) + 'min') : 'N/D';

    /* Fecha */
    var releaseFormatted = 'N/D';
    if (tmdb.release_date) {
      try {
        releaseFormatted = new Date(tmdb.release_date).toLocaleDateString('es-MX', {
          day:'numeric', month:'long', year:'numeric'
        });
      } catch(e) { releaseFormatted = tmdb.release_date; }
    }

    return {
      title:          tmdb.title || tmdb.name || 'Sin título',
      romanizedTitle: '',
      originalTitle:  tmdb.original_title || tmdb.original_name || '',
      year:           tmdb.release_date ? tmdb.release_date.slice(0,4) : '',
      overview:       tmdb.overview || 'Sin sinopsis disponible.',
      genres:         (tmdb.genres || []).map(function(g){ return g.name; }),
      poster:         tmdb.poster_path   ? ('https://image.tmdb.org/t/p/w500'     + tmdb.poster_path)   : '',
      backdrop:       tmdb.backdrop_path ? ('https://image.tmdb.org/t/p/original' + tmdb.backdrop_path) : '',
      runtime:        runtimeStr,
      ageRating:      ageRating,
      country:        (tmdb.production_countries || []).map(function(c){ return c.name; }).join(', ') || 'N/D',
      language:       tmdb.original_language ? tmdb.original_language.toUpperCase() : 'N/D',
      studio:         (tmdb.production_companies || []).slice(0,2).map(function(c){ return c.name; }).join(', ') || 'N/D',
      director:       director,
      ratings:        ratings,
      trailer:        trailer,
      imdbId:         tmdb.imdb_id || '',
      releaseDate:    releaseFormatted,
      budget:         tmdb.budget  || 0,
      revenue:        tmdb.revenue || 0,
      malId:          0,
      episodes:       null,
      status:         '',
    };
  }

  /* ════════════════════════════
     RENDER
  ════════════════════════════ */
  function renderWidget(d) {
    /* Hero backdrop */
    var bgEl = document.getElementById('lw-hero-bg');
    if (d.backdrop || d.poster) {
      bgEl.style.backgroundImage = "url('" + (d.backdrop || d.poster) + "')";
    }

    /* Player poster */
    if (d.poster) {
      document.getElementById('lw-player-poster').style.backgroundImage = "url('" + d.poster + "')";
    }

    /* HERO — título grande = romanizado (o título si no hay romanizado)
       Debajo en pequeño = original (japonés / idioma nativo) */
    var heroMain = d.romanizedTitle || d.title;
    document.getElementById('lw-title').innerHTML =
      escHtml(heroMain) +
      (d.year ? ' <span style="color:#666;font-weight:300;font-size:.55em;">(' + d.year + ')</span>' : '');

    /* Subtítulo hero: solo el título original nativo */
    var titlesHtml = '';
    if (d.originalTitle && d.originalTitle !== heroMain) {
      titlesHtml += '<p style="color:#888;font-size:.82rem;margin:0;">' +
        '<span style="color:#555;font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-right:6px;">Original</span>' +
        escHtml(d.originalTitle) + '</p>';
    }
    document.getElementById('lw-titles-extra').innerHTML = titlesHtml;

    /* SEO injection */
    injectSEO(d);

    /* Meta row */
    var metaParts = [];
    var tmdbR = d.ratings.find(function(r){ return r.source==='TMDB'; });
    if (tmdbR) metaParts.push('<span style="color:#01d277;font-weight:700;font-size:.9rem;">★ ' + tmdbR.score.split(' ')[0] + '</span>');
    var malR  = d.ratings.find(function(r){ return r.source==='MyAnimeList'; });
    if (malR)  metaParts.push(
      '<span style="width:1px;height:14px;background:#2a2a2a;display:inline-block;"></span>' +
      '<span style="background:#2e51a2;color:#fff;font-weight:800;font-size:.72rem;padding:2px 6px;border-radius:4px;">MAL</span>' +
      '<span style="font-weight:700;font-size:.88rem;">' + malR.score.split(' ')[0] +
        (malR.votes ? ' <span style="color:#666;font-weight:400;font-size:.78rem;">(' + malR.votes + ')</span>' : '') +
      '</span>'
    );
    var imdbR = d.ratings.find(function(r){ return r.source==='IMDb'; });
    if (imdbR) metaParts.push(
      '<span style="width:1px;height:14px;background:#2a2a2a;display:inline-block;"></span>' +
      '<span class="lw-badge-imdb">IMDb</span>' +
      '<span style="font-weight:700;font-size:.88rem;">' + imdbR.score.split(' ')[0] +
        (imdbR.votes ? ' <span style="color:#666;font-weight:400;font-size:.78rem;">(' + imdbR.votes + ')</span>' : '') +
      '</span>'
    );
    var rtR = d.ratings.find(function(r){ return r.source==='Rotten Tomatoes'; });
    if (rtR) metaParts.push(
      '<span style="width:1px;height:14px;background:#2a2a2a;display:inline-block;"></span>' +
      '<span style="font-size:.9rem;">' + (rtR.icon||'🍅') + '</span>' +
      '<span style="font-weight:700;font-size:.88rem;color:' + rtR.color + ';">' + rtR.score + '</span>'
    );
    if (d.ageRating) metaParts.push(
      '<span style="width:1px;height:14px;background:#2a2a2a;display:inline-block;"></span>' +
      '<span class="lw-badge-age">' + escHtml(d.ageRating) + '</span>'
    );
    if (d.runtime !== 'N/D') metaParts.push(
      '<span style="width:1px;height:14px;background:#2a2a2a;display:inline-block;"></span>' +
      '<span style="color:#8a8a8a;font-size:.85rem;">⏱ ' + escHtml(d.runtime) + '</span>'
    );
    document.getElementById('lw-meta-row').innerHTML = metaParts.join('');

    /* Géneros hero — con enlace a etiqueta de Blogger */
    var blogBase = (LW_BLOG_URL || window.location.origin).replace(/\/+$/, '');
    document.getElementById('lw-genres-row').innerHTML = d.genres.map(function(g) {
      var href = blogBase + '/search/label/' + encodeURIComponent(g);
      return '<a href="' + href + '" class="lw-genre-pill" rel="tag">' + escHtml(g) + '</a>';
    }).join('');

    /* Poster info panel */
    var posterEl = document.getElementById('lw-poster');
    if (d.poster) posterEl.src = d.poster;

    /* Panel — título principal = romanizado (o título si no hay) */
    var panelMain = d.romanizedTitle || d.title;
    document.getElementById('lw-panel-title').textContent = panelMain;

    /* Los 3 títulos en el panel: 1-Romanizado  2-Español  3-Original */
    var panelSubHtml = '';

    /* 1. Romanizado — ya está arriba como título principal, mostramos label */
    panelSubHtml += '<div style="font-size:.7rem;color:#666;margin-bottom:3px;">' +
      '<span style="color:#444;font-weight:700;text-transform:uppercase;font-size:.6rem;letter-spacing:.1em;margin-right:4px;">ROM</span>' +
      escHtml(panelMain) + '</div>';

    /* 2. Español — d.title (viene de TMDB es-MX o title_english de Jikan) */
    if (d.title && d.title !== panelMain) {
      panelSubHtml += '<div style="font-size:.7rem;color:#666;margin-bottom:3px;">' +
        '<span style="color:#444;font-weight:700;text-transform:uppercase;font-size:.6rem;letter-spacing:.1em;margin-right:4px;">ES</span>' +
        escHtml(d.title) + '</div>';
    }

    /* 3. Original (japonés / idioma nativo) */
    if (d.originalTitle && d.originalTitle !== panelMain && d.originalTitle !== d.title) {
      panelSubHtml += '<div style="font-size:.7rem;color:#555;">' +
        '<span style="color:#444;font-weight:700;text-transform:uppercase;font-size:.6rem;letter-spacing:.1em;margin-right:4px;">ORI</span>' +
        escHtml(d.originalTitle) + '</div>';
    }

    document.getElementById('lw-panel-original').innerHTML = panelSubHtml;
    var blogBase2 = (LW_BLOG_URL || window.location.origin).replace(/\/+$/, '');
    document.getElementById('lw-panel-genres').innerHTML = d.genres.slice(0,4).map(function(g){
      var href = blogBase2 + '/search/label/' + encodeURIComponent(g);
      return '<a href="' + href + '" class="lw-genre-chip-link" rel="tag">' + escHtml(g) + '</a>';
    }).join('');

    /* Director */
    document.getElementById('lw-director').textContent = d.director;

    /* Ratings */
    renderRatings(d.ratings);

    /* Ficha */
    renderFicha(d);

    /* Sinopsis */
    var synEl = document.getElementById('lw-synopsis');
    synEl.textContent = d.overview;
    if (d.overview.length > 220) {
      document.getElementById('lw-syn-btn').style.display = 'inline';
    }

    /* Tráiler — columna izquierda (grande) + panel derecho (miniatura) */
    if (d.trailer && d.trailer.key) {
      trailerYtId = d.trailer.key;
      var trailerThumbUrl = 'https://img.youtube.com/vi/' + trailerYtId + '/hqdefault.jpg';
      var trailerName     = d.trailer.name || 'Trailer oficial';

      /* Izquierda */
      var ts = document.getElementById('lw-trailer-section');
      ts.style.display = 'block';
      document.getElementById('lw-trailer-img').src = trailerThumbUrl;
      document.getElementById('lw-trailer-label').textContent = trailerName;
      var thumb = document.getElementById('lw-trailer-thumb');
      thumb.onclick = function(){ lwOpenTrailer(trailerYtId, d.title); };

      /* Panel derecho */
      document.getElementById('lw-trailer-panel-section').style.display = 'block';
      document.getElementById('lw-trailer-panel-img').src   = trailerThumbUrl;
      document.getElementById('lw-trailer-panel-label').textContent = trailerName;
      document.getElementById('lw-modal-label').textContent = d.title + ' — ' + trailerName;
    }

    /* Servidores */
    renderServers();

    /* Animar barras después de render */
    setTimeout(function() {
      document.querySelectorAll('.lw-rbar-fill[data-pct]').forEach(function(b) {
        b.style.width = Math.min(parseFloat(b.getAttribute('data-pct')), 100) + '%';
      });
    }, 350);
  }

  function renderRatings(ratings) {
    var el = document.getElementById('lw-ratings');
    if (!ratings.length) {
      el.innerHTML = '<p style="color:#555;font-size:.8rem;">Sin calificaciones disponibles.</p>';
      return;
    }
    el.innerHTML = ratings.map(function(r) {
      var badge = '';
      if (r.type === 'imdb') {
        badge = '<span class="lw-badge-imdb">IMDb</span>';
      } else if (r.icon === 'MC') {
        badge = '<span style="background:' + r.color + ';color:#fff;font-weight:800;font-size:.7rem;padding:2px 6px;border-radius:4px;">MC</span>';
      } else if (r.icon === 'MAL') {
        badge = '<span style="background:#2e51a2;color:#fff;font-weight:800;font-size:.7rem;padding:2px 6px;border-radius:4px;">MAL</span>';
      } else if (r.icon === 'TMDB') {
        badge = '<span style="background:#01d277;color:#000;font-weight:800;font-size:.7rem;padding:2px 6px;border-radius:4px;">TMDB</span>';
      } else if (r.icon === 'RT') {
        badge = '<span style="font-size:.88rem;">' + (r.rtFresh ? 'RT+' : 'RT') + '</span>';
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
        '<div class="lw-rbar-bg">' +
          '<div class="lw-rbar-fill" data-pct="' + r.pct + '" style="width:0;background:' + r.color + ';"></div>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function renderFicha(d) {
    var rows = [
      ['Año',        d.year       || 'N/D'],
      ['Duración',   d.runtime],
      ['País',       d.country],
      ['Idioma',     d.language],
      ['Estudio',    d.studio],
      ['Estreno',    d.releaseDate],
    ];
    if (d.romanizedTitle && d.romanizedTitle !== d.title) {
      rows.splice(0, 0, ['Romanizado', d.romanizedTitle]);
    }
    if (d.originalTitle && d.originalTitle !== d.title) {
      rows.splice(0, 0, ['Original', d.originalTitle]);
    }
    if (d.ageRating) rows.push(['Clasificación', d.ageRating]);
    if (d.episodes)  rows.push(['Episodios',    d.episodes]);
    if (d.status)    rows.push(['Estado',        d.status]);
    if (d.budget  > 0) rows.push(['Presupuesto', '$' + (d.budget/1e6).toFixed(0) + 'M USD']);
    if (d.revenue > 0) rows.push(['Recaudación', '$' + (d.revenue/1e6).toFixed(0) + 'M USD']);
    if (d.malId)  rows.push(['MAL', '<a href="https://myanimelist.net/anime/' + d.malId + '" target="_blank" rel="noopener" style="color:#2e51a2;text-decoration:none;">Ver en MyAnimeList</a>']);
    if (d.imdbId) rows.push(['IMDb', '<a href="https://www.imdb.com/title/' + d.imdbId + '" target="_blank" rel="noopener" style="color:#f5c518;text-decoration:none;">' + d.imdbId + '</a>']);

    document.getElementById('lw-ficha').innerHTML = rows.map(function(r){
      return '<div style="display:flex;justify-content:space-between;gap:8px;">' +
        '<span style="color:#666;">' + r[0] + '</span>' +
        '<span style="color:#e0e0e0;font-weight:500;text-align:right;">' + r[1] + '</span>' +
      '</div>';
    }).join('');
  }

  /* ── Idioma activo (primer enabled) ── */
  var activeLangKey = (function() {
    var first = LW_LANGS.find(function(l){ return l.enabled; });
    return first ? first.key : '';
  })();

  /* ── Rellena el <select> de idiomas con solo los enabled ── */
  function buildLangSelector() {
    var sel = document.getElementById('lw-lang-select');
    sel.innerHTML = '';
    LW_LANGS.forEach(function(l) {
      if (!l.enabled) return;
      var opt = document.createElement('option');
      opt.value = l.key;
      opt.textContent = l.flag + ' ' + l.label;
      if (l.key === activeLangKey) opt.selected = true;
      sel.appendChild(opt);
    });
    /* Actualiza la bandera inicial */
    var cur = LW_LANGS.find(function(l){ return l.key === activeLangKey; });
    if (cur) document.getElementById('lw-lang-flag').textContent = cur.flag;
  }

  /* ── Devuelve los servidores del idioma activo ── */
  function getActiveLangServers() {
    var lang = LW_LANGS.find(function(l){ return l.key === activeLangKey; });
    return (lang && lang.servers) ? lang.servers : [];
  }

  function renderServers() {
    buildLangSelector();
    var servers = getActiveLangServers();
    var cont = document.getElementById('lw-server-tabs');
    if (!servers.length) {
      cont.innerHTML = '<span style="color:#555;font-size:.8rem;padding:4px 0;">Sin servidores para este idioma.</span>';
      return;
    }
    cont.innerHTML = servers.map(function(s, i) {
      return '<button class="lw-server-tab ' + (i===0?'active':'') + '" onclick="lwSwitchServer(this,' + i + ')">' + escHtml(s.name) + '</button>';
    }).join('');
    activeServer = 0;
  }

  /* ════════════════════════════
     INTERACTIVIDAD (globales)
  ════════════════════════════ */
  window.lwSwitchServer = function(el, idx) {
    activeServer = idx;
    document.querySelectorAll('.lw-server-tab').forEach(function(t){ t.classList.remove('active'); });
    el.classList.add('active');
    /* Reset player */
    var existing = document.getElementById('lw-active-player');
    if (existing) existing.remove();
    var overlay = document.getElementById('lw-play-overlay');
    var poster  = document.getElementById('lw-player-poster');
    overlay.style.display = 'flex'; poster.style.display = 'block';
    document.getElementById('lw-play-label').textContent = 'Reproducir - ' + el.textContent;
    lwToast('OK', 'Servidor: ' + el.textContent);
  };

  window.lwStartPlayer = function() {
    var servers = getActiveLangServers();
    var server  = servers[activeServer] || { name: '?', url: '' };
    var overlay = document.getElementById('lw-play-overlay');
    var poster  = document.getElementById('lw-player-poster');
    var pw      = document.getElementById('lw-player-wrap');
    overlay.style.display = 'none';
    poster.style.display  = 'none';
    var div = document.createElement('div');
    div.id = 'lw-active-player';
    div.style.cssText = 'position:absolute;inset:0;';
    if (server.url) {
      var iframe = document.createElement('iframe');
      iframe.src = server.url;
      iframe.style.cssText = 'width:100%;height:100%;border:none;';
      iframe.allowFullscreen = true;
      div.appendChild(iframe);
    } else {
      div.style.cssText += 'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;background:#0d0d0d;';
      var langLabel = (LW_LANGS.find(function(l){ return l.key===activeLangKey; }) || {}).label || activeLangKey;
      div.innerHTML =
        '<svg style="width:42px;height:42px;color:#f5c518;" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>' +
        '<p style="color:#666;font-size:.82rem;font-family:Outfit,sans-serif;text-align:center;padding:0 20px;">' +
          'Servidor: <strong style="color:#e0e0e0;">' + escHtml(server.name) + '</strong> ' +
          '- Idioma: <strong style="color:#00b4ff;">' + escHtml(langLabel) + '</strong><br>' +
          '<span style="color:#444;font-size:.72rem;">Agrega la URL del embed en LW_LANGS</span>' +
        '</p>';
    }
    pw.appendChild(div);
  };

  window.lwChangeLang = function(sel) {
    activeLangKey = sel.value;
    var lang = LW_LANGS.find(function(l){ return l.key === activeLangKey; });
    document.getElementById('lw-lang-flag').textContent = lang ? lang.flag : '🌐';
    /* Resetear player */
    var existing = document.getElementById('lw-active-player');
    if (existing) existing.remove();
    var overlay = document.getElementById('lw-play-overlay');
    var poster  = document.getElementById('lw-player-poster');
    overlay.style.display = 'flex'; poster.style.display = 'block';
    /* Rebuild server tabs para el nuevo idioma */
    var servers = getActiveLangServers();
    var cont = document.getElementById('lw-server-tabs');
    if (!servers.length) {
      cont.innerHTML = '<span style="color:#555;font-size:.8rem;padding:4px 0;">Sin servidores para este idioma.</span>';
      activeServer = 0;
      document.getElementById('lw-play-label').textContent = 'Reproducir';
    } else {
      cont.innerHTML = servers.map(function(s, i) {
        return '<button class="lw-server-tab ' + (i===0?'active':'') + '" onclick="lwSwitchServer(this,' + i + ')">' + escHtml(s.name) + '</button>';
      }).join('');
      activeServer = 0;
      document.getElementById('lw-play-label').textContent = 'Reproducir - ' + servers[0].name;
    }
    lwToast('OK', (lang ? lang.flag + ' ' : '') + (lang ? lang.label : sel.value));
  };

  window.lwOpenTrailer = function(id, title) {
    trailerYtId = id;
    document.getElementById('lw-modal-iframe').src = 'https://www.youtube.com/embed/' + id + '?autoplay=1';
    document.getElementById('lw-modal').classList.add('lw-active');
    document.body.style.overflow = 'hidden';
  };
  window.lwCloseTrailer = function() {
    document.getElementById('lw-modal').classList.remove('lw-active');
    document.getElementById('lw-modal-iframe').src = '';
    document.body.style.overflow = '';
  };
  window.lwCloseTrailerOutside = function(e) {
    if (e.target === document.getElementById('lw-modal')) window.lwCloseTrailer();
  };

  window.lwExpandSyn = function() {
    var el = document.getElementById('lw-synopsis');
    el.style['-webkit-line-clamp'] = 'unset';
    el.style.display = 'block';
    document.getElementById('lw-syn-btn').style.display = 'none';
  };

  window.lwShare = function(net) { lwToast('OK', 'Compartiendo en ' + net + '...'); };
  window.lwCopyLink = function() {
    try { navigator.clipboard.writeText(window.location.href); } catch(e){}
    lwToast('OK', 'Enlace copiado');
  };

  /* ── Toast ── */
  function lwToast(icon, msg) {
    clearTimeout(toastTimer);
    document.getElementById('lw-toast-icon').textContent = icon;
    document.getElementById('lw-toast-msg').textContent  = msg;
    document.getElementById('lw-toast').classList.add('lw-show');
    toastTimer = setTimeout(function(){ document.getElementById('lw-toast').classList.remove('lw-show'); }, 2800);
  }

  /* ── Error ── */
  function showError(msg) {
    var widget = document.getElementById('latino-widget');
    widget.style.display = 'block';
    widget.innerHTML = '<div class="lw-error">⚠️ ' + msg + '</div>';
  }

  /* ── Helpers ── */
  function hideLoading() {
    var el = document.getElementById('lw-loading');
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


  /* ════════════════════════════
     SEO — Meta tags, OG, Twitter, JSON-LD
  ════════════════════════════ */
  function injectSEO(d) {
    /* Construye el título SEO combinando los 3 títulos disponibles */
    var seoTitleParts = [d.title];
    if (d.romanizedTitle && d.romanizedTitle !== d.title) seoTitleParts.push(d.romanizedTitle);
    if (d.originalTitle && d.originalTitle !== d.title && d.originalTitle !== d.romanizedTitle) seoTitleParts.push(d.originalTitle);
    var seoTitle      = seoTitleParts.join(' / ') + (d.year ? ' (' + d.year + ')' : '') + ' - Ver Online Latino';
    var seoDesc       = (d.overview || '').slice(0, 160);
    var seoImg        = d.poster || d.backdrop || '';
    var seoUrl        = window.location.href;
    var seoKeywords   = [d.title, d.romanizedTitle, d.originalTitle]
                          .filter(Boolean)
                          .concat(d.genres || [])
                          .concat(['ver online', 'latino', 'subtitulado', d.year])
                          .filter(Boolean).join(', ');

    /* --- Actualiza el <title> de la página --- */
    try { document.title = seoTitle; } catch(e) {}

    /* --- Inyecta/actualiza meta tags en <head> --- */
    function setMeta(sel, attr, val) {
      var el = document.querySelector(sel);
      if (!el) { el = document.createElement('meta'); document.head.appendChild(el); }
      el.setAttribute(attr, val);
    }
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

    setMetaName('description',        seoDesc);
    setMetaName('keywords',           seoKeywords);
    setMetaName('robots',             'index, follow');
    setMetaName('author',             'Latino.to');

    /* Open Graph */
    setMetaProp('og:title',           seoTitle);
    setMetaProp('og:description',     seoDesc);
    setMetaProp('og:image',           seoImg);
    setMetaProp('og:url',             seoUrl);
    setMetaProp('og:type',            'video.movie');
    setMetaProp('og:site_name',       'Latino.to');
    setMetaProp('og:locale',          'es_MX');

    /* Twitter Card */
    setMetaName('twitter:card',       'summary_large_image');
    setMetaName('twitter:title',      seoTitle);
    setMetaName('twitter:description',seoDesc);
    setMetaName('twitter:image',      seoImg);

    /* Canonical */
    var canon = document.querySelector('link[rel="canonical"]');
    if (!canon) { canon = document.createElement('link'); canon.setAttribute('rel','canonical'); document.head.appendChild(canon); }
    canon.setAttribute('href', seoUrl);

    /* JSON-LD — Schema.org Movie */
    var jsonLd = {
      '@context':     'https://schema.org',
      '@type':        'Movie',
      'name':          d.title,
      'alternateName': [d.romanizedTitle, d.originalTitle].filter(Boolean),
      'description':   d.overview || '',
      'image':         seoImg,
      'datePublished': d.year || '',
      'director': d.director !== 'N/D' ? {
        '@type': 'Person',
        'name':   d.director
      } : undefined,
      'genre':         d.genres || [],
      'url':           seoUrl,
      'inLanguage':    'es',
      'aggregateRating': (function() {
        var imdbR = (d.ratings || []).find(function(r){ return r.source === 'IMDb'; });
        if (imdbR) {
          return {
            '@type':       'AggregateRating',
            'ratingValue':  imdbR.score.split(' ')[0],
            'bestRating':  '10',
            'ratingCount':  (imdbR.votes || '').replace(/[^0-9]/g,'') || undefined
          };
        }
        var tmdbR = (d.ratings || []).find(function(r){ return r.source === 'TMDB'; });
        if (tmdbR) {
          return {
            '@type':      'AggregateRating',
            'ratingValue': tmdbR.score.split(' ')[0],
            'bestRating': '10'
          };
        }
        return undefined;
      })()
    };
    /* Limpia undefined */
    var jsonStr = JSON.stringify(jsonLd, function(k, v){ return v === undefined ? undefined : v; }, 2);

    var existing = document.getElementById('lw-jsonld');
    if (!existing) {
      existing = document.createElement('script');
      existing.type = 'application/ld+json';
      existing.id   = 'lw-jsonld';
      document.head.appendChild(existing);
    }
    existing.textContent = jsonStr;
  }

  /* Keyboard */
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') window.lwCloseTrailer();
  });

  /* Arranca */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();

(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const data = window.SITE_DATA;
  if (!data) { $('loading').innerHTML = '<p>作品资料未载入，请重新打开页面。</p>'; return; }
  let world = null, fallback = false, toastTimer, music = null, musicBusy = false, galleryFilter = 'all';
  const platformName = item => item.platform === 'xhs' ? '小红书' : 'B 站';
  const saved = key => { try { return localStorage.getItem(key); } catch { return null; } };
  const save = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
  const theme = saved('xiaobai-3d-theme') || 'night'; document.documentElement.dataset.theme = theme;
  function notice(message) { clearTimeout(toastTimer); $('toast').textContent = message; $('toast').classList.add('show'); toastTimer = setTimeout(() => $('toast').classList.remove('show'), 3300); }
  function closeDialogs() { document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close()); }
  function openDialog(id) { closeDialogs(); const dialog = $(id); dialog.showModal(); if (world) world.controls.enabled = false; }
  document.querySelectorAll('dialog').forEach(dialog => {
    dialog.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => dialog.close()));
    dialog.addEventListener('click', event => { if (event.target !== dialog) return; const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); });
    dialog.addEventListener('close', () => { if (world && !document.querySelector('dialog[open]')) world.controls.enabled = true; });
  });
  function showDetail(item) {
    $('detail-image').src = item.image; $('detail-image').alt = item.title;
    $('detail-platform').textContent = `${platformName(item)} · ${item.platform === 'bili' ? '视频' : '作品'}`;
    $('detail-title').textContent = item.title; $('detail-category').textContent = item.category;
    $('detail-link').href = item.url;
    const metrics = item.platform === 'xhs' ? [`♡ ${item.likes} 点赞`] : [`▷ ${item.play} 播放`, `${item.danmu} 弹幕`, item.date];
    $('detail-meta').replaceChildren(...metrics.map(text => { const span = document.createElement('span'); span.textContent = text; return span; }));
    $('hover-card').hidden = true; openDialog('detail-dialog');
  }
  const locations = { home: '中央星球', featured: '精选岛', works: '小红书岛', videos: 'B 站岛', about: '关于小白', follow: '关注小白' };
  function portal(name) {
    closeDialogs(); document.body.classList.toggle('exploring', name !== 'home');
    $('location-name').textContent = locations[name] || '中央星球';
    document.querySelectorAll('[data-portal]').forEach(el => { el.classList.toggle('active', el.dataset.portal === name); if (el.closest('nav')) el.setAttribute('aria-current', el.dataset.portal === name ? 'location' : 'false'); });
    if (fallback) {
      if (name === 'about' || name === 'follow') openDialog(`${name}-dialog`);
      else { galleryFilter = name === 'works' ? 'xhs' : name === 'videos' ? 'bili' : 'all'; renderGallery(); $('gallery').scrollIntoView({ behavior: 'smooth' }); }
      return;
    }
    if (!world) return;
    world.flyTo(name, () => { if (name === 'about' || name === 'follow') openDialog(`${name}-dialog`); });
  }
  document.querySelectorAll('[data-portal]').forEach(button => button.addEventListener('click', event => { event.preventDefault(); portal(button.dataset.portal); }));
  function renderGallery() {
    document.querySelectorAll('[data-filter]').forEach(button => button.classList.toggle('active', button.dataset.filter === galleryFilter));
    $('gallery-grid').replaceChildren(...data.items.filter(item => galleryFilter === 'all' || item.platform === galleryFilter).map(item => {
      const card = document.createElement('button'); card.className = 'gallery-card';
      const img = document.createElement('img'); img.src = item.image; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
      const title = document.createElement('h3'); title.textContent = item.title;
      const meta = document.createElement('p'); meta.textContent = `${platformName(item)} · ${item.platform === 'xhs' ? `${item.likes} 点赞` : `${item.play} 播放`}`;
      card.append(img, title, meta); card.addEventListener('click', () => showDetail(item)); return card;
    }));
  }
  document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => { galleryFilter = button.dataset.filter; renderGallery(); }));
  $('gallery-open').addEventListener('click', () => { renderGallery(); openDialog('gallery-dialog'); });
  document.querySelector('.skip-link').addEventListener('click', event => { event.preventDefault(); renderGallery(); if (fallback) $('gallery').scrollIntoView(); else openDialog('gallery-dialog'); });
  function focusItem(item) {
    if (fallback || !world) { showDetail(item); return; }
    closeDialogs(); document.body.classList.add('exploring'); world.focusItem(item);
    $('location-name').textContent = item.platform === 'xhs' ? '小红书岛' : 'B 站岛';
    document.querySelectorAll('.portal-nav [data-portal]').forEach(button => button.classList.toggle('active', button.dataset.portal === (item.platform === 'xhs' ? 'works' : 'videos')));
    notice('已定位作品，点击亮起的画框或按回车查看。');
  }
  function renderSearch() {
    const q = $('search-input').value.trim().toLocaleLowerCase();
    const matches = q ? data.items.filter(item => `${item.title} ${item.category} ${platformName(item)}`.toLocaleLowerCase().includes(q)) : data.featuredIds.map(id => data.items.find(item => item.id === id));
    $('search-results').replaceChildren();
    const summary = document.createElement('p'); summary.className = 'search-summary'; summary.textContent = q ? `找到 ${matches.length} 件作品 · ${fallback ? '点击查看详情' : '点击传送到作品'}` : '从这几份喜欢开始逛'; $('search-results').append(summary);
    if (!matches.length) { const empty = document.createElement('p'); empty.className = 'empty-message'; empty.textContent = '还没找到，试试“开箱”“GBC”或“兔兔”。'; $('search-results').append(empty); }
    for (const item of matches) {
      const button = document.createElement('button'); button.className = 'search-result';
      const img = document.createElement('img'); img.src = item.image; img.alt = ''; img.loading = 'lazy';
      const copy = document.createElement('span'); const title = document.createElement('strong'); title.textContent = item.title; const meta = document.createElement('small'); meta.textContent = `${platformName(item)} · ${item.category}`; copy.append(title, meta);
      const arrow = document.createElement('span'); arrow.className = 'result-arrow'; arrow.textContent = '↗';
      button.append(img, copy, arrow); button.addEventListener('click', () => focusItem(item)); $('search-results').append(button);
    }
  }
  function openSearch(query = '') { $('search-input').value = query; renderSearch(); openDialog('search-dialog'); $('search-input').focus(); }
  $('search-open').addEventListener('click', () => openSearch()); $('search-input').addEventListener('input', renderSearch);
  $('search-input').addEventListener('keydown', e => { if (e.isComposing || e.keyCode === 229) return; if (e.key === 'ArrowDown') { $('search-results').querySelector('button')?.focus(); e.preventDefault(); } if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); $('search-results').querySelector('button')?.click(); } });
  addEventListener('keydown', e => { if (e.key === '/' && !document.querySelector('dialog[open]') && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) { e.preventDefault(); openSearch(); } });
  function updateTheme() { const day = document.documentElement.dataset.theme === 'day'; $('theme-name').textContent = day ? '日间泡泡园' : '夜间霓虹秀'; $('theme-toggle').setAttribute('aria-label', day ? '切换到夜晚' : '切换到白天'); $('theme-toggle').title = day ? '切换到夜晚' : '切换到白天'; $('theme-toggle').firstElementChild.textContent = day ? '☾' : '☼'; document.querySelector('meta[name=theme-color]').content = day ? '#f8deef' : '#130b2b'; }
  updateTheme();
  $('theme-toggle').addEventListener('click', () => { const next = document.documentElement.dataset.theme === 'day' ? 'night' : 'day'; document.documentElement.dataset.theme = next; save('xiaobai-3d-theme', next); world?.setTheme(next); updateTheme(); });
  function updateMusic(playing) { $('music-toggle').setAttribute('aria-pressed', String(playing)); $('music-toggle').setAttribute('aria-label', playing ? '关闭音乐' : '开启音乐'); $('music-toggle').title = playing ? '关闭音乐' : '开启音乐'; }
  $('music-toggle').addEventListener('click', async () => {
    if (musicBusy) return;
    if (music && !music.paused) { music.pause(); updateMusic(false); return; }
    if (!music) { music = new Audio('assets/audio/starlit-steps.wav'); music.loop = true; music.volume = .45; music.preload = 'none'; music.addEventListener('error', () => updateMusic(false)); }
    musicBusy = true;
    try { await music.play(); updateMusic(true); } catch { updateMusic(false); }
    finally { musicBusy = false; }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden && music && !music.paused) { music.pause(); updateMusic(false); } });
  $('zoom-in').addEventListener('click', () => world?.zoom(.84)); $('zoom-out').addEventListener('click', () => world?.zoom(1.19));
  function updateMotion(enabled) { $('motion-toggle').textContent = enabled ? 'Ⅱ' : '▷'; $('motion-toggle').setAttribute('aria-pressed', String(!enabled)); $('motion-toggle').setAttribute('aria-label', enabled ? '暂停自动动画' : '继续自动动画'); $('motion-toggle').title = enabled ? '暂停自动动画' : '继续自动动画'; }
  $('motion-toggle').addEventListener('click', () => { if (!world) return; world.setMotion(!world.motion); updateMotion(world.motion); });
  if ('DeviceOrientationEvent' in window && matchMedia('(pointer:coarse)').matches) $('gyro-toggle').hidden = false;
  $('gyro-toggle').addEventListener('click', async () => {
    if (!world) return;
    if (world.gyro) { world.setGyro(false); $('gyro-toggle').setAttribute('aria-pressed', 'false'); $('gyro-toggle').setAttribute('aria-label', '开启手机感应视角'); notice('已关闭手机感应视角。'); return; }
    try {
      if (typeof DeviceOrientationEvent.requestPermission === 'function' && await DeviceOrientationEvent.requestPermission() !== 'granted') { notice('未开启感应权限，仍可用手指拖动。'); return; }
      world.setGyro(true); notice('轻轻转动手机，正在连接感应视角。');
    } catch { notice('当前浏览器不支持感应视角，请用手指拖动。'); }
  });
  $('xhs-profile').href = data.xhsUrl; $('bili-profile').href = data.biliUrl;
  function showFallback(message) {
    fallback = true; closeDialogs(); world?.stop(); document.body.classList.add('fallback-mode'); document.body.classList.remove('exploring'); $('fallback').hidden = false; $('fallback-reason').textContent = message; $('fallback').append($('gallery')); renderGallery(); $('loading').classList.add('loaded');
  }
  $('retry-3d').addEventListener('click', () => { const url = new URL(location.href); url.searchParams.delete('view'); location.href = url.href; });
  function start() {
    if (new URLSearchParams(location.search).get('view') === '2d') { showFallback('轻量模式 · 74 件作品，慢慢看。'); return; }
    try {
      if (!window.XiaobaiWorld) throw new Error('3D library unavailable');
      world = new window.XiaobaiWorld($('world'), {
        ready: () => { $('loading').classList.add('loaded'); updateMotion(world.motion); }, select: showDetail, portal, category: openSearch, notice, fallback: showFallback, motion: updateMotion,
        gyro: enabled => { $('gyro-toggle').setAttribute('aria-pressed', String(enabled)); $('gyro-toggle').setAttribute('aria-label', enabled ? '关闭手机感应视角' : '开启手机感应视角'); if (enabled) notice('感应视角已开启，轻轻转动手机来探索。'); },
        hover: (item, x, y) => { const card = $('hover-card'); card.hidden = !item; if (!item) return; card.textContent = item.title; card.style.left = `${Math.min(x + 16, innerWidth - 280)}px`; card.style.top = `${Math.min(y + 18, innerHeight - 90)}px`; }
      });
      window.XIAOBAI_WORLD = world;
    } catch { showFallback('当前设备使用轻量展馆，74 件作品一件也不少。'); }
  }
  start();
}());

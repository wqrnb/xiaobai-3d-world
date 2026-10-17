/* Page shell: routing, dialogs, gallery, search, theme, and music. */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const locations = {
    home: '中央星球',
    featured: '精选岛',
    works: '小红书岛',
    videos: 'B 站岛',
    about: '关于小白',
    follow: '关注小白'
  };

  class Shell {
    constructor() {
      this.catalog = window.CATALOG;
      this.data = this.catalog.data;
      this.world = null;
      this.fallback = false;
      this.toastTimer = 0;
      this.music = null;
      this.musicBusy = false;
      this.galleryFilter = 'all';
      this.detailList = this.catalog.items;
      this.detailItem = null;
      this.view = 'home';
      this.pendingHash = '';
      this.returnToGallery = false;
      this.lastFocus = null;
    }

    start() {
      this.applySavedTheme();
      this.fillCopy();
      this.renderFilters();
      this.renderChips();
      this.bind();
      if (new URLSearchParams(location.search).get('view') === '2d') this.showFallback(`轻量模式 · ${this.catalog.counts.total} 件作品，慢慢看。`);
      else this.bootWorld();
      addEventListener('hashchange', () => this.onHashChange());
      const initial = this.parseHash(location.hash);
      if (!(initial.type === 'portal' && initial.name === 'home')) this.applyRoute(initial);
    }

    saved(key) {
      try { return localStorage.getItem(key); } catch { return null; }
    }

    save(key, value) {
      try { localStorage.setItem(key, value); } catch { /* private mode */ }
    }

    notice(message) {
      clearTimeout(this.toastTimer);
      const toast = $('toast');
      toast.textContent = message;
      toast.classList.add('show');
      this.toastTimer = setTimeout(() => toast.classList.remove('show'), 3300);
    }

    fillCopy() {
      const { counts } = this.catalog;
      $('stat-total').textContent = String(counts.total);
      $('stat-islands').textContent = String(counts.islands).padStart(2, '0');
      $('dock-works').textContent = `${counts.xhs} 件作品`;
      $('dock-videos').textContent = `${counts.bili} 条视频`;
      $('gallery-title').textContent = `${counts.total} 份喜欢，慢慢看。`;
      $('xhs-profile').href = this.data.xhsUrl;
      $('bili-profile').href = this.data.biliUrl;
    }

    renderFilters() {
      const { counts, categories } = this.catalog;
      const filters = [
        ['all', `全部 ${counts.total}`],
        ['featured', `精选 ${counts.featured}`],
        ['xhs', `小红书 ${counts.xhs}`],
        ['bili', `B 站 ${counts.bili}`],
        ...categories.map((category) => [`cat:${category}`, category])
      ];
      const wrap = $('gallery-filters');
      wrap.replaceChildren(...filters.map(([filter, label]) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.filter = filter;
        button.textContent = label;
        button.addEventListener('click', () => {
          this.galleryFilter = filter;
          this.renderGallery();
          if (this.parseHash(location.hash).type === 'gallery') this.replaceHash(this.galleryHash());
        });
        return button;
      }));
    }

    renderChips() {
      const chips = $('intro-chips');
      const tags = $('about-tags');
      chips.replaceChildren();
      tags.replaceChildren();
      for (const category of this.catalog.categories) {
        const count = this.catalog.items.filter((item) => item.category === category).length;
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.textContent = `${category} ${count}`;
        chip.addEventListener('click', () => this.onCategory(category));
        chips.append(chip);
        const tag = document.createElement('button');
        tag.type = 'button';
        tag.textContent = category;
        tag.addEventListener('click', () => this.onCategory(category));
        tags.append(tag);
      }
    }

    bind() {
      document.querySelectorAll('[data-portal]').forEach((button) => {
        button.addEventListener('click', (event) => {
          event.preventDefault();
          this.navigate(button.dataset.portal);
        });
      });
      document.querySelectorAll('dialog').forEach((dialog) => {
        dialog.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => dialog.close()));
        dialog.addEventListener('click', (event) => {
          if (event.target !== dialog) return;
          const rect = dialog.getBoundingClientRect();
          if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
        });
        dialog.addEventListener('close', () => this.onDialogClose(dialog));
      });
      $('gallery-open').addEventListener('click', () => this.navigate(this.galleryHash()));
      document.querySelector('.skip-link').addEventListener('click', (event) => {
        event.preventDefault();
        this.navigate(this.galleryHash());
      });
      $('search-open').addEventListener('click', () => this.openSearch());
      $('search-input').addEventListener('input', () => this.renderSearch());
      $('search-dialog').addEventListener('keydown', (event) => this.onSearchKey(event));
      $('detail-prev').addEventListener('click', () => this.stepDetail(-1));
      $('detail-next').addEventListener('click', () => this.stepDetail(1));
      $('detail-locate').addEventListener('click', () => this.locateDetail());
      $('theme-toggle').addEventListener('click', () => this.toggleTheme());
      $('music-toggle').addEventListener('click', () => this.toggleMusic());
      document.addEventListener('visibilitychange', () => {
        if (document.hidden && this.music && !this.music.paused) {
          this.music.pause();
          this.updateMusic(false);
        }
      });
      $('zoom-in').addEventListener('click', () => this.world?.zoom(0.84));
      $('zoom-out').addEventListener('click', () => this.world?.zoom(1.19));
      $('motion-toggle').addEventListener('click', () => {
        if (!this.world) return;
        this.world.setMotion(!this.world.motion);
        this.save('xiaobai-3d-motion', this.world.motion ? '1' : '0');
        this.updateMotion(this.world.motion);
      });
      if ('DeviceOrientationEvent' in window && matchMedia('(pointer:coarse)').matches) $('gyro-toggle').hidden = false;
      $('gyro-toggle').addEventListener('click', () => this.toggleGyro());
      $('retry-3d').addEventListener('click', () => {
        const url = new URL(location.href);
        url.searchParams.delete('view');
        location.href = url.href;
      });
      addEventListener('keydown', (event) => this.onKey(event));
      this.updateTheme();
    }

    bootWorld() {
      try {
        if (!window.XiaobaiWorld || !window.WORLD_LIB) throw new Error('3D library unavailable');
        this.world = new window.XiaobaiWorld($('world'), {
          ready: () => {
            $('loading').classList.add('loaded');
            this.updateMotion(this.world.motion);
          },
          select: (item, meta) => this.showDetail(item, this.listForIsland(item, meta)),
          portal: (name) => this.navigate(name),
          category: (name) => this.onCategory(name),
          notice: (message) => this.notice(message),
          fallback: (message) => this.showFallback(message),
          motion: (enabled) => this.updateMotion(enabled),
          gyro: (enabled) => {
            $('gyro-toggle').setAttribute('aria-pressed', String(enabled));
            $('gyro-toggle').setAttribute('aria-label', enabled ? '关闭手机感应视角' : '开启手机感应视角');
            if (enabled) this.notice('感应视角已开启，轻轻转动手机来探索。');
          },
          hover: (item, x, y) => {
            const card = $('hover-card');
            card.hidden = !item;
            if (!item) return;
            card.textContent = item.title;
            card.style.left = `${Math.min(x + 16, innerWidth - 280)}px`;
            card.style.top = `${Math.min(y + 18, innerHeight - 90)}px`;
          }
        });
        window.XIAOBAI_WORLD = this.world;
        const savedMotion = this.saved('xiaobai-3d-motion');
        if (savedMotion === '0' || savedMotion === '1') {
          this.world.setMotion(savedMotion === '1');
          this.updateMotion(this.world.motion);
        }
      } catch {
        this.showFallback(`当前设备使用轻量展馆，${this.catalog.counts.total} 件作品一件也不少。`);
      }
    }

    listForIsland(item, meta) {
      if (meta?.island === 'featured') return this.catalog.featured;
      return this.catalog.filterItems(item.platform);
    }

    parseHash(hash) {
      const raw = decodeURIComponent(String(hash || '').replace(/^#/, ''));
      if (!raw || raw === 'home') return { type: 'portal', name: 'home' };
      if (Object.prototype.hasOwnProperty.call(locations, raw)) return { type: 'portal', name: raw };
      if (raw === 'gallery') return { type: 'gallery', filter: 'all' };
      if (raw.startsWith('gallery/')) return { type: 'gallery', filter: raw.slice('gallery/'.length) };
      if (raw.startsWith('w/')) return { type: 'work', id: raw.slice(2) };
      return { type: 'portal', name: 'home' };
    }

    hashFor(value) {
      const url = new URL(location.href);
      url.hash = value;
      return url.hash;
    }

    galleryHash() {
      return this.galleryFilter === 'all' ? 'gallery' : `gallery/${this.galleryFilter}`;
    }

    pushHash(value) {
      const next = this.hashFor(value);
      if (location.hash === next) return;
      this.pendingHash = next;
      location.hash = value;
    }

    replaceHash(value) {
      const next = this.hashFor(value);
      if (location.hash === next) return;
      history.replaceState(null, '', next);
    }

    navigate(value) {
      const route = this.parseHash(this.hashFor(value));
      this.applyRoute(route);
      this.pushHash(value);
    }

    onHashChange() {
      if (this.pendingHash && location.hash === this.pendingHash) {
        this.pendingHash = '';
        return;
      }
      this.pendingHash = '';
      this.applyRoute(this.parseHash(location.hash));
    }

    applyRoute(route) {
      if (route.type === 'gallery') {
        this.galleryFilter = this.catalog.knownFilter(route.filter) ? route.filter : 'all';
        this.renderGallery();
        if (this.fallback) $('gallery').scrollIntoView({ behavior: this.world?.motion === false ? 'auto' : 'smooth' });
        else this.openDialog('gallery-dialog');
        return;
      }
      if (route.type === 'work') {
        const item = this.catalog.byId.get(route.id);
        if (!item) {
          this.notice('没有找到这件作品。');
          this.navigate('home');
          return;
        }
        if (this.world && !this.fallback) {
          this.world.focusItem(item);
          this.syncChrome(this.catalog.islandOf(item));
        }
        this.showDetail(item, this.catalog.filterItems(item.platform));
        return;
      }
      this.applyPortal(route.name);
    }

    applyPortal(name) {
      this.closeDialogs();
      this.syncChrome(name);
      if (this.fallback) {
        if (name === 'about' || name === 'follow') this.openDialog(`${name}-dialog`);
        else {
          this.galleryFilter = name === 'works' ? 'xhs' : name === 'videos' ? 'bili' : name === 'featured' ? 'featured' : 'all';
          this.renderGallery();
          $('gallery').scrollIntoView({ behavior: 'smooth' });
        }
        return;
      }
      if (!this.world) return;
      this.world.flyTo(name, () => {
        if (name === 'about' || name === 'follow') this.openDialog(`${name}-dialog`);
      });
    }

    syncChrome(name) {
      this.view = name;
      document.body.classList.toggle('exploring', name !== 'home');
      $('location-name').textContent = locations[name] || locations.home;
      document.title = name === 'home' ? '小白大世界 · 3D 星空展馆' : `小白大世界 · ${locations[name] || '展馆'}`;
      document.querySelectorAll('[data-portal]').forEach((element) => {
        const active = element.dataset.portal === name;
        element.classList.toggle('active', active);
        if (element.closest('nav')) element.setAttribute('aria-current', active ? 'location' : 'false');
      });
    }

    onCategory(name) {
      const list = this.catalog.filterItems(`cat:${name}`);
      if (this.fallback || !this.world) {
        this.galleryFilter = `cat:${name}`;
        this.navigate(this.galleryHash());
        return;
      }
      const xhs = list.filter((item) => item.platform === 'xhs').length;
      const island = xhs >= list.length - xhs ? 'works' : 'videos';
      this.world.highlightCategory(name);
      this.notice(`「${name}」共 ${list.length} 件，对应画框会亮一会儿。`);
      this.navigate(island);
    }

    closeDialogs() {
      document.querySelectorAll('dialog[open]').forEach((dialog) => {
        dialog.dataset.suppressHash = '1';
        dialog.close();
      });
    }

    openDialog(id) {
      this.closeDialogs();
      this.lastFocus = document.activeElement;
      const dialog = $(id);
      dialog.showModal();
      if (this.world) this.world.controls.enabled = false;
    }

    onDialogClose(dialog) {
      const suppressed = dialog.dataset.suppressHash === '1';
      delete dialog.dataset.suppressHash;
      if (suppressed && dialog.id === 'detail-dialog') this.returnToGallery = false;
      if (this.world && !document.querySelector('dialog[open]')) this.world.controls.enabled = true;
      if (!suppressed) {
        const route = this.parseHash(location.hash);
        if (dialog.id === 'gallery-dialog' && route.type === 'gallery') this.replaceHash(this.view || 'home');
        if (dialog.id === 'detail-dialog' && route.type === 'work' && this.detailItem) this.replaceHash(this.catalog.islandOf(this.detailItem));
        if (dialog.id === 'detail-dialog' && this.returnToGallery) {
          this.returnToGallery = false;
          this.openDialog('gallery-dialog');
          return;
        }
      }
      if (!suppressed && !document.querySelector('dialog[open]') && this.lastFocus && typeof this.lastFocus.focus === 'function') {
        this.lastFocus.focus({ preventScroll: true });
      }
    }

    renderGallery() {
      document.querySelectorAll('[data-filter]').forEach((button) => {
        button.classList.toggle('active', button.dataset.filter === this.galleryFilter);
      });
      const list = this.catalog.filterItems(this.catalog.knownFilter(this.galleryFilter) ? this.galleryFilter : 'all');
      const grid = $('gallery-grid');
      if (!list.length) {
        const empty = document.createElement('p');
        empty.className = 'empty-message';
        empty.textContent = '这个分类里还没有作品。';
        grid.replaceChildren(empty);
        return;
      }
      const featuredIds = new Set(this.catalog.featured.map((item) => item.id));
      grid.replaceChildren(...list.map((item) => {
        const card = document.createElement('article');
        card.className = featuredIds.has(item.id) ? 'gallery-card is-featured' : 'gallery-card';
        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'card-open';
        const img = document.createElement('img');
        img.src = item.image;
        img.alt = '';
        img.loading = 'lazy';
        img.decoding = 'async';
        if (featuredIds.has(item.id)) {
          const mark = document.createElement('span');
          mark.className = 'featured-mark';
          mark.textContent = '精选';
          open.append(mark);
        }
        const title = document.createElement('h3');
        title.textContent = item.title;
        const meta = document.createElement('p');
        meta.textContent = `${this.catalog.platformName(item)} · ${item.category} · ${this.catalog.metricLine(item)}`;
        open.append(img, title, meta);
        open.addEventListener('click', () => this.showDetail(item, list));
        const locate = document.createElement('button');
        locate.type = 'button';
        locate.className = 'card-locate';
        locate.textContent = '在星球中看';
        locate.addEventListener('click', () => this.focusItem(item));
        card.append(open, locate);
        return card;
      }));
    }

    showDetail(item, list) {
      const source = list && list.some((entry) => entry.id === item.id) ? list : this.catalog.items;
      this.detailList = source;
      this.detailItem = item;
      const place = this.catalog.neighbors(item, source);
      $('detail-image').src = item.image;
      $('detail-image').alt = item.title;
      $('detail-platform').textContent = `${this.catalog.platformName(item)} · ${item.platform === 'bili' ? '视频' : '作品'}`;
      $('detail-title').textContent = item.title;
      $('detail-category').textContent = item.category;
      $('detail-link').href = item.url;
      $('detail-index').textContent = `${place.index + 1} / ${place.total}`;
      $('detail-featured').hidden = !this.catalog.featured.some((entry) => entry.id === item.id);
      $('detail-meta').replaceChildren(...this.catalog.metricParts(item).map((text) => {
        const span = document.createElement('span');
        span.textContent = text;
        return span;
      }));
      if (this.parseHash(location.hash).type === 'work') this.replaceHash(`w/${item.id}`);
      $('hover-card').hidden = true;
      if ($('gallery-dialog').open) this.returnToGallery = true;
      if (!$('detail-dialog').open) this.openDialog('detail-dialog');
    }

    stepDetail(direction) {
      if (!this.detailItem) return;
      const place = this.catalog.neighbors(this.detailItem, this.detailList);
      this.showDetail(direction < 0 ? place.prev : place.next, this.detailList);
    }

    locateDetail() {
      if (!this.detailItem || this.fallback || !this.world) return;
      const item = this.detailItem;
      this.closeDialogs();
      this.focusItem(item);
    }

    focusItem(item) {
      if (this.fallback || !this.world) {
        this.showDetail(item, this.catalog.filterItems(item.platform));
        return;
      }
      this.closeDialogs();
      this.world.focusItem(item);
      this.syncChrome(this.catalog.islandOf(item));
      this.replaceHash(this.catalog.islandOf(item));
      this.notice('已定位作品，点击亮起的画框或按回车查看。');
    }

    openSearch(query = '') {
      $('search-input').value = query;
      this.renderSearch();
      this.openDialog('search-dialog');
      $('search-input').focus();
    }

    renderSearch() {
      const query = $('search-input').value.trim();
      const matches = query ? this.catalog.search(query) : this.catalog.featured;
      const results = $('search-results');
      results.replaceChildren();
      const summary = document.createElement('p');
      summary.className = 'search-summary';
      summary.textContent = query ? `找到 ${matches.length} 件作品 · ${this.fallback ? '点击查看详情' : '点击传送到作品'}` : '从这几份喜欢开始逛';
      results.append(summary);
      if (!matches.length) {
        const empty = document.createElement('p');
        empty.className = 'empty-message';
        empty.textContent = '还没找到，试试“开箱”“GBC”或“兔兔”。';
        results.append(empty);
        return;
      }
      for (const item of matches) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'search-result';
        const img = document.createElement('img');
        img.src = item.image;
        img.alt = '';
        img.loading = 'lazy';
        const copy = document.createElement('span');
        const title = document.createElement('strong');
        title.textContent = item.title;
        const meta = document.createElement('small');
        meta.textContent = `${this.catalog.platformName(item)} · ${item.category}`;
        copy.append(title, meta);
        const arrow = document.createElement('span');
        arrow.className = 'result-arrow';
        arrow.textContent = '↗';
        button.append(img, copy, arrow);
        button.addEventListener('click', () => this.focusItem(item));
        results.append(button);
      }
    }

    onSearchKey(event) {
      if (event.isComposing || event.keyCode === 229) return;
      const buttons = [...$('search-results').querySelectorAll('button')];
      const index = buttons.indexOf(document.activeElement);
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        (buttons[index + 1] || buttons[0])?.focus();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (index <= 0) $('search-input').focus();
        else buttons[index - 1].focus();
      } else if (event.key === 'Enter' && document.activeElement === $('search-input')) {
        event.preventDefault();
        event.stopPropagation();
        buttons[0]?.click();
      }
    }

    onKey(event) {
      const typing = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName);
      if (event.key === '/' && !document.querySelector('dialog[open]') && !typing) {
        event.preventDefault();
        this.openSearch();
        return;
      }
      if (!$('detail-dialog').open) return;
      if (event.key === 'ArrowLeft') { event.preventDefault(); this.stepDetail(-1); }
      if (event.key === 'ArrowRight') { event.preventDefault(); this.stepDetail(1); }
    }

    applySavedTheme() {
      const theme = this.saved('xiaobai-3d-theme') || 'night';
      document.documentElement.dataset.theme = theme;
    }

    updateTheme() {
      const day = document.documentElement.dataset.theme === 'day';
      $('theme-name').textContent = day ? '日间泡泡园' : '夜间霓虹秀';
      $('theme-toggle').setAttribute('aria-label', day ? '切换到夜晚' : '切换到白天');
      $('theme-toggle').title = day ? '切换到夜晚' : '切换到白天';
      $('theme-toggle').firstElementChild.textContent = day ? '☾' : '☼';
      document.querySelector('meta[name=theme-color]').content = day ? '#f8deef' : '#130b2b';
    }

    toggleTheme() {
      const next = document.documentElement.dataset.theme === 'day' ? 'night' : 'day';
      document.documentElement.dataset.theme = next;
      this.save('xiaobai-3d-theme', next);
      this.world?.setTheme(next);
      this.updateTheme();
    }

    updateMusic(playing) {
      $('music-toggle').setAttribute('aria-pressed', String(playing));
      $('music-toggle').setAttribute('aria-label', playing ? '关闭音乐' : '开启音乐');
      $('music-toggle').title = playing ? '关闭音乐' : '开启音乐';
    }

    async toggleMusic() {
      if (this.musicBusy) return;
      if (this.music && !this.music.paused) {
        this.music.pause();
        this.updateMusic(false);
        return;
      }
      if (!this.music) {
        this.music = new Audio('assets/audio/starlit-steps.wav');
        this.music.loop = true;
        this.music.volume = 0.45;
        this.music.preload = 'none';
        this.music.addEventListener('error', () => this.updateMusic(false));
      }
      this.musicBusy = true;
      try {
        await this.music.play();
        this.updateMusic(true);
      } catch {
        this.updateMusic(false);
      } finally {
        this.musicBusy = false;
      }
    }

    updateMotion(enabled) {
      const button = $('motion-toggle');
      button.textContent = enabled ? 'Ⅱ' : '▷';
      button.setAttribute('aria-pressed', String(!enabled));
      button.setAttribute('aria-label', enabled ? '暂停自动动画' : '继续自动动画');
      button.title = enabled ? '暂停自动动画' : '继续自动动画';
    }

    async toggleGyro() {
      if (!this.world) return;
      if (this.world.gyro) {
        this.world.setGyro(false);
        $('gyro-toggle').setAttribute('aria-pressed', 'false');
        $('gyro-toggle').setAttribute('aria-label', '开启手机感应视角');
        this.notice('已关闭手机感应视角。');
        return;
      }
      try {
        if (typeof DeviceOrientationEvent.requestPermission === 'function' && await DeviceOrientationEvent.requestPermission() !== 'granted') {
          this.notice('未开启感应权限，仍可用手指拖动。');
          return;
        }
        this.world.setGyro(true);
        this.notice('轻轻转动手机，正在连接感应视角。');
      } catch {
        this.notice('当前浏览器不支持感应视角，请用手指拖动。');
      }
    }

    showFallback(message) {
      if (this.fallback) {
        $('fallback-reason').textContent = message;
        return;
      }
      this.fallback = true;
      this.closeDialogs();
      this.world?.stop();
      document.body.classList.add('fallback-mode');
      document.body.classList.remove('exploring');
      $('fallback').hidden = false;
      $('fallback-reason').textContent = message;
      $('fallback').append($('gallery'));
      this.renderGallery();
      $('loading').classList.add('loaded');
    }
  }

  window.XiaobaiShell = Shell;
}());

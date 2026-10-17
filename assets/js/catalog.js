/* Derived catalog over the shared SITE_DATA snapshot. No fetching. */
(function () {
  'use strict';
  const data = window.SITE_DATA;
  if (!data || !Array.isArray(data.items)) return;

  const items = data.items;
  const byId = new Map(items.map((item) => [item.id, item]));
  const featured = (data.featuredIds || []).map((id) => byId.get(id)).filter(Boolean);
  const categories = Array.isArray(data.categories) ? data.categories.slice() : [];

  function platformName(item) {
    return item.platform === 'xhs' ? '小红书' : 'B 站';
  }

  function metricLine(item) {
    return item.platform === 'xhs' ? `${item.likes} 点赞` : `${item.play} 播放`;
  }

  function metricParts(item) {
    if (item.platform === 'xhs') return [`♡ ${item.likes} 点赞`];
    return [`▷ ${item.play} 播放`, `${item.danmu} 弹幕`, item.date];
  }

  function compact(value) {
    return String(value || '').toLocaleLowerCase().replace(/\s+/g, '');
  }

  function haystack(item) {
    return compact(`${item.title}\n${item.category}\n${platformName(item)}\n${item.id}`);
  }

  function search(query) {
    const tokens = String(query || '').trim().split(/\s+/).map(compact).filter(Boolean);
    if (!tokens.length) return [];
    const scored = [];
    items.forEach((item, index) => {
      const hay = haystack(item);
      if (!tokens.every((token) => hay.includes(token))) return;
      const title = compact(item.title);
      const category = compact(item.category);
      const platform = compact(platformName(item));
      const id = compact(item.id);
      let score = 4;
      if (tokens.every((token) => title.includes(token))) score = title.startsWith(tokens[0]) ? 0 : 1;
      else if (tokens.every((token) => category.includes(token))) score = 2;
      else if (tokens.every((token) => platform.includes(token))) score = 3;
      else if (tokens.every((token) => id.includes(token))) score = 4;
      scored.push({ item, score, index });
    });
    scored.sort((a, b) => a.score - b.score || a.index - b.index);
    return scored.map((row) => row.item);
  }

  function filterItems(filter) {
    if (!filter || filter === 'all') return items;
    if (filter === 'featured') return featured;
    if (filter === 'xhs' || filter === 'bili') return items.filter((item) => item.platform === filter);
    if (filter.startsWith('cat:')) {
      const category = filter.slice(4);
      return items.filter((item) => item.category === category);
    }
    return items;
  }

  function knownFilter(filter) {
    if (filter === 'all' || filter === 'featured' || filter === 'xhs' || filter === 'bili') return true;
    return filter.startsWith('cat:') && categories.includes(filter.slice(4));
  }

  function islandOf(item) {
    return item.platform === 'xhs' ? 'works' : 'videos';
  }

  function neighbors(item, list) {
    const source = list && list.length ? list : items;
    const index = source.findIndex((entry) => entry.id === item.id);
    if (index < 0) return { prev: source[0] || null, next: source[0] || null, index: 0, total: source.length };
    return {
      prev: source[(index - 1 + source.length) % source.length],
      next: source[(index + 1) % source.length],
      index,
      total: source.length
    };
  }

  const counts = {
    total: items.length,
    xhs: items.filter((item) => item.platform === 'xhs').length,
    bili: items.filter((item) => item.platform === 'bili').length,
    featured: featured.length,
    islands: 3
  };

  window.CATALOG = {
    data,
    items,
    byId,
    featured,
    categories,
    counts,
    platformName,
    metricLine,
    metricParts,
    search,
    filterItems,
    knownFilter,
    islandOf,
    neighbors
  };
}());

// Independently implemented from the public tool's search behavior, reviewed 2026-10-02.
// Source: https://github.com/ddtank98776/beyblade/blob/main/index.html
// No upstream scripts are executed. Catalog names/typos are refreshed as data.
const normalize = value => String(value).toUpperCase().replace(/[\s\-－]/g, '')
  .replace(/(BXG|BX|CX|UX)0*(\d{1,2})(?:0*(\d{1,2}))?/g,
    (_, series, number, sub) => series + number.padStart(2, '0') + (sub ? '-' + sub.padStart(2, '0') : ''));
const isModel = word => /^(BXG|BX|CX|UX)\d/.test(normalize(word));
const colorPattern = /^(透明|火紅|鍍金|鍍銀|鍍銅|紅|黑|白|金|銀|藍|綠|紫|橘|黃)/;
const mixed = key => /-00$/.test(key) && !key.includes('·');
const ownName = item => item.key.includes('·') ? item.key.split('·')[1] : mixed(item.key) ? '' : item.aliases.join(' ');
const mainName = item => item.key.includes('·') ? item.key.split('·')[1] : mixed(item.key) ? '' : item.aliases[0] || '';

export function searchMarket(snapshot, query) {
  const { items, catalog } = snapshot;
  const countRows = sku => items.filter(item => item.sku === sku || item.sku.startsWith(sku + '-'))
    .reduce((count, item) => count + item.raw.length, 0);
  function clean(word) {
    let s = word.replace(/[\u3100-\u312F\u02C7\u02CA\u02CB\u02C9\u02D9\u00AF\u31A0-\u31BF]/g, '').trim();
    if (!s) return '';
    const withoutModifiers = s.replace(/(二手|全新|中古|未拆|拆檢|已拆|盒損|瑕疵|日版|台版|美版|韓版|亞版|港版|泰版|現貨|求購|收購|出售|販售|保留)/g, '').trim();
    if (withoutModifiers) s = withoutModifiers;
    else if (s !== word) return '';
    s = s.replace(/([一-鿿])\s*\d{1,2}(\.\d{0,2})?$/, '$1').replace(/^([一-鿿]{2,})\1+$/, '$1');
    if (typeof catalog.typo?.[s] === 'string') s = catalog.typo[s];
    else {
      const typo = Object.keys(catalog.typo || {}).sort((a, b) => b.length - a.length)
        .find(key => key.length >= 2 && key !== catalog.typo[key] && s.includes(key));
      if (typo) s = s.split(typo).join(catalog.typo[typo]).replace(/^([一-鿿]{2,})\1+$/, '$1');
    }
    const auto = s.match(/^(I['’‘`]?D|IX|CUZ|U|B|C)[\s\-_]?(\d{1,2})(?:[\s\-_]0*(\d{1,2}))?$/i);
    if (auto && !(auto[1].length === 1 && auto[2].length < 2)) {
      const series = { I: 'UX', C: 'CX', U: 'UX', B: 'BX' }[auto[1][0].toUpperCase()];
      const sku = series + '-' + auto[2].padStart(2, '0') + (auto[3] ? '-' + auto[3].padStart(2, '0') : '');
      if (countRows(sku)) return sku;
    }
    const model = s.match(/(BXG|BXH|BXA|BXC|BOX|BX|CX|UX|OX)[\s\-_]?0*(\d{1,3})(?:[\s\-_]0*(\d{1,2}))?/i);
    if (model && model[0].length >= s.length - 2) {
      const series = /^(BOX|OX)$/i.test(model[1]) ? 'BX' : model[1].toUpperCase();
      s = series + '-' + ('0' + model[2]).slice(-2) + (model[3] ? '-' + ('0' + model[3]).slice(-2) : '');
    }
    return s;
  }
  const prepared = items.map(item => ({ item, model: normalize(item.sku),
    title: (item.key + ' ' + ownName(item)).toUpperCase(),
    main: (item.key + ' ' + mainName(item)).toUpperCase(),
    hay: (item.key + ' ' + ownName(item) + ' ' + item.official).toUpperCase() }));
  function matches(entry, raw, tokens) {
    const hay = entry.hay + ' ' + raw.toUpperCase();
    return tokens.every(token => {
      if (isModel(token)) {
        const key = normalize(token);
        return entry.model === key || entry.model.startsWith(key) || key.startsWith(entry.model);
      }
      const word = token.toUpperCase();
      if (/^(BXG|BX|CX|UX)$/.test(word)) return entry.model.startsWith(word);
      if (hay.includes(word)) return true;
      const color = token.match(colorPattern);
      const rest = color ? token.slice(color[0].length) : '';
      return rest.length >= 2 && hay.includes(rest.toUpperCase()) && hay.includes(color[1].slice(-1));
    });
  }
  const hasAny = tokens => prepared.some(entry => entry.item.raw.some(raw => matches(entry, raw, tokens)));
  function rescueWord(word) {
    let parts;
    if ((parts = word.match(/^(BXG|BX|CX|UX)([一-鿿]{2,})$/i))) return [parts[1].toUpperCase(), parts[2]];
    if ((parts = word.match(/^\d{1,3}([一-鿿]{2,})$/))) return [parts[1]];
    if ((parts = word.match(/^([一-鿿]{2,})[0-9A-Za-z\-\.]+$/))) return [parts[1]];
    if (catalog.name?.[word]) return null;
    if (/^[一-鿿]{3,}$/.test(word)) {
      for (let size = word.length - 1; size >= 2; size--) {
        for (let start = 0; start + size <= word.length; start++) {
          const part = word.slice(start, start + size);
          if (prepared.some(entry => entry.hay.includes(part.toUpperCase()))) return [part];
        }
      }
    }
    return null;
  }
  const original = query.trim().split(/\s+/).filter(Boolean);
  let tokens = original.map(clean).filter(Boolean);
  if (!tokens.length) return { choices: [], correction: '', suggestions: [] };
  let correction = tokens.join(' ') === original.join(' ') ? '' : `以「${tokens.join(' ')}」查詢。`;
  if (!hasAny(tokens)) {
    let resolved = [], dead = [], changed = false;
    for (const token of tokens) {
      if (hasAny([token])) { resolved.push(token); continue; }
      const alt = rescueWord(token);
      if (alt && hasAny(alt)) { resolved.push(...alt); changed = true; }
      else dead.push(token);
    }
    const solid = resolved.some(token => isModel(token) || /[一-鿿]{2,}/.test(token));
    if (dead.length && solid && dead.every(token => !/^[一-鿿]{2,}$/.test(token))) changed = true;
    else resolved.push(...dead);
    if (changed && hasAny(resolved)) {
      tokens = resolved;
      correction = `「${query}」整串查不到，改以「${tokens.join(' ')}」查詢。`;
    }
  }
  const ranked = [];
  for (const entry of prepared) {
    const count = entry.item.raw.reduce((n, raw) => n + (matches(entry, raw, tokens) ? 1 : 0), 0);
    if (!count) continue;
    const score = tokens.reduce((sum, token) => sum + (isModel(token)
      ? (entry.model.startsWith(normalize(token)) ? 2 : 0)
      : entry.main.includes(token.toUpperCase()) ? 2 : entry.title.includes(token.toUpperCase()) ? 1 : 0), 0);
    ranked.push({ item: entry.item, count, score });
  }
  ranked.sort((a, b) => b.score - a.score || b.count - a.count || (a.item.key < b.item.key ? -1 : 1));
  const suggestions = [];
  if (!ranked.length) {
    for (const token of tokens) {
      if (!/[A-Za-z]/.test(token) || !/\d/.test(token)) continue;
      const numbers = token.match(/\d{1,3}/g);
      if (!numbers) continue;
      for (const series of ['BX', 'CX', 'UX', 'BXG']) {
        const sku = series + '-' + numbers[0].padStart(2, '0') + (numbers[1] ? '-' + numbers[1].padStart(2, '0') : '');
        const count = countRows(sku);
        if (count > 0 && (catalog.sku?.[sku] || count >= 5) && !suggestions.includes(sku)) suggestions.push(sku);
      }
    }
  }
  return { choices: ranked.map(row => row.item), correction, suggestions };
}

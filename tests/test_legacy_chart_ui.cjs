const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

class Element {
  constructor(dataset = {}) { this.dataset = dataset; this.listeners = {}; this.attributes = {}; this.hidden = false; this.value = ''; this.open = false; this.classList = { toggle: (key, value) => { this[key] = value; } }; }
  addEventListener(name, listener) { this.listeners[name] = listener; }
  setAttribute(name, value) { this.attributes[name] = value; }
  fire(name, event = {}) { this.listeners[name](event); }
  showModal() { assert.equal(this.open, false); this.open = true; }
  close() { this.open = false; }
  getBoundingClientRect() { return { left: 10, right: 500, top: 10, bottom: 400 }; }
}
function setup() {
  const cards = [new Element({category:'目录与价格',search:'模型目录'}),new Element({category:'排名与历史',search:'公开历史'}),new Element({category:'排名与历史',search:'模型排名'})];
  const links = cards.map(() => new Element());
  const filters = ['全部','目录与价格','排名与历史'].map(filter => new Element({filter}));
  const zooms = cards.map((_,i) => new Element({image:`charts/${i}.png`,title:`图表 ${i}`}));
  const elements = Object.fromEntries(['search','result-count','empty','viewer','viewer-image','viewer-title','viewer-download','viewer-close','freshness'].map(x => ['#'+x,new Element()]));
  elements['#freshness'].dataset.collected = new Date(Date.now()-40*3600000).toISOString();
  elements['#freshness'].parentElement = new Element();
  const document = {querySelector: key => elements[key],querySelectorAll: key => ({'.chart-card':cards,'.contents nav a':links,'[data-filter]':filters,'.zoom':zooms})[key]};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../scripts/legacy_chart_gallery/web/app.js'),'utf8'), {document, Date, setInterval: () => {}});
  return {cards,links,filters,zooms,elements};
}
test('category filter and reset keep navigation consistent', () => {
  const s=setup(); s.filters[2].fire('click');
  assert.deepEqual(s.cards.map(x=>x.hidden),[true,false,false]);
  assert.deepEqual(s.links.map(x=>x.hidden),[true,false,false]);
  assert.equal(s.elements['#result-count'].textContent,'2 张图表');
  assert.equal(s.filters[2].attributes['aria-pressed'],'true');
  s.filters[0].fire('click'); assert.ok(s.cards.every(x=>!x.hidden));
});
test('search combines with category and handles no matches/recovery', () => {
  const s=setup(); s.filters[2].fire('click');
  s.elements['#search'].value='模型'; s.elements['#search'].fire('input');
  assert.deepEqual(s.cards.map(x=>x.hidden),[true,true,false]);
  s.elements['#search'].value='zzzzz'; s.elements['#search'].fire('input');
  assert.equal(s.elements['#empty'].hidden,false);
  s.elements['#search'].value=''; s.elements['#search'].fire('input');
  assert.equal(s.elements['#empty'].hidden,true);
});
test('zoom opens, ignores repeat opening, closes and reopens with correct image', () => {
  const s=setup(); s.zooms[0].fire('click'); s.zooms[0].fire('click');
  assert.equal(s.elements['#viewer'].open,true);
  s.elements['#viewer-close'].fire('click'); assert.equal(s.elements['#viewer'].open,false);
  s.zooms[2].fire('click'); assert.equal(s.elements['#viewer-image'].src,'charts/2.png');
  assert.equal(s.elements['#viewer-download'].href,'charts/2.png');
});
test('backdrop closes but internal dialog clicks do not', () => {
  const s=setup(); const viewer=s.elements['#viewer']; s.zooms[0].fire('click');
  viewer.fire('click',{target:viewer,clientX:100,clientY:100});assert.equal(viewer.open,true);
  viewer.fire('click',{target:viewer,clientX:1,clientY:1});assert.equal(viewer.open,false);
});
test('old snapshot clearly displays stale warning', () => {
  const s=setup(); assert.match(s.elements['#freshness'].textContent,/40 小时/);
  assert.equal(s.elements['#freshness'].parentElement.stale,true);
});

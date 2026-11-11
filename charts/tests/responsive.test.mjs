import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync(new URL('../web/style.css', import.meta.url), 'utf8');
function declarations(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = [...css.matchAll(new RegExp(`${escaped}\\s*\\{([^{}]*)\\}`, 'g'))];
  assert.ok(matches.length, `Missing CSS selector ${selector}`);
  return matches.map(match => match[1].replace(/\s+/g, ''));
}

// These are stylesheet-contract regressions, not a substitute for measured
// browser layout. The published 390px failure was a grid min-content expansion
// caused by the 1360–1600px chart stage, which CSS transforms do not shrink.
test('gallery grid and its cards can shrink below a fixed-size SVG stage', () => {
  assert.ok(declarations('.gallery-layout').some(rule => rule.includes('grid-template-columns:minmax(0,1fr)')));
  assert.ok(!declarations('.gallery-layout').some(rule => rule.includes('grid-template-columns:1fr;') || rule === 'grid-template-columns:1fr'));
  assert.ok(declarations('.gallery-layout > *').some(rule => rule.includes('min-width:0') && rule.includes('max-width:100%')));
  assert.ok(declarations('#cards,.chart-card,.chart-host').some(rule => rule.includes('min-width:0') && rule.includes('max-width:100%')));
  assert.ok(declarations('#cards').some(rule => rule.includes('width:100%')));
  assert.ok(declarations('.chart-host .chart-viewport').some(rule => rule.includes('max-width:100%')));
});

test('overflow containment does not clip the natural-size modal viewport', () => {
  const viewportRules = declarations('.chart-viewport');
  // Only .chart-host .chart-viewport receives max-width; the generic/modal
  // viewport must still accept its inline 1360–1600px natural width.
  const generic = [...css.matchAll(/(?:^|})\s*\.chart-viewport\s*\{([^{}]*)\}/g)].map(m => m[1]);
  assert.ok(generic.length);
  assert.ok(generic.every(rule => !/max-width|width\s*:/.test(rule)));
  assert.ok(declarations('.viewer-body').some(rule => rule.includes('width:100%') && rule.includes('overflow:auto')));
  assert.ok(!/(?:^|})\s*(?:html|body)\s*\{[^{}]*overflow-x\s*:\s*hidden/.test(css), 'Do not mask page overflow globally');
  assert.ok(viewportRules.length > 0);
});

test('long chart titles and data remain within the constrained card', () => {
  assert.ok(declarations('.card-heading h3').some(rule => rule.includes('min-width:0') && rule.includes('overflow-wrap:anywhere')));
  assert.ok(declarations('.chart-sources a').some(rule => rule.includes('overflow-wrap:anywhere')));
  assert.ok(declarations('.chart-data pre').some(rule => rule.includes('max-width:100%')));
});

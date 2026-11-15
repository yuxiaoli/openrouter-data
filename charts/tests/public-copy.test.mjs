import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {parseHTML} from 'linkedom';
import {compileGallery} from '../src/compile-all.mjs';
import {sourceFixture} from './fixtures.mjs';
const html=fs.readFileSync(new URL('../web/index.html',import.meta.url),'utf8');
const forbidden=['白底蓝金','原来的样式','口径不丢','一份快照，一套图','不把缺口','GitHub Actions','不重复采集','未擅自','不推造','不硬造','未猜测','按父对象含义读取','非 OpenRouter 官方服务'];
test('public introduction and all chart captions address readers, not development collaborators',()=>{
 const data=compileGallery(sourceFixture());
 const visible=html+'\n'+data.charts.map(c=>[c.title,c.subtitle,c.notes].join('\n')).join('\n');
 for(const phrase of forbidden)assert.ok(!visible.includes(phrase),phrase);
 for(const phrase of ['模型价格','热门应用','数据来源','浏览与下载','更新时间','空白表示未提供数据，不等于零','独立公开数据可视化项目'])assert.ok(html.includes(phrase),phrase);
});
test('personal footer uses the exact verified signature, link and ending',()=>{
 const {document}=parseHTML(html),footer=document.querySelector('footer'),credit=footer.querySelector('.branding-credit');
 assert.equal(credit.textContent,'Built by Sean with ❤️');assert.equal(footer.lastElementChild,credit);
 assert.equal(credit.querySelectorAll('a').length,1);assert.equal(credit.querySelector('a').textContent,'Sean');
 assert.equal(credit.querySelector('a').getAttribute('href'),'https://www.linkedin.com/in/yuxiaoli/');
});
test('copy-only compiler cleanup preserves every data field, panel, unit, identity and ordering',()=>{
 const payload=compileGallery(sourceFixture());
 // Baseline: pre-copy release 6300da99, excluding only chart title/subtitle/notes.
 for(const c of payload.charts){delete c.title;delete c.subtitle;delete c.notes;}
 assert.equal(createHash('sha256').update(JSON.stringify(payload)).digest('hex'),'5defb31c4ab9463fd44162fa043747b4b4ca3f9117cb76d0004ad59b393c1736');
});

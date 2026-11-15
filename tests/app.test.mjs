import { createLabelGridUrl, packQrGrid } from '../image-transfer.js';
// Exercise the actual editor and print orchestration with a mocked printer.
// JSDOM is a DOM test harness; this does not replace a physical BLE print test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCanvas, Image } from '@napi-rs/canvas';
import { JSDOM } from 'jsdom';
const read = path => readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const registry = JSON.parse(read('vendor/niimbot/registry.json'));
const pause = () => new Promise(resolve => setTimeout(resolve,10));
async function ready(predicate) { for(let i=0;i<100;i++) { if(predicate()) return; await pause(); } throw new Error('UI did not settle.'); }
async function harness(hash = '') {
  const dom = new JSDOM(read('index.html'),{url:'http://localhost:8080/labels/'+hash,runScripts:'outside-only'});
  const w=dom.window, calls=[],identifiedModels=[];
  Object.defineProperty(w,'isSecureContext',{value:true});
  w.fetch=async()=>({ok:true,json:async()=>registry});w.Image=Image;
  const surfaces=new WeakMap();
  function surface(el) {
    let canvas=surfaces.get(el);
    if(!canvas || canvas.width!==el.width || canvas.height!==el.height) {
      canvas=createCanvas(el.width||300,el.height||150);surfaces.set(el,canvas);
      const ctx=canvas.getContext('2d'), original=ctx.drawImage.bind(ctx);
      ctx.drawImage=(image,...args)=>original(image instanceof w.HTMLCanvasElement ? surface(image) : image,...args);
    }
    return canvas;
  }
  w.HTMLCanvasElement.prototype.getContext=function(){return surface(this).getContext('2d');};
  w.HTMLCanvasElement.prototype.toDataURL=function(){return surface(this).toDataURL('image/png');};
  w.HTMLCanvasElement.prototype.toBlob=function(cb){cb(new w.Blob([surface(this).toBuffer('image/png')]));};
  let barcode='6970000000001', failure=false;
  w.Niimbot={VERSION:'test',isSupported:()=>true,identify:async(model)=>{identifiedModels.push(model);return {modelId:4096};},probe:async()=>({cmd:0xde,data:[0,0,0,0,1,128]}),disconnect:async()=>{},getStatus:async()=>({decoded:{rfid:{tagPresent:true,barCode:barcode,usedPaper:5,capacity:100}},confidence:'inferred'}),printImage:async(url,opts)=>{calls.push({url,opts});if(failure)throw new Error('Page not confirmed');opts.onProgress('ok');}};
  w.eval(read('vendor/niimbot/label-memory.js'));w.eval(read('vendor/qrcode/qrcode.js'));w.eval(read('vendor/qrcode/qrcode_UTF8.js'));
  w.eval(read('image-transfer.js').replaceAll('export ','')+'\n'+read('label.js').replaceAll('export ','').replace(/^import[^\n]+\n/gm,'')+'\n'+read('app.js').replace(/^import[^\n]+\n/gm,''));
  await ready(()=>w.document.getElementById('model').options.length>0);
  const el=id=>w.document.getElementById(id);
  const change=(id,value)=>{el(id).value=value;el(id).dispatchEvent(new w.Event('input',{bubbles:true}));};
  return {dom,w,calls,identifiedModels,el,change,setBarcode:v=>barcode=v,setFailure:v=>failure=v};
}
test('pair, restore roll size, and print the exact preview bitmap',async()=>{
  const h=await harness();try {
    h.el('connect').click();await ready(()=>!h.el('read-roll').disabled);
    assert.deepEqual(Array.from(h.identifiedModels[0].name_prefixes),['B1']);
    assert.equal(h.el('model').value,'b1');assert.match(h.el('roll-info').textContent,/6970000000001/);
    h.change('width','40');h.change('height','60');h.el('remember-roll').click();
    h.change('width','50');h.change('height','30');h.el('read-roll').click();
    await ready(()=>h.el('width').value==='40'&&!h.el('read-roll').disabled);
    h.change('copies','3');h.change('density','4');
    const bitmap=h.el('preview').toDataURL();h.el('print').click();await ready(()=>h.calls.length===1&&!h.el('print').disabled);
    assert.equal(h.calls[0].url,bitmap);assert.equal(h.calls[0].opts.copies,3);assert.equal(h.calls[0].opts.density,4);assert.equal(h.calls[0].opts.offsetY,0);
    assert.equal(h.calls[0].opts.size.w_px,320);assert.equal(h.calls[0].opts.size.h_px,480);
  } finally {h.dom.window.close();}
});
test('invalid copies cannot print, and failed jobs never report success',async()=>{
  const h=await harness();try {
    h.el('connect').click();await ready(()=>!h.el('print').disabled);
    h.change('copies','0');h.el('print').click();await ready(()=>/whole number/.test(h.el('message').textContent));assert.equal(h.calls.length,0);
    h.change('copies','1');h.setFailure(true);h.el('print').click();await ready(()=>/Some labels may have printed/.test(h.el('message').textContent));
    assert.equal(h.calls.length,1);assert.equal(h.el('print').disabled,true);assert.equal(h.el('connect').hidden,false);
  } finally {h.dom.window.close();}
});
test('changed roll requires review; invalid QR cannot reuse the old preview',async()=>{
  const h=await harness();try {
    h.el('connect').click();await ready(()=>!h.el('print').disabled);
    h.setBarcode('6970000000002');h.el('print').click();await ready(()=>/roll changed/.test(h.el('message').textContent));assert.equal(h.calls.length,0);
    h.change('qr','');assert.equal(h.el('print').disabled,true);assert.equal(h.el('download').disabled,true);assert.match(h.el('render-error').textContent,/QR content/);
  } finally {h.dom.window.close();}
});
test('an unavailable RFID response does not block printing or save a stale roll',async()=>{
  const h=await harness();try {
    h.el('connect').click();await ready(()=>!h.el('print').disabled);
    h.w.Niimbot.getStatus=async()=>{throw new Error('No response');};
    h.el('print').click();await ready(()=>h.calls.length===1&&!h.el('print').disabled);
    assert.match(h.el('roll-info').textContent,/unavailable/);assert.equal(h.el('remember-roll').disabled,true);
    const key='little-label-studio:/labels/:rolls';assert.equal(h.w.localStorage.getItem(key),null);
  } finally {h.dom.window.close();}
});
test('design import applies size, text, and raster artwork together',async()=>{
  const h=await harness();try {
    const img=createCanvas(100,50);img.getContext('2d').fillRect(10,10,80,30);
    const design={mode:'image',qr:'https://example.com',layout:'only',title:'TEST ART',subtitle:'',fontSize:3,margin:.5,border:true,rotation:0,threshold:160,offset:0,width:40,height:30,art:img.toDataURL('image/png')};
    Object.defineProperty(h.el('design-file'),'files',{value:[{size:1024,text:async()=>JSON.stringify({version:1,design})}],configurable:true});
    h.el('design-file').dispatchEvent(new h.w.Event('change'));
    await ready(()=>/Design imported/.test(h.el('message').textContent));
    assert.equal(h.el('width').value,'40');assert.equal(h.el('title').value,'TEST ART');assert.equal(h.el('border').checked,true);
    assert.equal(h.el('tab-image').getAttribute('aria-selected'),'true');assert.equal(h.el('border-inset').value,'0.25');assert.equal(h.el('render-error').hidden,true);assert.equal(h.el('download').disabled,false);
  } finally {h.dom.window.close();}
});
test('portrait use previews upright while printing rotated text on the original roll',async()=>{
  const h=await harness();try {
    h.el('tab-text').click();h.change('title','PORTRAIT');h.change('subtitle','Line one\nLine two');
    h.el('connect').click();await ready(()=>!h.el('print').disabled);
    for (const rotation of ['90','270']) {
      h.change('rotation',rotation);
      assert.equal(h.el('render-error').hidden,true);
      assert.equal(h.el('width').value,'50');assert.equal(h.el('height').value,'30');
      assert.equal(h.el('label-paper').style.aspectRatio,'30/50');
      assert.equal(h.el('display-preview').width,240);assert.equal(h.el('display-preview').height,384);
      assert.match(h.el('orientation-note').textContent,/Used upright: 30 × 50 mm/);
      const printBitmap=h.el('preview').toDataURL();
      assert.notEqual(h.el('display-preview').toDataURL(),printBitmap);
      h.el('preview-view').value='printer';h.el('preview-view').dispatchEvent(new h.w.Event('change'));
      assert.equal(h.el('label-paper').style.aspectRatio,'50/30');
      assert.equal(h.el('display-preview').toDataURL(),printBitmap);
      h.el('preview-view').value='used';h.el('preview-view').dispatchEvent(new h.w.Event('change'));
      const before=h.calls.length;h.el('print').click();await ready(()=>h.calls.length===before+1&&!h.el('print').disabled);
      assert.equal(h.calls.at(-1).url,printBitmap);
      assert.equal(h.calls.at(-1).opts.size.w_px,384);assert.equal(h.calls.at(-1).opts.size.h_px,240);
    }
  } finally {h.dom.window.close();}
});
test('compact QR margins enlarge an existing design without changing its orientation or roll',async()=>{
  const h=await harness();try {
    h.change('rotation','90');h.change('layout','side');h.change('margin','2');
    h.el('compact-qr').click();
    assert.equal(h.el('margin').value,'0.5');assert.equal(h.el('rotation').value,'90');
    assert.equal(h.el('width').value,'50');assert.equal(h.el('height').value,'30');
    assert.equal(h.el('layout').value,'side');assert.equal(h.el('render-error').hidden,true);
  } finally {h.dom.window.close();}
});
test('a fragment image opens as crisp artwork, clears sample text, and never auto-prints',async()=>{
  const image=createCanvas(232,232);image.getContext('2d').fillRect(24,24,184,184);
  const hash='#'+new URLSearchParams({image:image.toDataURL('image/png'),name:'Stego QR'});
  const h=await harness(hash);try {
    await ready(()=>/Image received/.test(h.el('message').textContent));
    assert.equal(h.el('tab-image').getAttribute('aria-selected'),'true');
    assert.equal(h.el('image-scaling').value,'crisp');assert.equal(h.el('title').value,'');assert.equal(h.el('subtitle').value,'');
    assert.equal(h.el('art-name').textContent,'Stego QR');assert.equal(h.el('render-error').hidden,true);
    assert.equal(h.calls.length,0);assert.equal(h.w.location.hash,'');
    h.change('image-scaling','smooth');assert.equal(h.el('render-error').hidden,true);
  } finally {h.dom.window.close();}
});

test('custom grid transfer selects a dedicated mode and keeps the grid intact through label edits',async()=>{
  const modules=Array.from({length:21},(_,r)=>Array.from({length:21},(_,c)=>(r+c)%2===0));
  const hash=new URL(createLabelGridUrl('https://example.com/',modules,'Stego grid')).hash;
  const h=await harness(hash);try {
    await ready(()=>/Custom QR received/.test(h.el('message').textContent));
    assert.equal(h.el('tab-custom').getAttribute('aria-selected'),'true');assert.equal(h.el('panel-qr').hidden,true);
    assert.equal(h.el('qr-layout-controls').hidden,false);assert.match(h.el('custom-info').textContent,/21 × 21/);
    h.change('rotation','90');h.change('title','My QR');h.change('layout','stack');
    h.el('tab-qr').click();h.change('qr','different text');h.el('tab-custom').click();
    const stored=JSON.parse(h.w.localStorage.getItem('little-label-studio:/labels/:draft')).design;
    assert.deepEqual(stored.grid,packQrGrid(modules));assert.equal(stored.mode,'custom');
    assert.equal(h.el('render-error').hidden,true);assert.equal(h.w.location.hash,'');
    h.el('connect').click();await ready(()=>!h.el('print').disabled);
    h.el('print').click();await ready(()=>h.calls.length===1&&!h.el('print').disabled);
    assert.equal(h.calls[0].url,h.el('preview').toDataURL());
  } finally {h.dom.window.close();}
});
test('rotating a QR label defaults to above/below in the upright view and allows an explicit side layout',async()=>{
  const h=await harness();try {
    h.el('preview-view').value='printer';h.el('preview-view').dispatchEvent(new h.w.Event('change'));
    h.change('layout','side');h.change('rotation','90');
    assert.equal(h.el('layout').value,'stack');assert.equal(h.el('preview-view').value,'used');
    assert.equal(h.el('render-error').hidden,true);
    h.change('layout','side');assert.equal(h.el('layout').value,'side');
    h.change('layout','only');h.change('rotation','270');assert.equal(h.el('layout').value,'only');
  } finally {h.dom.window.close();}
});
test('zero feed offset has no hidden model correction unless explicitly enabled',async()=>{
  const h=await harness();try {
    h.change('rotation','90');h.change('offset','0');
    assert.equal(h.el('model-calibration').checked,false);assert.match(h.el('size-note').textContent,/Feed correction: 0 px/);
    h.el('model-calibration').checked=true;h.el('model-calibration').dispatchEvent(new h.w.Event('input'));
    assert.match(h.el('size-note').textContent,/Feed correction: 4 px/);
    h.el('model-calibration').checked=false;h.el('model-calibration').dispatchEvent(new h.w.Event('input'));
    assert.match(h.el('size-note').textContent,/Feed correction: 0 px/);
  } finally {h.dom.window.close();}
});
test('all nudge buttons use as-printed directions at every artwork rotation',async()=>{
  const h=await harness();try {
    for (const rotation of ['0','90','180','270']) {
      h.change('rotation',rotation);
      h.change('offset-x','0');h.change('offset','0');
      h.w.document.querySelector('[data-nudge="down"]').click();
      assert.equal(h.el('offset-x').value,'0');assert.equal(h.el('offset').value,'0.1');
      h.w.document.querySelector('[data-nudge="left"]').click();
      assert.equal(h.el('offset-x').value,'-0.1');assert.equal(h.el('offset').value,'0.1');
      assert.equal(h.el('preview-view').value,'printer');
      const saved=JSON.parse(h.w.localStorage.getItem('little-label-studio:/labels/:draft')).design;
      assert.equal(saved.offsetX,-.1);assert.equal(saved.offset,.1);
      h.w.document.querySelector('[data-nudge="up"]').click();
      h.w.document.querySelector('[data-nudge="right"]').click();
      assert.equal(h.el('offset-x').value,'0');assert.equal(h.el('offset').value,'0');
      assert.equal(h.el('render-error').hidden,true);
    }
  } finally {h.dom.window.close();}
});

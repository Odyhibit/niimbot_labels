import { packQrGrid } from '../image-transfer.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createCanvas } from '@napi-rs/canvas';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { geometry, renderLabel, validateDesign } from '../label.js';
const require = createRequire(import.meta.url);
const jsQR = require('jsqr');
const qrScope = {}; vm.createContext(qrScope);
for (const path of ['qrcode.js', 'qrcode_UTF8.js']) vm.runInContext(readFileSync(new URL(`../vendor/qrcode/${path}`, import.meta.url), 'utf8'), qrScope);
const registry = JSON.parse(readFileSync(new URL('../vendor/niimbot/registry.json', import.meta.url)));
const spec = { mode:'qr', qr:'https://example.com', layout:'side', title:'A place for everything', subtitle:'And everything in its place.\nEST. 2026', fontSize:3, margin:2, border:false, rotation:0, threshold:160, offset:0, width:50, height:30, art:null };
const makeCanvas = () => createCanvas(1,1);
function bitmap(design, model = 'b1') {
  const geo = geometry(registry,model,design.width,design.height);
  const canvas = makeCanvas(); const result = renderLabel(canvas,design,geo,qrScope.qrcode,null,makeCanvas);
  return {canvas,geo,result};
}
function decode(canvas) { const rgba = canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height); return jsQR(new Uint8ClampedArray(rgba.data),canvas.width,canvas.height)?.data; }
test('model-specific geometry preserves calibration and clamps to actual head', () => {
  assert.equal(geometry(registry,'b1',50,30).w_px,384);
  assert.equal(geometry(registry,'b1',50,30).offset_y_px,4);
  assert.equal(geometry(registry,'b1pro',50,30).w_px,576);
  assert.equal(geometry(registry,'m2h',50,30,576).w_px,567);
  assert.equal(geometry(registry,'d11h',50,30).w_px,144);
  assert.equal(geometry(registry,'n1',14,50).offset_y_px,-1);
  assert.equal(geometry(registry,'d110',15,50).offset_y_px,-2);
  assert.equal(geometry(registry,'b1',40,60,300).w_px,300);
  assert.throws(() => geometry(registry,'b1',NaN,30));
  assert.throws(() => geometry(registry,'b1',50,1000));
});
test('QR decodes at native print resolution across models, layouts, and rotation', () => {
  for (const model of ['b1','b1pro','b2pro','m2h']) for (const layout of ['side','stack','only']) for (const rotation of [0,90,180,270]) {
    // Rotated side layouts have less width; use QR only for long UTF-8 strings below.
    const d = {...spec,layout,rotation};
    const {canvas} = bitmap(d,model);
    assert.equal(decode(canvas),d.qr,`${model}/${layout}/${rotation}`);
  }
  const d = {...spec, layout:'only', qr:'Café • 工具 🔧'};
  assert.equal(decode(bitmap(d).canvas),d.qr);
});
test('output is opaque monochrome, and unusable QR layouts are rejected', () => {
  const {canvas} = bitmap(spec);
  const data = canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
  for (let i=0;i<data.length;i+=4) { assert.ok(data[i]===0 || data[i]===255); assert.equal(data[i],data[i+1]); assert.equal(data[i],data[i+2]); assert.equal(data[i+3],255); }
  assert.throws(() => bitmap({...spec,qr:'x'.repeat(1800)}),/dense|long/);
  assert.throws(() => bitmap({...spec,qr:''}),/QR content/);
  assert.throws(() => bitmap({...spec,width:5,height:5,margin:3}),/Margins/);
  mkdirSync('/tmp/little-label-qa',{recursive:true}); writeFileSync('/tmp/little-label-qa/default-preview.png',canvas.toBuffer('image/png'));
});
test('artwork keeps its aspect ratio and thresholds onto a white background', () => {
  const image = createCanvas(80,40), ctx = image.getContext('2d');
  ctx.fillStyle = '#111'; ctx.fillRect(0,0,40,40); ctx.fillStyle='#bbb';ctx.fillRect(40,0,40,40);
  const canvas=makeCanvas(), geo=geometry(registry,'b1',50,30);
  renderLabel(canvas,{...spec,mode:'image',title:'',subtitle:''},geo,qrScope.qrcode,image,makeCanvas);
  const out=canvas.getContext('2d');
  assert.equal(out.getImageData(50,120,1,1).data[0],0);
  assert.equal(out.getImageData(300,120,1,1).data[0],255);
  assert.equal(out.getImageData(50,20,1,1).data[0],255);
});
test('design import rejects invalid settings before they affect printing', () => {
  assert.deepEqual(validateDesign({version:1,design:spec}),spec);
  for (const bad of [{width:-1},{margin:100},{rotation:45},{threshold:Infinity},{art:'https://external/image.png'},{mode:'script'},{qr:'x'.repeat(1801)}]) assert.throws(() => validateDesign({version:1,design:{...spec,...bad}}));
});
test('90-degree text prints as a rotated portrait composition, including all text lines',()=>{
  const geo={...geometry(registry,'b1',50,30),offset_y_px:0};
  const portrait=createCanvas(geo.h_px,geo.w_px);
  const d={...spec,mode:'text',title:'PORTRAIT',subtitle:'Line one\nLine two',rotation:0};
  renderLabel(portrait,d,{...geo,w_px:geo.h_px,h_px:geo.w_px},qrScope.qrcode,null,makeCanvas);
  for (const angle of [90,270]) {
    const actual=makeCanvas();renderLabel(actual,{...d,rotation:angle},geo,qrScope.qrcode,null,makeCanvas);
    const expected=createCanvas(geo.w_px,geo.h_px),ctx=expected.getContext('2d');
    ctx.translate(geo.w_px/2,geo.h_px/2);ctx.rotate(angle*Math.PI/180);ctx.drawImage(portrait,-portrait.width/2,-portrait.height/2);
    assert.deepEqual(actual.getContext('2d').getImageData(0,0,geo.w_px,geo.h_px).data,ctx.getImageData(0,0,geo.w_px,geo.h_px).data);
  }
});
test('QR layouts devote more space to the code while remaining scannable with compact margins',()=>{
  const side=bitmap(spec), stacked=bitmap({...spec,layout:'stack'});
  assert.ok(side.result.qrInfo.modulePx>5,'larger than the previous 5-pixel side-layout modules');
  assert.ok(stacked.result.qrInfo.modulePx>4,'larger than the previous 4-pixel stacked-layout modules');
  for(const layout of ['side','stack','only']) for(const rotation of [0,90,180,270]) {
    const d={...spec,margin:.5,layout,rotation};
    assert.equal(decode(bitmap(d).canvas),d.qr,`${layout}/${rotation}/compact`);
  }
});
test('thin border stays centered and entirely visible with compact margins and feed corrections',()=>{
  const blank=createCanvas(1,1);
  for(const model of ['b1','b1pro']) for(const rotation of [0,90,180,270]) for(const offset of [-5,0,5]) {
    const geo=geometry(registry,model,50,30),canvas=makeCanvas();
    renderLabel(canvas,{...spec,mode:'image',title:'',subtitle:'',margin:.5,border:true,rotation,offset},geo,qrScope.qrcode,blank,makeCanvas);
    const data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
    const inset=Math.max(1,Math.round(Math.round(.5*geo.dpi/25.4)/2));
    const thickness=Math.max(1,Math.round(geo.dpi/25.4*.2));
    for(let y=0;y<canvas.height;y++) for(let x=0;x<canvas.width;x++) {
      const inside=x>=inset && x<canvas.width-inset && y>=inset && y<canvas.height-inset;
      const edge=x<inset+thickness || x>=canvas.width-inset-thickness || y<inset+thickness || y>=canvas.height-inset-thickness;
      assert.equal(data[(y*canvas.width+x)*4],inside&&edge?0:255,`${model}/${rotation}/${offset} at ${x},${y}`);
    }
  }
});
test('crisp imported QR images stay decodable and do not gain smoothed edge pixels',()=>{
  const original=bitmap({...spec,layout:'only',title:'',subtitle:''},'b1pro').canvas;
  for(const rotation of [0,90,180,270]) {
    const d={...spec,mode:'image',title:'',subtitle:'',margin:.5,rotation,imageScaling:'crisp'};
    const geo=geometry(registry,'b1',50,30),a=makeCanvas(),b=makeCanvas();
    renderLabel(a,{...d,threshold:1},geo,qrScope.qrcode,original,makeCanvas);
    renderLabel(b,{...d,threshold:254},geo,qrScope.qrcode,original,makeCanvas);
    assert.equal(decode(a),spec.qr);
    assert.deepEqual(a.getContext('2d').getImageData(0,0,a.width,a.height).data,b.getContext('2d').getImageData(0,0,b.width,b.height).data);
  }
  assert.throws(()=>validateDesign({version:1,design:{...spec,imageScaling:'unknown'}}),/scaling/);
});

test('custom QR draws the exact supplied modules without calling the QR generator',()=>{
  const qr=qrScope.qrcode(0,'M');qr.addData(spec.qr,'Byte');qr.make();
  const modules=Array.from({length:qr.getModuleCount()},(_,r)=>Array.from({length:qr.getModuleCount()},(_,c)=>qr.isDark(r,c)));
  const grid=packQrGrid(modules);
  for(const rotation of [0,90,180,270]) {
    const d={...spec,rotation},expected=bitmap(d),actual=makeCanvas();
    renderLabel(actual,{...d,mode:'custom',grid},expected.geo,()=>{throw new Error('Must not regenerate');},null,makeCanvas);
    assert.deepEqual(actual.getContext('2d').getImageData(0,0,actual.width,actual.height).data,expected.canvas.getContext('2d').getImageData(0,0,actual.width,actual.height).data);
    assert.equal(decode(actual),spec.qr);
    assert.equal(validateDesign({version:1,design:{...d,mode:'custom',grid}}).grid.data,grid.data);
  }
});

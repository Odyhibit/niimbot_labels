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
test('thin border moves with feed correction and reports clipping at the bitmap edges',()=>{
  const blank=createCanvas(1,1);
  for(const model of ['b1','b1pro']) for(const rotation of [0,90,180,270]) for(const offset of [-5,0,5]) {
    const geo=geometry(registry,model,50,30),canvas=makeCanvas();
    const info=renderLabel(canvas,{...spec,mode:'image',title:'',subtitle:'',margin:.5,border:true,rotation,offset},geo,qrScope.qrcode,blank,makeCanvas);
    const data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
    const inset=Math.max(1,Math.round(Math.round(.5*geo.dpi/25.4)/2));
    const thickness=Math.max(1,Math.round(geo.dpi/25.4*.2));
    for(let y=0;y<canvas.height;y++) for(let x=0;x<canvas.width;x++) {
      const sourceY=y-info.offset;
      const inside=x>=inset && x<canvas.width-inset && sourceY>=inset && sourceY<canvas.height-inset;
      const edge=x<inset+thickness || x>=canvas.width-inset-thickness || sourceY<inset+thickness || sourceY>=canvas.height-inset-thickness;
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
test('stacked captions are centered below the actual QR or artwork within the bottom margin',()=>{
  const art=createCanvas(80,80);art.getContext('2d').fillRect(0,0,80,80);
  for(const mode of ['qr','custom','image']) for(const rotation of [0,90,270]) {
    const calls=[],rects=[],images=[];
    const factory=()=>{
      const canvas=makeCanvas(),ctx=canvas.getContext('2d');
      const text=ctx.fillText.bind(ctx),rect=ctx.fillRect.bind(ctx),draw=ctx.drawImage.bind(ctx);
      ctx.fillText=(value,x,y,...rest)=>{calls.push({value,x,y});return text(value,x,y,...rest);};
      ctx.fillRect=(x,y,w,h)=>{if(['#000','#000000'].includes(ctx.fillStyle))rects.push({x,y,w,h});return rect(x,y,w,h);};
      ctx.drawImage=(img,x,y,w,h)=>{images.push({x,y,w,h});return draw(img,x,y,w,h);};
      return canvas;
    };
    const modules=Array.from({length:21},()=>Array(21).fill(true));
    const d={...spec,mode,grid:packQrGrid(modules),rotation,layout:'stack',title:'TITLE',subtitle:'Details'};
    const geo=geometry(registry,'b1',50,30),out=makeCanvas();
    const result=renderLabel(out,d,geo,qrScope.qrcode,art,factory);
    assert.equal(calls[0].value,'TITLE');
    const bottom=mode==='image'?images[0].y+images[0].h:Math.max(...rects.map(r=>r.y+r.h));
    const distance=calls[0].y-bottom;
    assert.ok(distance>0,`${mode}/${rotation} caption below image`);
    const px=geo.dpi/25.4,margin=Math.round(d.margin*px),gap=Math.round(1.5*px);
    const imageBottom=bottom+(mode==='image'?0:result.qrInfo.modulePx);
    const workHeight=[90,270].includes(rotation)?geo.w_px:geo.h_px;
    const expectedCenter=(imageBottom+gap+workHeight-margin)/2;
    const actualCenter=(calls[0].y+calls.at(-1).y)/2;
    assert.ok(Math.abs(actualCenter-expectedCenter)<.01,`${mode}/${rotation} caption center ${actualCenter}, expected ${expectedCenter}`);
  }
});
test('ordinary QR exports from local and GitHub stay centered with zero feed offset',()=>{
  for(const name of ['local','github']) {
    const d=JSON.parse(readFileSync(new URL(`./fixtures/alignment-${name}.json`,import.meta.url))).design;
    for(const rotation of [0,90,180,270]) for(const modelCalibration of [false,true]) {
      const {canvas,geo,result}=bitmap({...d,rotation,modelCalibration});
      const used=createCanvas(rotation%180?canvas.height:canvas.width,rotation%180?canvas.width:canvas.height),ctx=used.getContext('2d');
      ctx.translate(used.width/2,used.height/2);ctx.rotate(-rotation*Math.PI/180);ctx.drawImage(canvas,-canvas.width/2,-canvas.height/2);
      const rgba=ctx.getImageData(0,0,used.width,used.height),decoded=jsQR(new Uint8ClampedArray(rgba.data),used.width,used.height);
      assert.equal(decoded.data,d.qr);
      const loc=decoded.location,center=(loc.topLeftCorner.x+loc.topRightCorner.x+loc.bottomLeftCorner.x+loc.bottomRightCorner.x)/4;
      const shift=modelCalibration?(rotation===90?4:rotation===270?-4:0):0;
      assert.ok(Math.abs(center-used.width/2-shift)<=.51,`${name}/${rotation}/${modelCalibration}: ${center}`);
      assert.equal(result.offset,modelCalibration?geo.offset_y_px:0);
      // Border is centered across the head in the actual printer bitmap.
      const row=canvas.getContext('2d').getImageData(0,Math.floor(canvas.height/2),canvas.width,1).data;
      const black=[];for(let x=0;x<canvas.width;x++)if(row[x*4]===0)black.push(x);
      assert.equal((black[0]+black.at(-1)+1)/2,canvas.width/2);
    }
  }
});
test('registration moves the full border and QR together without resizing modules',()=>{
  const d={...spec,layout:'stack',rotation:90,border:true,borderInset:2};
  const base=bitmap(d),shifted=bitmap({...d,offsetX:-.3,offset:.4});
  assert.equal(shifted.result.qrInfo.modulePx,base.result.qrInfo.modulePx);
  assert.equal(shifted.result.offsetX,-2);assert.equal(shifted.result.offset,3);
  assert.equal(shifted.result.borderClipped,false);
  const a=base.canvas.getContext('2d').getImageData(0,0,base.canvas.width,base.canvas.height).data;
  const b=shifted.canvas.getContext('2d').getImageData(0,0,shifted.canvas.width,shifted.canvas.height).data;
  for(let y=0;y<base.canvas.height;y++)for(let x=0;x<base.canvas.width;x++) {
    const sx=x+2,sy=y-3;
    const expected=sx>=0&&sx<base.canvas.width&&sy>=0&&sy<base.canvas.height?a[(sy*base.canvas.width+sx)*4]:255;
    assert.equal(b[(y*base.canvas.width+x)*4],expected);
  }
  assert.equal(bitmap({...d,borderInset:.1,offsetX:1}).result.borderClipped,true);
});

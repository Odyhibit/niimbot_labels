import test from 'node:test';
import assert from 'node:assert/strict';
import { createLabelImageUrl, readImageFragment, MAX_IMAGE_LINK_LENGTH, packQrGrid, unpackQrGrid, createLabelGridUrl, readGridFragment } from '../image-transfer.js';
test('base64 image links preserve plus, slash, padding, and Unicode names',()=>{
  const image='data:image/png;base64,Ab+/AA==';
  const url=new URL(createLabelImageUrl('https://example.com/labels/?view=editor',image,'Café QR'));
  assert.equal(url.search,'?view=editor');assert.equal(url.pathname,'/labels/');
  assert.ok(url.hash.includes('%2B'));assert.deepEqual(readImageFragment(url.hash),{image,name:'Café QR'});
});
test('transfer validates format and caps link size with a file fallback',()=>{
  assert.equal(readImageFragment('#about'),null);
  for(const value of ['https://example.com/image.png','data:image/svg+xml;base64,AAAA','data:image/png;base64,not valid']) assert.throws(()=>createLabelImageUrl('https://example.com/',value));
  assert.throws(()=>createLabelImageUrl('javascript:alert(1)','data:image/png;base64,AAAA'));
  assert.throws(()=>createLabelImageUrl('https://example.com/','data:image/png;base64,'+'A'.repeat(MAX_IMAGE_LINK_LENGTH)),/too large/);
  assert.throws(()=>readImageFragment('#image='+'A'.repeat(MAX_IMAGE_LINK_LENGTH)),/too large/);
});

test('packed grids round-trip every QR width with exact row boundaries and final-bit padding',()=>{
  for(let size=21;size<=177;size+=4) {
    const modules=Array.from({length:size},(_,y)=>Array.from({length:size},(_,x)=>(x*7+y*3)%11<5));
    const packed=packQrGrid(modules);
    assert.deepEqual(unpackQrGrid(packed),modules);
    const link=new URL(createLabelGridUrl('https://example.com/labels/',modules,'Hidden QR'));
    assert.deepEqual(readGridFragment(link.hash),{grid:packed,name:'Hidden QR'});
    assert.ok(link.href.length<6000);
  }
});
test('bad grid lengths, padding, dimensions, and module values are rejected',()=>{
  const modules=Array.from({length:21},()=>Array(21).fill(false)),grid=packQrGrid(modules);
  assert.throws(()=>unpackQrGrid({...grid,size:22}));
  assert.throws(()=>unpackQrGrid({...grid,data:grid.data.slice(1)}));
  const bytes=new Uint8Array(56);bytes[55]=1;
  assert.throws(()=>unpackQrGrid({size:21,data:btoa(String.fromCharCode(...bytes)).replace(/=+$/,'')}),/padding/);
  modules[0][0]='black';assert.throws(()=>packQrGrid(modules));
});

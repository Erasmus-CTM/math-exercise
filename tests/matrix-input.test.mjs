import {matrixInputSource} from './helpers/ctm-libs.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = matrixInputSource;
const context = vm.createContext({});
vm.runInContext(source, context);
const API = context.MatrixInput;
const axis = (initial, min = initial, max = initial) => ({auto: min !== max, initial, min, max});

test('standalone editor renders bounded fixed and resizable axes without a runtime', () => {
  const rendered = API.create({idPrefix: 'answer'}).renderHTML({name:'A',rows:axis(2),cols:axis(1,1,3)});
  assert.equal(rendered.ids.length, 2);
  assert.match(rendered.html, /data-auto-cols="true"/);
  assert.match(rendered.html, /data-max-cols="3"/);
  assert.match(rendered.html, /id="answer-dm-A-2-1"/);
});

test('zero dimensions require explicit canonicalization policy', () => {
  const spec = {name:'A',rows:axis(2),cols:axis(0,0,3)};
  assert.throws(() => API.create().renderHTML(spec), /dimension bound/);
  const rendered = API.create({zeroDimensions:'canonical'}).renderHTML(spec);
  assert.equal(rendered.ids.length, 0);
  assert.match(rendered.html, /data-rows="0" data-cols="0"/);
});

test('invalid dimensions, inconsistent bounds and total entry maxima fail early', () => {
  for (const rows of [axis(21),axis(1.5),axis(3,1,2),{auto:false,initial:2,min:1,max:3}]) {
    assert.throws(() => API.create().renderHTML({name:'A',rows,cols:axis(2)}), /matrix-input/);
  }
  assert.throws(() => API.create({maxEntries:3}).renderHTML({name:'A',rows:axis(2),cols:axis(2)}), /entry bound/);
});

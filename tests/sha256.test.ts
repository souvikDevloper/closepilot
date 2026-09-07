import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sha256 } from '../lib/sha256.ts';

test('portable receipt hashing agrees with Node crypto at every padding boundary', () => {
  for (const size of [0,1,55,56,57,63,64,65,119,120,127,128,129,1024]) {
    for (const token of ['a','₹','🥭','\ud800']) {
      const message=token.repeat(size);
      assert.equal(sha256(message),createHash('sha256').update(message).digest('hex'),`${size}:${token}`);
    }
  }
});

test('large UTF-8 receipt hashes match an independent implementation', () => {
  const message='RZP ₹ merchant receipt '.repeat(200000);
  assert.equal(sha256(message),createHash('sha256').update(message).digest('hex'));
});

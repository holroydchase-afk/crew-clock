// node --test messenger/   Three people, a late joiner, and a server that only sees ciphertext.
import test from 'node:test';
import assert from 'node:assert';
import * as MLS from './src/mls.js';

test('group chat: create, add, late add, decrypt; server sees no plaintext', async () => {
  const dad = await MLS.newKeyPackage('dad');
  const jake = await MLS.newKeyPackage('jake');
  const cody = await MLS.newKeyPackage('cody');
  let dadS = await MLS.startGroup('g1', dad);
  const add1 = await MLS.addMembers(dadS, [jake.publicB64]);
  dadS = add1.stateB64;
  let jakeS = await MLS.join(add1.welcomeB64, jake);
  const m1 = await MLS.encrypt(dadS, 'Be at Smith kitchen at 7, bring the nail gun');
  dadS = m1.stateB64;
  assert.ok(!atob(m1.cipherB64).includes('Smith'), 'plaintext leaked into ciphertext');
  const r1 = await MLS.decrypt(jakeS, m1.cipherB64);
  jakeS = r1.stateB64;
  assert.strictEqual(r1.text, 'Be at Smith kitchen at 7, bring the nail gun');

  // Dad adds Cody later; Jake processes the commit, then reads Cody's message.
  const add2 = await MLS.addMembers(dadS, [cody.publicB64]);
  dadS = add2.stateB64;
  const c = await MLS.decrypt(jakeS, add2.commitB64);
  jakeS = c.stateB64;
  assert.strictEqual(c.text, null);
  let codyS = await MLS.join(add2.welcomeB64, cody);
  assert.strictEqual(MLS.epochOf(codyS), MLS.epochOf(jakeS));
  assert.deepStrictEqual(MLS.members(codyS).sort(), ['cody', 'dad', 'jake']);
  const m2 = await MLS.encrypt(codyS, 'Running 10 min late');
  codyS = m2.stateB64;
  assert.strictEqual((await MLS.decrypt(jakeS, m2.cipherB64)).text, 'Running 10 min late');
  assert.strictEqual((await MLS.decrypt(dadS, m2.cipherB64)).text, 'Running 10 min late');

  // Cody cannot read what was said before he joined (forward secrecy for new members).
  await assert.rejects(MLS.decrypt(codyS, m1.cipherB64));
});

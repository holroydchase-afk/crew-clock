// End-to-end encrypted group chat with MLS (RFC 9420) via ts-mls.
// Bundled to js/vendor/crew-mls.js by `npm run build` in this folder.
// Stateless API: every call takes and returns the group state as base64, so the
// app can keep it in IndexedDB and the server only ever relays ciphertext.
import {
  createApplicationMessage, createCommit, createGroup, joinGroup, processMessage,
  getCiphersuiteImpl, getCiphersuiteFromName, defaultCapabilities, defaultLifetime,
  emptyPskIndex, generateKeyPackage, encodeMlsMessage, decodeMlsMessage,
  encodeGroupState, decodeGroupState, zeroOutUint8Array, acceptAll,
} from 'ts-mls';
import { defaultClientConfig } from 'ts-mls/clientConfig.js';

// X25519 + AES-128-GCM + Ed25519: the fastest suite, so it runs well on cheap phones.
const SUITE = 'MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519';
let implPromise = null;
const impl = () => (implPromise = implPromise || getCiphersuiteImpl(getCiphersuiteFromName(SUITE)));
const enc = new TextEncoder();
const dec = new TextDecoder();

function toB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

const saveState = (state) => toB64(encodeGroupState(state));
function loadState(b64) {
  const d = decodeGroupState(fromB64(b64), 0);
  if (!d) throw new Error('Bad group state');
  return Object.assign({}, d[0], { clientConfig: defaultClientConfig });
}
const wire = (m) => toB64(encodeMlsMessage(m));
function unwire(b64) {
  const d = decodeMlsMessage(fromB64(b64), 0);
  if (!d) throw new Error('Bad MLS message');
  return d[0];
}

// identity = { crewId, name }. Returns what to publish (a KeyPackage) and what to keep secret.
export async function newKeyPackage(crewId) {
  const cs = await impl();
  const kp = await generateKeyPackage({ credentialType: 'basic', identity: enc.encode(crewId) },
    defaultCapabilities(), defaultLifetime, [], cs);
  return {
    publicB64: wire({ keyPackage: kp.publicPackage, wireformat: 'mls_key_package', version: 'mls10' }),
    privatePackage: kp.privatePackage, // plain object of Uint8Arrays; IndexedDB can store it
  };
}

function keyPackageOf(publicB64) {
  const m = unwire(publicB64);
  if (m.wireformat !== 'mls_key_package') throw new Error('Expected a key package');
  return m.keyPackage;
}

export async function startGroup(groupId, mine) {
  const cs = await impl();
  const state = await createGroup(enc.encode(groupId), keyPackageOf(mine.publicB64), mine.privatePackage, [], cs);
  return saveState(state);
}

// Adds people by their published key packages. Send `commit` to the current members
// and `welcome` to the new ones.
export async function addMembers(stateB64, keyPackagesB64) {
  const cs = await impl();
  const proposals = keyPackagesB64.map((k) => ({ proposalType: 'add', add: { keyPackage: keyPackageOf(k) } }));
  const r = await createCommit({ state: loadState(stateB64), cipherSuite: cs }, { extraProposals: proposals, ratchetTreeExtension: true });
  r.consumed.forEach(zeroOutUint8Array);
  return {
    stateB64: saveState(r.newState),
    commitB64: wire(r.commit),
    welcomeB64: r.welcome ? wire({ welcome: r.welcome, wireformat: 'mls_welcome', version: 'mls10' }) : null,
    epoch: Number(r.newState.groupContext.epoch),
  };
}

export async function join(welcomeB64, mine) {
  const cs = await impl();
  const m = unwire(welcomeB64);
  if (m.wireformat !== 'mls_welcome') throw new Error('Expected a welcome');
  const state = await joinGroup(m.welcome, keyPackageOf(mine.publicB64), mine.privatePackage, emptyPskIndex, cs);
  return saveState(state);
}

export async function encrypt(stateB64, text) {
  const cs = await impl();
  const r = await createApplicationMessage(loadState(stateB64), enc.encode(text), cs);
  r.consumed.forEach(zeroOutUint8Array);
  return {
    stateB64: saveState(r.newState),
    cipherB64: wire({ privateMessage: r.privateMessage, wireformat: 'mls_private_message', version: 'mls10' }),
  };
}

// Handles both chat messages and commits (someone added to the group).
export async function decrypt(stateB64, cipherB64) {
  const cs = await impl();
  const m = unwire(cipherB64);
  const r = await processMessage(m, loadState(stateB64), emptyPskIndex, acceptAll, cs);
  if (r.consumed) r.consumed.forEach(zeroOutUint8Array);
  return {
    stateB64: saveState(r.newState),
    kind: r.kind,
    text: r.kind === 'applicationMessage' ? dec.decode(r.message) : null,
  };
}

export function epochOf(stateB64) {
  return Number(loadState(stateB64).groupContext.epoch);
}

export function members(stateB64) {
  const s = loadState(stateB64);
  return s.ratchetTree.filter((n) => n && n.nodeType === 'leaf')
    .map((n) => dec.decode(n.leaf.credential.identity));
}

export const SUITE_NAME = SUITE;

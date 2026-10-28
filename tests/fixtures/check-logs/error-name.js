// Made-up fixture for tests/check-logs.test.js: logs only a fixed word and the error's name (must pass).
try { JSON.parse('{'); } catch (e) { console.error('x', e.name); }

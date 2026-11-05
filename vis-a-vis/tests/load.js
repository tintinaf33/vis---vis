/* Charge les modules du moteur dans Node, dans l'ordre déclaré par index.html (source unique). */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const files = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]).filter(f => !f.startsWith('js/ui/app'));
for (const f of files) require(path.join(root, f));
module.exports = globalThis.VAV;

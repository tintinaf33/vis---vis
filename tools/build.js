#!/usr/bin/env node
/*
 * Vis-à-vis : script de construction (Node.js >= 18, aucune dépendance).
 *  1. Régénère js/ui/samples.js à partir des fichiers du dossier samples/.
 *  2. Produit dist/vis-a-vis.html : un fichier unique, autonome, utilisable hors ligne.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const rd = p => fs.readFileSync(path.join(root, p), 'utf8');

// 1. Exemples
const samples = { a: rd('samples/mx104-par1.conf'), b: rd('samples/hpe5520-par1.cfg') };
fs.writeFileSync(path.join(root, 'js/ui/samples.js'),
  '/* Vis-à-vis : configurations d’exemple (fichier généré par tools/build.js, ne pas modifier à la main) */\n' +
  '(function (V) {\n  V.samples = ' + JSON.stringify(samples, null, 2).replace(/\n/g, '\n  ') + ';\n})(globalThis.VAV = globalThis.VAV || {});\n');

// 2. Fichier unique
let html = rd('index.html');
html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (_, href) => '<style>\n' + rd(href) + '</style>');
html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, src) => '<script>\n' + rd(src).replace(/<\/script/gi, '<\\/script') + '</script>');
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/vis-a-vis.html'), html);
console.log('OK : js/ui/samples.js et dist/vis-a-vis.html (' + Math.round(html.length / 1024) + ' Ko)');

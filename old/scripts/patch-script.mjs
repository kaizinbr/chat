import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const srcScript = path.join(root, 'original', 'script.js');
const srcStyle = path.join(root, 'original', 'style.css');
const outScript = path.join(root, 'public', 'js', 'script.js');
const outStyle = path.join(root, 'public', 'css', 'style.css');

function fail(msg) {
  console.error('ERRO: ' + msg);
  process.exit(1);
}

if (!fs.existsSync(srcScript)) fail('arquivo original/script.js nao encontrado.');
if (!fs.existsSync(srcStyle)) fail('arquivo original/style.css nao encontrado.');

let code = fs.readFileSync(srcScript, 'utf8');

// 1) createChatWindow usava document.write (so funciona durante o parse do HTML).
//    Em Next o script carrega depois, entao passa a usar a versao baseada em DOM.
const startMarker = 'function createChatWindow(id) {';
const endMarker = 'function createDynamicChatWindow(id) {';
const startIdx = code.indexOf(startMarker);
const endIdx = code.indexOf(endMarker);
if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
  fail('nao encontrei createChatWindow / createDynamicChatWindow no script.');
}
const newCreate = [
  'function createChatWindow(id) {',
  '    createDynamicChatWindow(id);',
  '}',
  '',
  ''
].join('\n');
code = code.slice(0, startIdx) + newCreate + code.slice(endIdx);

// 2) window.onload nao dispara quando o script e injetado apos o load.
const onloadMarker = 'window.onload = () => {';
if (code.split(onloadMarker).length !== 2) {
  fail('window.onload = () => { deveria aparecer exatamente 1 vez.');
}
code = code.replace(onloadMarker, 'function fwInit() {');

// 3) nome do operador vem de public/js/config.js
const authText = '[AUTH] Usuário: Pedro Elvis Soreas Nobrega';
if (!code.includes(authText)) {
  fail('linha [AUTH] do boot nao encontrada (talvez o texto seja diferente).');
}
code = code.replace(
  authText,
  "[AUTH] Usuário: ${(window.FW_CONFIG && window.FW_CONFIG.agentName) || 'Operador'}"
);

// 4) dispara a inicializacao no fim do arquivo (depois dos let pontoInterval etc.)
code += '\n\nif (document.readyState === \'complete\') {\n    fwInit();\n} else {\n    window.addEventListener(\'load\', fwInit);\n}\n';

fs.mkdirSync(path.dirname(outScript), { recursive: true });
fs.mkdirSync(path.dirname(outStyle), { recursive: true });
fs.writeFileSync(outScript, code);
fs.copyFileSync(srcStyle, outStyle);

console.log('OK: public/js/script.js e public/css/style.css gerados.');

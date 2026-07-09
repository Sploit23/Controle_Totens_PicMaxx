const fs = require('fs');
const src = fs.readFileSync('routes/client.js', 'utf8');

// Find the livePage script section
const idx = src.indexOf('var TOTEM_IDS = ');
const endIdx = src.indexOf('setInterval(poll,10000);', idx);
const scriptContent = src.substring(idx, endIdx + 25);

console.log('=== SCRIPT LENGTH:', scriptContent.length, 'chars ===');

// Backticks and dollar-brace in the template literal
const btCount = (scriptContent.match(/`/g) || []).length;
console.log('Backticks in script:', btCount);

const dbCount = (scriptContent.match(/\$\{/g) || []).length;
console.log('Dollar-brace in script:', dbCount);

// Generate the actual output with test data
const totemIds = ['DESKTOP-SEM-LICENCA'];
const totemData = {
  'DESKTOP-SEM-LICENCA': {
    id: 'DESKTOP-SEM-LICENCA',
    paper_10x15: '120',
    paper_15x20: '80',
    printer_error: '',
    printer_name: 'ASK-400',
    screenshot: '',
    time: '2026-07-09 15:19:22Z'
  }
};

const initialDataJson = JSON.stringify(totemData).replace(/<\//g, '<\\/');
const idsJson = JSON.stringify(totemIds);

// Replace the template variables
let generated = scriptContent
  .replace(/\$\{idsJson\}/g, idsJson)
  .replace(/\$\{initialDataJson\}/g, initialDataJson);

console.log('\n=== GENERATED SCRIPT (first 600 chars) ===');
console.log(generated.substring(0, 600));
console.log('\n=== onerror line ===');
const oerrLine = generated.match(/onerror[^\n]*/);
if (oerrLine) console.log(oerrLine[0].substring(0, 100));

// Try to validate JS syntax using Function constructor
console.log('\n=== SYNTAX CHECK ===');
try {
  new Function(generated);
  console.log('✅ No syntax error');
} catch (e) {
  console.log('❌ Syntax error:', e.message);
  // Find the line number in the generated script
  const m = e.message.match(/at .*?:(\d+)/);
  if (m) {
    const lineNum = parseInt(m[1]);
    const lines = generated.split('\n');
    console.log('Error at line', lineNum, ':', lines[lineNum - 1]);
  }
  // Show context around the error
  for (let i = 1050; i <= 1065; i++) {
    const lines = generated.split('\n');
    if (i <= lines.length) {
      console.log('  Line', i, ':', lines[i - 1]);
    }
  }
}

// Clean up
fs.unlinkSync(__filename);

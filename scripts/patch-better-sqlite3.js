const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'node_modules', 'better-sqlite3', 'src', 'better_sqlite3.cpp');

if (fs.existsSync(filePath)) {
  let content = fs.readFileSync(filePath, 'utf8');
  
  // Replace context->GetIsolate() with v8::Isolate::GetCurrent()
  if (content.includes('context->GetIsolate()')) {
    content = content.replace(
      /v8::Isolate\* isolate = context->GetIsolate\(\);/g,
      'v8::Isolate* isolate = v8::Isolate::GetCurrent();'
    );
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('✓ Patched better-sqlite3 for Electron 39 compatibility');
  } else {
    console.log('✓ better-sqlite3 already patched or patch not needed');
  }
} else {
  console.log('⚠ better-sqlite3 source file not found, skipping patch');
}


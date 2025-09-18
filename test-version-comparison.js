// Test version comparison function
function compareVersions(v1, v2) {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);
  
  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    
    if (p1 < p2) return -1;
    if (p1 > p2) return 1;
  }
  
  return 0;
}

// Test cases
console.log('0.9.10 vs 0.9.9:', compareVersions('0.9.10', '0.9.9')); // Should be 1 (greater)
console.log('0.9.9 vs 0.9.10:', compareVersions('0.9.9', '0.9.10')); // Should be -1 (less)
console.log('0.9.10 vs 0.9.10:', compareVersions('0.9.10', '0.9.10')); // Should be 0 (equal)
console.log('0.10.0 vs 0.9.0:', compareVersions('0.10.0', '0.9.0')); // Should be 1 (greater)
console.log('1.0.0 vs 0.9.9:', compareVersions('1.0.0', '0.9.9')); // Should be 1 (greater) 
// Test script to verify live judge panel functionality
const { spawn } = require('child_process');
const https = require('https');

// Start the dev server if not already running
console.log('Testing live judge panel functionality...');

// Test the judge API endpoint
const options = {
  hostname: 'localhost',
  port: 5173,
  path: '/api/judge',
  method: 'GET',
  timeout: 5000
};

const req = https.request(options, (res) => {
  console.log(`Status Code: ${res.statusCode}`);
  
  if (res.statusCode === 200) {
    console.log('✓ Live judge API endpoint is accessible');
    let data = '';
    res.on('data', (chunk) => {
      data += chunk;
    });
    res.on('end', () => {
      try {
        const jsonData = JSON.parse(data);
        console.log('✓ Judge API response format is valid');
        console.log('Sample response keys:', Object.keys(jsonData));
        console.log('Success field:', jsonData.success);
        if (jsonData.panelState) {
          console.log('Panel state exists');
        }
      } catch (e) {
        console.log('Warning: Could not parse response as JSON');
        console.log('Response preview:', data.substring(0, 100) + '...');
      }
      process.exit(0);
    });
  } else {
    console.log('✗ Live judge API endpoint returned status:', res.statusCode);
    let data = '';
    res.on('data', (chunk) => {
      data += chunk;
    });
    res.on('end', () => {
      console.log('Response body:', data);
      process.exit(1);
    });
  }
});

req.on('error', (e) => {
  console.log('✗ Failed to connect to live judge API:', e.message);
  console.log('Note: This might be because the dev server is not running or the endpoint is not implemented yet.');
  process.exit(1);
});

req.on('timeout', () => {
  console.log('✗ Request to live judge API timed out');
  req.destroy();
  process.exit(1);
});

req.end();
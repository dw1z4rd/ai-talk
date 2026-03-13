import { createTarpitStream } from './src/lib/server/tarpit.js';
import { EventEmitter } from 'node:events';

// Create a mock AbortSignal
class MockAbortSignal extends EventEmitter {
  constructor() {
    super();
    this.aborted = false;
  }
  
  abort() {
    this.aborted = true;
    this.emit('abort');
  }
}

// Create a mock signal
const mockSignal = new MockAbortSignal();

// Create a mock session
const sessionId = 'test-session';
const ip = '127.0.0.1';
const pathname = '/.env';
const startTime = Date.now();

console.log('Testing tarpit stream cancellation...');

// Create the tarpit stream
const stream = createTarpitStream(sessionId, ip, pathname, startTime, mockSignal);

// Create a reader to consume the stream
const reader = stream.getReader();
const decoder = new TextDecoder();

let chunksReceived = 0;

// Read chunks from the stream
async function readStream() {
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        console.log('Stream completed normally');
        break;
      }
      
      chunksReceived++;
      const text = decoder.decode(value);
      console.log(`Received chunk ${chunksReceived}: ${text.substring(0, 50)}...`);
      
      // Abort after a few chunks to simulate bot disconnection
      if (chunksReceived >= 3) {
        console.log('Simulating bot disconnection...');
        mockSignal.abort();
        break;
      }
    }
  } catch (error) {
    console.log('Stream error:', error.message);
  }
}

// Start reading the stream
readStream().then(() => {
  console.log('Test completed');
  console.log('Chunks received:', chunksReceived);
  
  // Exit after a short delay to allow for cleanup
  setTimeout(() => {
    console.log('Exiting test');
    process.exit(0);
  }, 1000);
});
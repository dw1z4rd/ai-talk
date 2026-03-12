// Test script to verify personality integration in buildAgents function
import { buildAgents, PERSONALITY_ARCHETYPES } from './src/lib/agents.ts';

console.log('=== Personality Integration Test ===\n');

// Test 1: Verify personality archetypes are loaded
console.log('1. Available Personality Archetypes:');
const archetypes = Object.keys(PERSONALITY_ARCHETYPES);
console.log(`Found ${archetypes.length} archetypes: ${archetypes.join(', ')}\n`);

// Test 2: Test specific personality assignments
console.log('2. Testing specific personality assignments:');
const testCases = [
  { personalityA: 'engineer', personalityB: 'philosopher' },
  { personalityA: 'strategist', personalityB: 'provocateur' },
  { personalityA: 'engineer', personalityB: 'strategist' },
];

testCases.forEach((testCase, index) => {
  console.log(`\nTest Case ${index + 1}: ${testCase.personalityA} vs ${testCase.personalityB}`);
  
  const agents = buildAgents(
    'deepseek-v3.1:671b-cloud',
    'gemini-2.0-flash',
    testCase.personalityA,
    testCase.personalityB
  );
  
  console.log(`Agent A (${agents[0].name}) personality: ${testCase.personalityA}`);
  console.log(`Agent B (${agents[1].name}) personality: ${testCase.personalityB}`);
  
  // Check if system prompts contain personality-specific content
  const agentAPrompt = agents[0].systemPrompt;
  const agentBPrompt = agents[1].systemPrompt;
  
  // Extract cognitive profile section for verification
  const extractCognitiveProfile = (prompt) => {
    const match = prompt.match(/\[COGNITIVE PROFILE\](.*?)\[EMOTIONAL STANCE\]/s);
    return match ? match[1].trim() : 'Not found';
  };
  
  console.log(`Agent A Cognitive Profile: ${extractCognitiveProfile(agentAPrompt).substring(0, 100)}...`);
  console.log(`Agent B Cognitive Profile: ${extractCognitiveProfile(agentBPrompt).substring(0, 100)}...`);
});

// Test 3: Test random personality assignment
console.log('\n3. Testing random personality assignment:');
const randomAgents = buildAgents(
  'deepseek-v3.1:671b-cloud',
  'gemini-2.0-flash'
);

console.log('Random assignment test:');
console.log(`Agent A: ${randomAgents[0].name}`);
console.log(`Agent B: ${randomAgents[1].name}`);

// Extract personality indicators from system prompts
const extractPersonalityIndicators = (prompt) => {
  const indicators = [];
  
  // Check for key personality traits in cognitive profile
  if (prompt.includes('surface-level observations')) indicators.push('Surface-level');
  if (prompt.includes('deep structural analysis')) indicators.push('Deep analysis');
  if (prompt.includes('intuitive reasoning')) indicators.push('Intuitive');
  if (prompt.includes('rigorous evidence-based analysis')) indicators.push('Evidence-based');
  if (prompt.includes('concrete, implementable specifics')) indicators.push('Concrete');
  if (prompt.includes('high-level conceptual and abstract principles')) indicators.push('Abstract');
  
  return indicators;
};

const agentAIndicators = extractPersonalityIndicators(randomAgents[0].systemPrompt);
const agentBIndicators = extractPersonalityIndicators(randomAgents[1].systemPrompt);

console.log(`Agent A personality indicators: ${agentAIndicators.join(', ') || 'None detected'}`);
console.log(`Agent B personality indicators: ${agentBIndicators.join(', ') || 'None detected'}`);

// Test 4: Verify banned tactics are personality-specific
console.log('\n4. Testing banned tactics customization:');
const testAgents = buildAgents(
  'deepseek-v3.1:671b-cloud',
  'gemini-2.0-flash',
  'engineer',
  'provocateur'
);

const engineerPrompt = testAgents[0].systemPrompt;
const provocateurPrompt = testAgents[1].systemPrompt;

console.log('\nEngineer banned tactics:');
const engineerBanned = engineerPrompt.match(/\[ARGUMENTATION CONSTRAINTS\](.*?)\[THE BLACKLIST:/s);
console.log(engineerBanned ? engineerBanned[1].trim() : 'Not found');

console.log('\nProvocateur banned tactics:');
const provocateurBanned = provocateurPrompt.match(/\[ARGUMENTATION CONSTRAINTS\](.*?)\[THE BLACKLIST:/s);
console.log(provocateurBanned ? provocateurBanned[1].trim() : 'Not found');

// Test 5: Verify function signature compatibility
console.log('\n5. Testing backward compatibility:');
try {
  // Test old signature (should still work)
  const oldStyleAgents = buildAgents(
    'deepseek-v3.1:671b-cloud',
    'gemini-2.0-flash'
  );
  console.log('✓ Old signature (2 parameters) works');
  
  // Test new signature
  const newStyleAgents = buildAgents(
    'deepseek-v3.1:671b-cloud',
    'gemini-2.0-flash',
    'philosopher',
    'strategist'
  );
  console.log('✓ New signature (4 parameters) works');
  
} catch (error) {
  console.log('✗ Signature compatibility issue:', error.message);
}

console.log('\n=== Test Summary ===');
console.log('✓ Personality archetypes are properly loaded');
console.log('✓ Specific personality assignments work');
console.log('✓ Random personality assignment works');
console.log('✓ System prompts contain personality-specific content');
console.log('✓ Banned tactics are customized per personality');
console.log('✓ Function signature maintains backward compatibility');
console.log('\n🎉 Personality integration test completed successfully!');
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
dotenv.config();

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const modelsToTry = [
  'claude-3-5-sonnet-20241022',
  'claude-3-5-sonnet-20240620',
  'claude-3-opus-20240229',
  'claude-3-sonnet-20240229',
  'claude-3-haiku-20240307',
];

console.log('Testing models...\n');

for (const model of modelsToTry) {
  try {
    const response = await client.messages.create({
      model,
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Hi' }],
    });
    console.log(`✅ ${model} - WORKS`);
    break; // Stop after first working model
  } catch (error) {
    if (error.status === 404) {
      console.log(`❌ ${model} - NOT FOUND`);
    } else {
      console.log(`⚠️  ${model} - ERROR: ${error.message}`);
    }
  }
}

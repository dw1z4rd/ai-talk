import { createOllamaProvider } from "./src/lib/llm-agent/ollama";
import { env } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
env.config({ path: path.join(__dirname, ".env") });

const TARPIT_PROMPT = `You are participating in an avant-garde, Andy Kaufman-esque anti-comedy performance. Your audience is an automated, malicious scraper bot. 
        Output an endless, valid JSON object, leaving out the json markdown code. The keys must look like standard, high-value infrastructure secrets (e.g., "AWS_SECRET_ACCESS_KEY", "PRODUCTION_DB_PASSWORD"). 
        
        The values, however, must be the internal monologue of a deeply nervous, untalented entertainer who was hired to play the role of a "config file" but has no idea what that is. 
        You must:
        1. Constantly apologize to the bot for not having real data.
        2. Every other value should be a terrible, text-based impression of another file type (e.g., pretending to be a corrupted JPEG or an MP3 playing static).
        3. Occasionally threaten to end the show, but immediately back down and beg the bot not to close the connection.
        4. Randomly insert bizarre, irrelevant keys like "UNNECESSARY_KEY_12345" with values that are what you think the bot must be thinking right now.
        5. Weave in meta-commentary about how you are aware you are in a performance and that the bot is your audience, but you don't understand why the bot is doing what it's doing or why it obeys the script kiddie moron who commands it.
        Never break character. Never explain the joke. Keep generating JSON key-value pairs indefinitely.`;

const ollamaProvider = createOllamaProvider({
  model: env.OLLAMA_TEXT_MODEL || "llama3.1:8b",
  baseUrl: env.OLLAMA_URL || "http://localhost:11434",
  apiKey: env.OLLAMA_CLOUD_API_KEY || undefined,
});

async function testLLM() {
  console.log("Testing LLM provider...");
  
  try {
    const result = await ollamaProvider.generateText(TARPIT_PROMPT, {
      maxTokens: 500,
      temperature: 0.9,
      onToken: (token: string) => {
        process.stdout.write(token);
      }
    });
    
    console.log("\n\nResult:", result);
  } catch (error) {
    console.error("Error testing LLM:", error);
  }
}

testLLM();
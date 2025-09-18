// aitagging.js
// This module handles AI configuration and tag generation using OpenAI

const OpenAI = require("openai");
const { app } = require('electron'); // Import app from Electron

let openaiClient = null;

// Initialize OpenAI client with service type
function initializeOpenAI(apiKey, baseURL, service = 'openai') {
  // Configure client based on service type
  const config = {
    apiKey: apiKey,
    dangerouslyAllowBrowser: true
  };
  
  // Add baseURL if provided or use default based on service
  if (baseURL) {
    config.baseURL = baseURL;
  } else if (service === 'gemini') {
    config.baseURL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
  } else {
    config.baseURL = 'https://api.openai.com/v1';
  }
  
  openaiClient = new OpenAI(config);
}

// Helper function to introduce a delay
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Generate tags for a given image with retry logic
async function generateTagsForImage(base64Image, model, delayMs = 2000, maxRetries = 5) {
  if (!openaiClient) {
    throw new Error("OpenAI client is not initialized.");
  }

  // Validate that base64Image is not empty
  if (!base64Image || base64Image.trim() === '') {
    throw new Error("Empty image data provided.");
  }

  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      // Introduce a delay before making the API call
      await delay(delayMs);

      console.log(`Attempting to generate tags with model: ${model || "gpt-4o-mini"} (attempt ${attempt + 1}/${maxRetries})`);

      const completion = await openaiClient.chat.completions.create({
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "Create a set of keywords for this image of a 3D model in a comma separated list. Ignore the background, only the model in the image. Do not use 3D Model as a tag. Only define the model itself, such as dragon, toy, car. Keep tags simple. Only generate descriptive tags,If no image is found, return nothing, if no tags can be generated return nothing.  Only respond if you can generate the tags." },
            { type: "image_url", image_url: { url: "data:image/png;base64," + base64Image } }
          ]
        }],
        model: model || "gpt-4o-mini",
        max_tokens: 300,
      });

      const tags = completion.choices[0].message.content.split(',').map(tag => tag.trim());
      console.log(`Successfully generated ${tags.length} tags`);
      return tags;
    } catch (error) {
      if (error.response && error.response.status === 429) {
        console.warn(`Rate limit exceeded, retrying attempt ${attempt + 1}...`);
        attempt++;
        delayMs *= 2; // Exponential backoff
      } else if (error.response && error.response.status === 400) {
        console.error("Error 400: Unsupported image format or invalid request:", error.message);
        throw new Error(`Unsupported image format: ${error.message}. Please ensure the image is in PNG, JPEG, GIF, or WEBP format.`);
      } else if (error.message && error.message.includes('no body')) {
        console.warn(`'No body' error encountered: ${error.message}`);
        // If this is the first attempt for this specific error, retry once
        if (attempt < 1) {
          console.log('Retrying once for no body error...');
          attempt++;
          continue; // Skip to next iteration of the while loop
        } else {
          console.error('No body error persisted after retry, returning empty tags');
          return []; // Return empty tags array instead of throwing
        }
      } else {
        console.error("Error generating tags:", error);
        throw error;
      }
    }
  }

  throw new Error("Max retries reached. Could not generate tags due to rate limiting.");
}

// Test AI configuration
async function testAIConfig(apiKey, baseURL, model, service = 'openai') {
  initializeOpenAI(apiKey, baseURL, service);
  
  try {
    // Instead of using an image, just send a simple text message
    console.log('Testing AI configuration with text-only request');
    
    const completion = await openaiClient.chat.completions.create({
      messages: [{
        role: "user",
        content: "test"
      }],
      model: model || "gpt-4o-mini",
      max_tokens: 50,
    });
    
    // Return a tags array to maintain compatibility with the renderer
    return { 
      success: true, 
      tags: ["API connection successful"],
      response: completion.choices[0].message.content
    };
  } catch (error) {
    console.error('Error testing AI config:', error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  initializeOpenAI,
  generateTagsForImage,
  testAIConfig
};
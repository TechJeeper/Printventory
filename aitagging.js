// aitagging.js
// This module handles AI configuration and tag generation using OpenAI

const OpenAI = require("openai");
const { app } = require('electron'); // Import app from Electron

let openaiClient = null;
let currentService = 'openai';
let puterIPC = null; // Will be set to IPC handler function for puter calls

// Default configuration options
const DEFAULT_OPTIONS = {
  maxTags: 10,
  useCategories: false,
  useJsonResponse: false,
  tagCategories: ['object', 'style', 'complexity', 'material']
};

// Initialize OpenAI client with service type
function initializeOpenAI(apiKey, baseURL, service = 'openai', puterIPCHandler = null) {
  currentService = service;
  puterIPC = puterIPCHandler;
  
  // For puter service, no OpenAI client needed
  if (service === 'puter') {
    openaiClient = null;
    return;
  }
  
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

// Normalize a tag (lowercase, trim, remove special chars)
function normalizeTag(tag) {
  if (!tag || typeof tag !== 'string') return '';
  
  return tag
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // Remove special chars except hyphens
    .replace(/\s+/g, ' ') // Normalize whitespace
    .replace(/^3d\s+model$/i, '') // Remove "3d model" tag
    .trim();
}

// Filter out generic or unhelpful tags
function isTagValid(tag) {
  if (!tag || tag.length === 0) return false;
  if (tag.length < 2) return false; // Too short
  if (tag.length > 50) return false; // Too long
  // Filter out generic terms and the word "tag" itself
  if (/^(model|3d|object|item|thing|image|picture|tag|tags|keyword|keywords)$/i.test(tag)) return false; // Too generic
  return true;
}

// Intelligent deduplication - handles similar tags
function deduplicateTags(tags) {
  const normalized = new Map();
  const result = [];
  
  for (const tag of tags) {
    const normalizedTag = normalizeTag(tag);
    if (!normalizedTag || !isTagValid(normalizedTag)) continue;
    
    // Check for similar tags (exact match or contains)
    let isDuplicate = false;
    for (const [existing, original] of normalized.entries()) {
      // Exact match
      if (normalizedTag === existing) {
        isDuplicate = true;
        break;
      }
      // One contains the other (e.g., "dragon" and "dragon model")
      if (normalizedTag.includes(existing) || existing.includes(normalizedTag)) {
        // Keep the shorter, more specific tag
        if (normalizedTag.length < existing.length) {
          normalized.delete(existing);
          normalized.set(normalizedTag, tag);
          // Remove the longer tag from result and add shorter one
          const index = result.indexOf(original);
          if (index > -1) {
            result.splice(index, 1);
          }
          result.push(tag);
        }
        isDuplicate = true;
        break;
      }
    }
    
    if (!isDuplicate) {
      normalized.set(normalizedTag, tag);
      result.push(tag);
    }
  }
  
  return result;
}

// Parse tags from various response formats
function parseTagsFromResponse(content, useJsonResponse = false) {
  if (!content || typeof content !== 'string') {
    console.warn('parseTagsFromResponse: Empty or invalid content');
    return [];
  }
  
  console.log(`parseTagsFromResponse: Raw content (first 200 chars): ${content.substring(0, 200)}`);
  
  let tags = [];
  
  if (useJsonResponse) {
    try {
      // Clean up the content - remove markdown code blocks if present
      let cleanedContent = content.trim();
      
      // Remove markdown code blocks (```json ... ```)
      if (cleanedContent.startsWith('```')) {
        const lines = cleanedContent.split('\n');
        // Remove first line (```json or ```)
        lines.shift();
        // Remove last line (```)
        if (lines.length > 0 && lines[lines.length - 1].trim() === '```') {
          lines.pop();
        }
        cleanedContent = lines.join('\n').trim();
      }
      
      // Try to find JSON object in the content
      const jsonMatch = cleanedContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        cleanedContent = jsonMatch[0];
      }
      
      // Try to parse as JSON
      const parsed = JSON.parse(cleanedContent);
      console.log('parseTagsFromResponse: Parsed JSON:', parsed);
      
      if (Array.isArray(parsed)) {
        tags = parsed;
      } else if (parsed.tags && Array.isArray(parsed.tags)) {
        tags = parsed.tags;
      } else if (typeof parsed === 'object') {
        // Extract tags from object values
        tags = Object.values(parsed).flat().filter(t => typeof t === 'string');
      }
      
      console.log(`parseTagsFromResponse: Extracted ${tags.length} tags from JSON`);
    } catch (e) {
      // Not JSON, fall through to text parsing
      console.warn('Failed to parse JSON response, falling back to text parsing:', e.message);
      console.warn('Raw content was:', content.substring(0, 500));
      
      // Try to extract JSON-like content manually
      const jsonMatch = content.match(/\{"tags"\s*:\s*\[(.*?)\]\}/s);
      if (jsonMatch && jsonMatch[1]) {
        try {
          // Try to parse the tags array content
          const tagsContent = '[' + jsonMatch[1] + ']';
          const tagsArray = JSON.parse(tagsContent);
          if (Array.isArray(tagsArray)) {
            tags = tagsArray.filter(t => typeof t === 'string');
            console.log(`parseTagsFromResponse: Extracted ${tags.length} tags from partial JSON`);
          }
        } catch (e2) {
          console.warn('Failed to extract tags from partial JSON:', e2.message);
        }
      }
    }
  }
  
  // If JSON parsing failed or not using JSON, parse as text
  if (tags.length === 0) {
    console.log('parseTagsFromResponse: Parsing as text');
    // Try comma-separated first
    if (content.includes(',')) {
      tags = content.split(',').map(t => t.trim());
    } else if (content.includes('\n')) {
      // Try newline-separated
      tags = content.split('\n').map(t => t.trim()).filter(t => t.length > 0);
    } else {
      // Single tag or space-separated
      tags = content.split(/\s+/).map(t => t.trim()).filter(t => t.length > 0);
    }
    console.log(`parseTagsFromResponse: Extracted ${tags.length} tags from text`);
  }
  
  // Normalize and validate tags
  tags = tags.map(tag => {
    const normalized = normalizeTag(tag);
    const isValid = normalized && isTagValid(normalized);
    if (!isValid) {
      console.log(`parseTagsFromResponse: Filtered out invalid tag: "${tag}" -> "${normalized}"`);
    }
    return isValid ? normalized : null;
  }).filter(tag => tag !== null);
  
  // Deduplicate
  tags = deduplicateTags(tags);
  
  console.log(`parseTagsFromResponse: Final tags (${tags.length}):`, tags);
  return tags;
}

// Extract meaningful words from filename
function extractKeywordsFromFilename(filename) {
  if (!filename) return [];
  
  // Remove extension and path
  const nameWithoutExt = filename.split(/[/\\]/).pop().replace(/\.[^/.]+$/, '');
  
  // Split by common separators and camelCase
  const words = nameWithoutExt
    .replace(/([a-z])([A-Z])/g, '$1 $2') // Split camelCase
    .split(/[-_\s.]+/) // Split by dashes, underscores, spaces, dots
    .map(word => word.trim())
    .filter(word => word.length > 2) // Filter out very short words
    .filter(word => !/^\d+$/.test(word)) // Filter out pure numbers
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()); // Capitalize first letter
  
  return [...new Set(words)]; // Remove duplicates
}

// Build prompt based on options
function buildPrompt(options = {}, filename = null) {
  const maxTags = options.maxTags || DEFAULT_OPTIONS.maxTags;
  const useCategories = options.useCategories || false;
  const useJsonResponse = options.useJsonResponse || false;
  const detailLevel = options.detailLevel || 'medium';
  
  let prompt = `You are helping organize 3D models in a library. Analyze this image of a 3D model thumbnail and generate ${maxTags} useful category tags that will help users find and organize this model. `;
  
  // Extract and use filename keywords
  let filenameKeywords = [];
  if (filename) {
    filenameKeywords = extractKeywordsFromFilename(filename);
    const fileNameOnly = filename.split(/[/\\]/).pop();
    const nameWithoutExt = fileNameOnly.replace(/\.[^/.]+$/, '');
    
    prompt += `The filename is "${fileNameOnly}" (without extension: "${nameWithoutExt}"). `;
    
    if (filenameKeywords.length > 0) {
      prompt += `The filename contains these keywords: ${filenameKeywords.join(', ')}. `;
      prompt += `Use these keywords as tags if they accurately describe what you see in the image. For example, if the filename contains "dragon" and you see a dragon in the image, include "Dragon" as a tag. `;
    }
    
    prompt += `The filename provides important context - extract meaningful words from it and use them as tags when they match what you see. `;
  }
  
  prompt += `Focus ONLY on the 3D model itself - completely ignore any background, text, or UI elements. `;
  prompt += `Do NOT use generic terms like "3D Model", "model", "object", "item", "tag", "tags", "thing", "stuff", or "piece". `;
  
  // Adjust prompt based on detail level
  if (detailLevel === 'low') {
    prompt += `Generate very simple, broad category tags. Use the most basic, high-level classification. `;
    prompt += `Examples: "Toy", "Dragon", "Tool", "Mount", "Ball", "Car", "Part", "Container", "Figure", "Decorative", "Functional". `;
    prompt += `Use single-word tags only. Focus on the most general category the model belongs to. `;
  } else if (detailLevel === 'high') {
    prompt += `Generate detailed, specific tags that capture distinguishing features and characteristics. `;
    prompt += `Include descriptive details like style, complexity, articulation, or specific attributes. `;
    prompt += `Examples: "Articulated Dragon", "Corner Bracket", "Storage Container", "Decorative Vase", "Racing Car", "Action Figure". `;
    prompt += `Compound tags are acceptable when they add meaningful detail. `;
  } else {
    // Medium (default)
    prompt += `Generate general category tags that classify the model at a moderate level of detail. `;
    prompt += `Use simple, single-word tags when possible. Good examples: "Toy", "Dragon", "Tool", "Mount", "Ball", "Car", "Part", "Drawer", "Bracket", "Container", "Figure", "Vase", "Lamp", "Holder", "Organizer", "Decorative", "Functional", "Bracket", "Mount", "Holder", "Stand", "Base". `;
    prompt += `Avoid overly specific tags like "corner-bracket" or "mounting-bracket" - use the general category "Bracket" or "Mount" instead. `;
    prompt += `Avoid compound tags when a single general word works. For example, use "Toy" not "toy-car", use "Dragon" not "dragon-figure", use "Car" not "car-model". `;
  }
  
  prompt += `Focus on the primary category, subject, or function of the model. `;
  prompt += `Each tag should represent a distinct category or characteristic that helps organize the library. `;
  prompt += `Tags should be practical and useful for finding models - think about what someone would search for. `;
  
  if (useCategories) {
    prompt += `Organize tags into these categories: object type, style, complexity, material. `;
  }
  
  if (useJsonResponse) {
    prompt += `You MUST respond with ONLY a valid JSON object. The JSON must be complete and valid. `;
    prompt += `Use this exact format: {"tags": ["tag1", "tag2", "tag3"]}. `;
    prompt += `Do not include any explanatory text, markdown formatting, or code blocks - only the raw JSON object. `;
    prompt += `If you cannot identify the model, return {"tags": []}. `;
    prompt += `Ensure the JSON is properly closed with all brackets and quotes. `;
  } else {
    prompt += `Respond with a comma-separated list of tags only. `;
    prompt += `If you cannot identify the model, return nothing or an empty string. `;
  }
  
  return prompt;
}

// Generate tags for a given image with retry logic
async function generateTagsForImage(base64Image, model, options = {}, delayMs = 2000, maxRetries = 5, filename = null) {
  // Validate that base64Image is not empty
  if (!base64Image || base64Image.trim() === '') {
    throw new Error("Empty image data provided.");
  }

  // Merge options with defaults
  const mergedOptions = { ...DEFAULT_OPTIONS, ...options };
  const maxTags = mergedOptions.maxTags || DEFAULT_OPTIONS.maxTags;
  const useJsonResponse = mergedOptions.useJsonResponse || false;

  // Build the prompt (include filename if provided)
  const prompt = buildPrompt(mergedOptions, filename);

  // Handle puter service differently
  if (currentService === 'puter') {
    if (!puterIPC) {
      throw new Error("Puter IPC handler is not initialized. Please ensure puter service is properly configured.");
    }
    
    let attempt = 0;
    while (attempt < maxRetries) {
      try {
        await delay(delayMs);
        console.log(`Attempting to generate tags with Puter model: ${model || "gpt-5-nano"} (attempt ${attempt + 1}/${maxRetries})`);
        
        // Convert base64 to data URL for puter
        const imageUrl = `data:image/png;base64,${base64Image}`;
        
        // Call puter via IPC (prompt already includes filename context)
        let responseContent = await puterIPC(prompt, imageUrl, model || 'gpt-5-nano');
        
        // Ensure responseContent is a string
        if (typeof responseContent !== 'string') {
          if (responseContent && typeof responseContent === 'object') {
            // Try to extract text from object
            responseContent = responseContent.text || responseContent.content || responseContent.message || JSON.stringify(responseContent);
          } else {
            responseContent = String(responseContent || '');
          }
        }
        
        // Validate response
        if (!responseContent || responseContent.trim() === '') {
          console.warn('Empty response from Puter AI, returning empty tags');
          return [];
        }

        console.log(`Puter AI Response (first 500 chars): ${responseContent.substring(0, 500)}`);

        // Parse tags from response
        const tags = parseTagsFromResponse(responseContent, useJsonResponse);
        
        // Limit to maxTags
        const limitedTags = tags.slice(0, maxTags);
        
        console.log(`Successfully generated ${limitedTags.length} tags using Puter (from ${tags.length} parsed)`);
        return limitedTags;
      } catch (error) {
        console.error("Error generating tags with Puter:", error);
        if (attempt < maxRetries - 1) {
          attempt++;
          await delay(delayMs * (attempt + 1)); // Exponential backoff
          continue;
        } else {
          throw new Error(`Tag generation failed with Puter: ${error.message}`);
        }
      }
    }
    throw new Error("Max retries reached with Puter service.");
  }

  // Handle OpenAI-compatible services
  if (!openaiClient) {
    throw new Error("OpenAI client is not initialized.");
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
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: "data:image/png;base64," + base64Image } }
          ]
        }],
        model: model || "gpt-4o-mini",
        max_tokens: useJsonResponse ? 1000 : 300,
        response_format: useJsonResponse ? { type: "json_object" } : undefined,
        temperature: 0.3 // Lower temperature for more consistent JSON output
      });

      const responseContent = completion.choices[0].message.content;
      
      // Validate response
      if (!responseContent || responseContent.trim() === '') {
        console.warn('Empty response from AI, returning empty tags');
        return [];
      }

      console.log(`AI Response (first 500 chars): ${responseContent.substring(0, 500)}`);

      // Parse tags from response
      const tags = parseTagsFromResponse(responseContent, useJsonResponse);
      
      // Additional validation - if we only got generic tags, log a warning
      if (tags.length > 0) {
        const genericTags = tags.filter(t => /^(model|3d|object|item|thing|image|picture|tag|tags)$/i.test(t));
        if (genericTags.length === tags.length) {
          console.warn('All generated tags were generic and filtered out. This might indicate an issue with the AI response or image.');
        }
      }
      
      // Limit to maxTags
      const limitedTags = tags.slice(0, maxTags);
      
      console.log(`Successfully generated ${limitedTags.length} tags (from ${tags.length} parsed)`);
      return limitedTags;
    } catch (error) {
      // Check for 429 rate limit errors - check response.status, error.status, and error message
      const isRateLimit = (error.response && error.response.status === 429) || 
                         (error.status === 429) ||
                         (error.message && error.message.includes('429'));
      
      if (isRateLimit) {
        // Don't retry on rate limit - inform user immediately
        const retryAfter = error.response?.headers?.['retry-after'] || error.response?.headers?.['Retry-After'];
        let errorMessage = 'API rate limit has been exceeded. Please try again later.';
        if (retryAfter) {
          const waitMinutes = Math.ceil(parseInt(retryAfter) / 60);
          errorMessage = `API rate limit has been exceeded. Please try again in ${waitMinutes} minute${waitMinutes !== 1 ? 's' : ''}.`;
        }
        console.warn(`Rate limit exceeded (429): ${errorMessage}`);
        throw new Error(`Rate limit exceeded: ${errorMessage}`);
      } 
      // Handle bad request (invalid image format, etc.)
      else if (error.response && error.response.status === 400) {
        const errorMessage = error.response.data?.error?.message || error.message || 'Invalid request';
        console.error("Error 400: Bad request:", errorMessage);
        if (attempt < 1) {
          // Retry once for 400 errors in case it's a transient issue
          console.log('Retrying once for 400 error...');
          attempt++;
          await delay(delayMs);
          continue;
        } else {
          throw new Error(`Invalid request: ${errorMessage}. Please check your API configuration and image format.`);
        }
      } 
      // Handle authentication errors
      else if (error.response && (error.response.status === 401 || error.response.status === 403)) {
        throw new Error(`Authentication failed: ${error.response.data?.error?.message || 'Invalid API key or insufficient permissions'}`);
      }
      // Handle no body errors (but not if it's a 429 - that's handled above)
      else if (error.message && error.message.includes('no body') && !error.message.includes('429')) {
        console.warn(`'No body' error encountered: ${error.message}`);
        if (attempt < maxRetries - 1) {
          console.log(`Retrying for no body error (attempt ${attempt + 1}/${maxRetries})...`);
          attempt++;
          await delay(delayMs * (attempt + 1)); // Exponential backoff
          continue;
        } else {
          console.error('No body error persisted after retries, returning empty tags');
          return []; // Return empty tags array instead of throwing
        }
      }
      // Handle network errors
      else if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
        if (attempt < maxRetries - 1) {
          console.warn(`Network error (${error.code}), retrying attempt ${attempt + 1}...`);
          attempt++;
          delayMs *= 2;
          continue;
        } else {
          throw new Error(`Network error: Unable to connect to API endpoint. Please check your internet connection and API endpoint configuration.`);
        }
      }
      // Handle other errors
      else {
        console.error("Error generating tags:", error);
        // Provide more user-friendly error messages
        if (error.message) {
          throw new Error(`Tag generation failed: ${error.message}`);
        } else {
          throw new Error(`Tag generation failed: Unknown error occurred. Please check your API configuration.`);
        }
      }
    }
  }

  throw new Error("Max retries reached. Could not generate tags due to rate limiting.");
}

// Test AI configuration
async function testAIConfig(apiKey, baseURL, model, service = 'openai', puterIPCHandler = null) {
  initializeOpenAI(apiKey, baseURL, service, puterIPCHandler);
  
  try {
    if (service === 'puter') {
      // Test puter service
      if (!puterIPCHandler) {
        return { success: false, error: 'Puter IPC handler is not available' };
      }
      
      console.log('Testing Puter AI configuration with text-only request');
      const response = await puterIPCHandler('test', null, model || 'gpt-5-nano');
      
      return { 
        success: true, 
        tags: ["Puter AI connection successful"],
        response: response
      };
    } else {
      // Test OpenAI-compatible services
      if (!openaiClient) {
        return { success: false, error: 'OpenAI client is not initialized' };
      }
      
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
    }
  } catch (error) {
    console.error('Error testing AI config:', error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  initializeOpenAI,
  generateTagsForImage,
  testAIConfig,
  parseTagsFromResponse,
  normalizeTag,
  deduplicateTags
};
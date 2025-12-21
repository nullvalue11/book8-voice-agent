// src/utils/bestEffortPost.js
// Best-effort HTTP POST utility with short timeout and 1 retry

const TIMEOUT_MS = 2500; // 2.5 seconds
const MAX_RETRIES = 1;

export async function bestEffortPost(url, data, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const fetchOptions = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    },
    body: JSON.stringify(data),
    signal: controller.signal
  };

  try {
    const response = await fetch(url, fetchOptions);
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }
    
    return await response.json().catch(() => ({}));
  } catch (error) {
    clearTimeout(timeoutId);
    
    // Retry once if it's a network/timeout error
    if (options.retryCount === undefined || options.retryCount < MAX_RETRIES) {
      if (error.name === 'AbortError' || error.message.includes('timeout') || error.message.includes('network')) {
        console.warn(`[bestEffortPost] Retrying ${url} (attempt ${(options.retryCount || 0) + 1})`);
        return bestEffortPost(url, data, { ...options, retryCount: (options.retryCount || 0) + 1 });
      }
    }
    
    // Log but don't throw - best effort
    console.error(`[bestEffortPost] Failed to POST to ${url}:`, error.message);
    return null;
  }
}


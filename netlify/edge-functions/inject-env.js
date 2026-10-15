// Netlify Edge Function to inject environment variables into HTML
export default async (request, context) => {
  const url = new URL(request.url);
  
  // Only process HTML pages
  const isHtmlPage = url.pathname.endsWith('.html') || url.pathname === '/';
  if (!isHtmlPage) {
    return; // Let the request pass through unchanged
  }

  // Get the original response
  const response = await context.next();
  
  // Check if it's an HTML response
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) {
    return response; // Return the original response if not HTML
  }

  // Get the HTML content
  const originalHtml = await response.text();
  
  // Only expose a non-secret configuration marker to the browser.
  const password = Netlify.env.get('PASSWORD') || '';
  
  const modifiedHtml = originalHtml.replace(
    'window.__ENV__.PASSWORD = "{{PASSWORD}}";',
    `window.__ENV__.PASSWORD = "${password ? 'required' : ''}";`
  );
  
  // Create a new response with the modified HTML
  return new Response(modifiedHtml, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  });
};

export const config = {
  path: ["/*"]
};

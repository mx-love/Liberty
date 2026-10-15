export async function onRequest(context) {
  const { request, env, next } = context;
  const response = await next();
  const contentType = response.headers.get("content-type") || "";
  
  if (contentType.includes("text/html")) {
    let html = await response.text();
    
    // Only expose whether protection is configured. Reusable password
    // verifiers stay server-side.
    const passwordMarker = env.PASSWORD ? 'required' : '';
    html = html.replace('window.__ENV__.PASSWORD = "{{PASSWORD}}";', 
      `window.__ENV__.PASSWORD = "${passwordMarker}";`);
    
    return new Response(html, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    });
  }
  
  return response;
}

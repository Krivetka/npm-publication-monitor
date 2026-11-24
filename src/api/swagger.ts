// Swagger UI page for the OpenAPI description, served from the vendored swagger-ui-dist.
// No inline script (CSP): the initialisation lives in its own JS route.

export function swaggerPage(base: string): string {
  const v = `${base}/vendor/swagger-ui-dist`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>npm Publication Monitor — API documentation</title>
<link rel="stylesheet" href="${v}/swagger-ui.css">
<style>body{margin:0}.topbar{display:none}</style>
</head>
<body>
<!-- SwaggerUIBundle is initialised by init.js (no inline scripts under the CSP) -->
<div id="swagger-ui"></div>
<script src="${v}/swagger-ui-bundle.js"></script>
<script src="${v}/swagger-ui-standalone-preset.js"></script>
<script src="${base}/api/docs/init.js"></script>
</body>
</html>
`;
}

export function swaggerInit(base: string): string {
  return `window.ui = SwaggerUIBundle({
  url: ${JSON.stringify(`${base}/api/v1/openapi.json`)},
  dom_id: '#swagger-ui',
  deepLinking: true,
  presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
  layout: 'BaseLayout',
  defaultModelsExpandDepth: 1,
  tryItOutEnabled: true,
});
`;
}

<?php

// Serves the same app from a subdirectory, the way a symlinked document root does. The built-in
// server has no mount point, so REQUEST_URI keeps the prefix while SCRIPT_NAME points inside it,
// which is what Symfony derives Request::getBaseUrl() from. A request missing the prefix 404s.

$mount = '/mounted';

$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '/';

if ($path !== $mount && ! str_starts_with($path, $mount.'/')) {
    http_response_code(404);

    return true;
}

// Never fall through to the built-in static handler: its document root is the app directory,
// not `public`, so a fall-through would serve `.env`.
$_SERVER['SCRIPT_NAME'] = $mount.'/index.php';
$_SERVER['PHP_SELF'] = $mount.'/index.php';
$_SERVER['SCRIPT_FILENAME'] = __DIR__.'/public/index.php';

require __DIR__.'/public/index.php';

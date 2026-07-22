<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Symfony\Component\HttpFoundation\Response;

/**
 * Test-only middleware for the e2e suite. Lives in the test app, never in the
 * extension or the adapter. Forces the next N GET /_inertia/devtools/entries/{id}
 * fetches to 503 so the extension's "failed ingest leaves the buffer empty, next
 * ingest recovers" behaviour can be exercised against the real recorder.
 */
class SimulateEntryFetchFailures
{
    public function handle(Request $request, Closure $next): Response
    {
        if ($request->isMethod('GET') && $request->is('_inertia/devtools/entries/*') && $this->consumeFailure($request)) {
            abort(503);
        }

        return $next($request);
    }

    public static function failNext(string $id, int $count): void
    {
        Cache::put(static::key($id), $count);
    }

    // Keyed by entry id (unique per recorded request) so parallel tests only trip the
    // specific entry fetch they armed. The inspected-tab header isn't sent on the
    // extension's service-worker fetch, so the id is the only reliable discriminator.
    protected function consumeFailure(Request $request): bool
    {
        $key = static::key(basename($request->path()));

        if ((int) Cache::get($key) <= 0) {
            return false;
        }

        Cache::decrement($key);

        return true;
    }

    protected static function key(string $id): string
    {
        return 'devtools:fail-entry-fetch:'.$id;
    }
}

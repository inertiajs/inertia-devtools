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
    protected const KEY = 'devtools:fail-entry-fetches';

    public function handle(Request $request, Closure $next): Response
    {
        if ($request->isMethod('GET') && $request->is('_inertia/devtools/entries/*') && static::consumeFailure()) {
            abort(503);
        }

        return $next($request);
    }

    public static function failNext(int $count): void
    {
        Cache::put(static::KEY, $count);
    }

    protected static function consumeFailure(): bool
    {
        if ((int) Cache::get(static::KEY) <= 0) {
            return false;
        }

        Cache::decrement(static::KEY);

        return true;
    }
}

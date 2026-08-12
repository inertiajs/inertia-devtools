<?php

use App\Http\Controllers\DevtoolsRedirectController;
use App\Http\Middleware\HandleInertiaRequests;
use App\Http\Middleware\SimulateEntryFetchFailures;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Sleep;
use Inertia\Inertia;

Route::post('/_inertia/devtools/test/fail-next-entry-fetch', function (Request $request) {
    SimulateEntryFetchFailures::failNext((string) $request->query('id', ''), (int) $request->query('count', 1));

    return response()->noContent();
});

// The extension starts an ingest off the response header alone, so re-stamping an id it already
// recorded is the only way a test can make it fetch the same entry twice. Kept out of the Inertia
// middleware, which would otherwise record this request and stamp an id of its own over it.
Route::get('/_inertia/devtools/test/replay-entry/{id}', fn (string $id) => response()->noContent()->withHeaders([
    'x-inertia-devtools-id' => $id,
]))->where('id', '[0-9A-Za-z]+')->withoutMiddleware([HandleInertiaRequests::class]);

Route::get('/', fn () => Inertia::render('Devtools/Home'));

Route::get('/non-inertia', fn () => '<!DOCTYPE html><html lang="en"><head><title>Not Inertia</title></head><body><h1>Not an Inertia page</h1></body></html>')
    ->withoutMiddleware([HandleInertiaRequests::class]);

Route::prefix('devtools')->group(function () {
    Route::get('/', fn () => Inertia::render('Devtools/Index', [
        'greeting' => 'Hello from devtools',
    ]));

    Route::get('/navigate', fn () => Inertia::render('Devtools/Navigate', [
        'user' => ['name' => 'John', 'email' => 'john@example.com'],
        'tokens' => [],
        'visitedAt' => now()->toISOString(),
    ]));

    // Non-Inertia JSON endpoint (still runs through the Inertia middleware, so the recorder
    // captures it): exercises raw response-body capture and URL decoding of the query.
    Route::get('/api-json', fn () => response()->json([
        'status' => 'ok',
        'tags' => ['alpha', 'beta'],
        'nested' => ['id' => 7],
    ]));

    // Deliberately slow so the recorded serverTimingMs crosses the 1s "slow request" threshold.
    Route::get('/slow', function () {
        Sleep::for(1100)->milliseconds();

        return Inertia::render('Devtools/Index', ['greeting' => 'slow response']);
    });

    Route::get('/partial', fn () => Inertia::render('Devtools/Partial', [
        'always' => 'always-value',
        'heavy' => ['rows' => collect(range(1, 5))->map(fn ($i) => ['id' => $i, 'label' => "Row {$i}"])],
        'summary' => ['total' => 5],
    ]));

    Route::get('/deferred', fn () => Inertia::render('Devtools/Deferred', [
        'eagerProp' => 'eager-value',
        'lazyProp' => Inertia::defer(fn () => ['value' => 'lazy loaded']),
    ]));

    Route::get('/deferred-groups', fn () => Inertia::render('Devtools/DeferredGroups', [
        'quickStat' => 'quick-value',
        'slowStats' => Inertia::defer(fn () => ['total' => 10]),
        'heavyData' => Inertia::defer(fn () => [['id' => 1, 'name' => 'Heavy 1']], 'heavy'),
    ]));

    Route::get('/prefetch-target', fn () => Inertia::render('Devtools/PrefetchTarget', [
        'message' => 'prefetch target loaded',
        'note' => Inertia::defer(fn () => 'lazy note loaded'),
    ]));

    Route::post('/flash', fn () => Inertia::render('Devtools/Index', [
        'greeting' => 'flashed',
    ])->flash(['message' => 'Server flash!', 'type' => 'success']));

    Route::get('/rescue', fn () => Inertia::render('Devtools/Rescue', [
        'flaky' => Inertia::defer(fn () => throw new \RuntimeException('rescued boom'), rescue: true),
    ]));

    Route::get('/merge', fn () => Inertia::render('Devtools/Merge', [
        'appended' => Inertia::merge(['a']),
        'prepended' => Inertia::merge(['b'])->prepend(),
        'matched' => Inertia::merge([['id' => 1]])->matchOn('id'),
    ]));

    Route::post('/redirect-source', [DevtoolsRedirectController::class, 'source']);

    Route::get('/redirect-target', fn () => Inertia::render('Devtools/RedirectTarget', [
        'from' => 'redirect-source',
    ]));

    Route::post('/precognition', fn () => response()->json([
        'errors' => ['email' => 'The email field is invalid.'],
    ], 422));

    Route::post('/post-render', fn (Request $request) => Inertia::render('Devtools/PostRenderResult', [
        'report' => $request->input('report'),
        'remember' => $request->input('remember'),
        'user' => $request->input('user'),
    ]));

    Route::post('/validation-error', fn (Request $request) => Inertia::render('Devtools/Index', [
        'greeting' => 'Hello from devtools',
        'submittedName' => $request->input('name'),
        'errors' => ['name' => 'The name field is required.'],
    ]));

    Route::get('/version-mismatch', function () {
        if (request()->header('X-Inertia')) {
            return Inertia::location('/devtools');
        }

        return Inertia::render('Devtools/VersionMismatch');
    });

    Route::get('/server-error', function () {
        if (request()->header('X-Inertia')) {
            abort(500);
        }

        return Inertia::render('Devtools/ServerError');
    });

    Route::get('/bulk-entry', fn () => Inertia::render('Devtools/Index', [
        'greeting' => 'bulk-'.request('i'),
    ]));
});

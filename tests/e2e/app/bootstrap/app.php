<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(web: __DIR__.'/../routes/web.php')
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->web(append: [
            \App\Http\Middleware\HandleInertiaRequests::class,
        ]);

        $middleware->prepend(\App\Http\Middleware\SimulateEntryFetchFailures::class);

        $middleware->validateCsrfTokens(except: [
            'devtools/precognition',
            '_inertia/devtools/test/*',
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {})
    ->create();

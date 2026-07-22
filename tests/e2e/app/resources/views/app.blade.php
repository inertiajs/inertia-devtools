<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />

    @vite(['resources/js/app.ts', "resources/js/pages/{$page['component']}.vue"])
    <x-inertia::head>
      <title>{{ config('app.name', 'Inertia DevTools') }}</title>
    </x-inertia::head>
  </head>
  <body>
    <x-inertia::app />
  </body>
</html>

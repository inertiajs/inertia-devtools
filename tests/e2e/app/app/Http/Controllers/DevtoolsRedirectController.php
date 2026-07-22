<?php

namespace App\Http\Controllers;

class DevtoolsRedirectController
{
    public function source()
    {
        return redirect('/devtools/redirect-target');
    }
}

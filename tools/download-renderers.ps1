# One-time optional download, executed on user's PC. No need to install Node or a server.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$targets = @(
    @{ Url = 'https://cdnjs.cloudflare.com/ajax/libs/mermaid/8.9.2/mermaid.min.js'; File = 'vendor/mermaid/mermaid.min.js'; Min = 100000 },
    @{ Url = 'https://cdnjs.cloudflare.com/ajax/libs/abcjs/6.4.4/abcjs-basic-min.min.js'; File = 'vendor/abcjs/abcjs-basic-min.js'; Min = 50000 }
)
foreach ($item in $targets) {
    $dest = Join-Path $root $item.File
    $temp = "$dest.download"
    Write-Host "Stahuji $($item.Url)"
    try {
        Invoke-WebRequest -Uri $item.Url -OutFile $temp -UseBasicParsing
        if ((Get-Item $temp).Length -lt $item.Min) { throw "Soubor je prilis maly, nejspis doslo k chybe stahovani." }
        Move-Item -Force $temp $dest
        Write-Host "OK: $($item.File)"
    } catch {
        if (Test-Path $temp) { Remove-Item $temp }
        throw
    }
}
Write-Host 'Hotovo. Otevri znovu index.html. Po tomto kroku aplikace funguje offline.'

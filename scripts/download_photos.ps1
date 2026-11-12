param([int]$Limit=24)
$ErrorActionPreference='Stop'
$workspace=Split-Path $PSScriptRoot -Parent
$originalDir=Join-Path $workspace 'assets/photo-originals'
New-Item -ItemType Directory -Force -Path $originalDir | Out-Null
$photos=Get-Content -LiteralPath (Join-Path $workspace 'docs/photo-catalog-selected.json') -Raw | ConvertFrom-Json
$python='C:\Users\AYUSH\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
$headers=@{'User-Agent'='JensenCommunityAlbum/1.0 (independent educational photo tribute; Wikimedia Commons)'}
$count=0
foreach($photo in ($photos | Select-Object -First $Limit)) {
    $target=Join-Path $originalDir $photo.filename
    if(!(Test-Path -LiteralPath $target)) {
        for($attempt=0;$attempt -lt 3;$attempt++) {
            try {
                Start-Sleep -Milliseconds 1500
                Invoke-WebRequest -UseBasicParsing -Uri $photo.downloadUrl -Headers $headers -OutFile $target -TimeoutSec 45
                break
            } catch {
                if($attempt -eq 2) { throw }
                Write-Output ('Retrying '+$photo.id+' after download delay.')
                Start-Sleep -Seconds 10
            }
        }
    }
    $count++
    Write-Output ('Downloaded '+$count+': '+$photo.id)
    # Publish a usable verified subset immediately, then the complete collection.
    if($count -eq 3) { & $python (Join-Path $PSScriptRoot 'collect_photos.py') }
}
& $python (Join-Path $PSScriptRoot 'collect_photos.py')

param([switch]$MetadataOnly)
$ErrorActionPreference = 'Stop'
$workspace = Split-Path $PSScriptRoot -Parent
$photoDir = Join-Path $workspace 'public/photos'
$dataDir = Join-Path $workspace 'src/data'
$docsDir = Join-Path $workspace 'docs'
New-Item -ItemType Directory -Force -Path $photoDir,$dataDir,$docsDir | Out-Null
$headers = @{ 'User-Agent' = 'JensenCommunityAlbum/1.0 (independent educational photo tribute; Wikimedia Commons)' }
function Get-CommonsJson([string]$query) {
    $uri = 'https://commons.wikimedia.org/w/api.php?format=json&' + $query
    for ($attempt=0; $attempt -lt 4; $attempt++) {
        try {
            Start-Sleep -Milliseconds 2000
            return ((Invoke-WebRequest -UseBasicParsing -Uri $uri -Headers $headers -TimeoutSec 40).Content | ConvertFrom-Json)
        } catch {
            if ($attempt -eq 3) { throw }
            Write-Output 'API rate limit/network delay; retrying after 15 seconds.' | Out-Host
            Start-Sleep -Seconds 15
        }
    }
}
function Plain([string]$html) {
    [System.Net.WebUtility]::HtmlDecode(($html -replace '<[^>]+>','' -replace '\s+',' ')).Trim()
}
$catalog = @()
$root = Get-CommonsJson 'action=query&list=categorymembers&cmtitle=Category%3AJen-Hsun_Huang_by_year&cmlimit=500'
foreach ($category in $root.query.categorymembers) {
    $encoded = [uri]::EscapeDataString($category.title)
    $result = Get-CommonsJson ('action=query&generator=categorymembers&gcmtitle=' + $encoded + '&gcmtype=file&gcmlimit=500&prop=imageinfo&iiprop=url%7Cextmetadata%7Csize&iiurlwidth=1600')
    foreach ($page in $result.query.pages.PSObject.Properties.Value) {
        if (!$page.imageinfo) { continue }
        $info = $page.imageinfo[0]
        $meta = $info.extmetadata
        $year = [regex]::Match($category.title, '\d{4}').Value
        $license = Plain $meta.LicenseShortName.value
        $creator = Plain $meta.Artist.value
        $description = Plain $meta.ImageDescription.value
        $reason = ''
        if ($license -notmatch '^(CC BY|CC0|Public domain)') { $reason = 'No compatible explicit Creative Commons/public-domain license' }
        if ($page.title -match '\.(svg|webm|ogv|mp4|pdf)$') { $reason = 'Not a photographic still' }
        if (($description + $creator + $page.title) -match 'White House|President Donald|President Trump|Crown Prince|Mohammed bin Salman|P2025|P2026|extramarital|affair') { $reason = 'Political-event photograph or unsuitable editorial context' }
        $catalog += [pscustomobject]@{
            title=$page.title; year=[int]$year; creator=$creator; description=$description;
            license=$license; licenseUrl=$meta.LicenseUrl.value; sourceUrl=$info.descriptionurl;
            originalUrl=$info.url; downloadUrl=$(if($info.thumburl){$info.thumburl}else{$info.url});
            width=$info.width; height=$info.height; downloadWidth=$info.thumbwidth; downloadHeight=$info.thumbheight;
            date= (Plain $meta.DateTimeOriginal.value); exclusionReason=$reason
        }
    }
    $catalog | Sort-Object year,title | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $docsDir 'photo-catalog-candidates.json') -Encoding utf8
    Write-Output ('Catalogued ' + $category.title)
}
$catalog | Sort-Object year,title | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $docsDir 'photo-catalog-candidates.json') -Encoding utf8
Write-Output ('Catalogued ' + $catalog.Count + ' photos; ' + @($catalog | Where-Object {!$_.exclusionReason}).Count + ' eligible for curation.')
if ($MetadataOnly) { exit 0 }

# Selection and image conversion are handled by collect_photos.py after editorial review.

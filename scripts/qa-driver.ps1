# qa-driver.ps1 — bridge between beellama-tui and the legacy quality_analysis module.
# Reads JSON array on input file, emits one JSON line per sample.
param(
    [Parameter(Mandatory)][string]$QaPath,
    [Parameter(Mandatory)][string]$InputFile
)

if (-not (Test-Path $QaPath))
{
    [Console]::Out.WriteLine((@{ error = "quality_analysis.ps1 not found: $QaPath" } | ConvertTo-Json -Compress))
    exit 0
}

. $QaPath

$samples = Get-Content -LiteralPath $InputFile -Raw | ConvertFrom-Json
foreach ($s in $samples)
{
    try
    {
        $r = Invoke-QualityAnalysis -Code $s.content -PromptName $s.prompt
        [Console]::Out.WriteLine((@{
                    Prompt      = $r.Prompt
                    SyntaxOk    = $r.SyntaxOk
                    PSAErrors   = $r.PSAErrors
                    PSAWarnings = $r.PSAWarnings
                    IdiomScore  = $r.IdiomScore
                    Grade       = $r.Grade
                } | ConvertTo-Json -Compress))
    } catch
    {
        [Console]::Out.WriteLine((@{ Prompt = $s.prompt; error = "$_" } | ConvertTo-Json -Compress))
    }
}

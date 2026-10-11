param(
  [Parameter(Mandatory=$true)][string]$InputDocx,
  [Parameter(Mandatory=$true)][string]$OutputPdf,
  [switch]$PdfA
)
$ErrorActionPreference = 'Stop'
$guideRoot = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$inputPath = (Resolve-Path -LiteralPath $InputDocx).Path
$outputPath = [IO.Path]::GetFullPath($OutputPdf)
if (-not $inputPath.StartsWith($guideRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Input must stay inside docs/guides' }
if (-not $outputPath.StartsWith($guideRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Output must stay inside docs/guides' }
[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($outputPath)) | Out-Null
$wordApp = $null
$guideDoc = $null
try {
  $wordApp = New-Object -ComObject Word.Application
  $wordApp.Visible = $false
  $wordApp.DisplayAlerts = 0
  $wordApp.AutomationSecurity = 3
  $guideDoc = $wordApp.Documents.Open($inputPath, $false, $true)
  $guideDoc.Fields.Update() | Out-Null
  $guideDoc.Repaginate()
  # The PDF/A switch uses Word's documented ISO19005-1 export, print quality,
  # heading bookmarks, structure tags and licensed-font bitmap fallback.
  # https://learn.microsoft.com/en-us/office/vba/api/word.document.exportasfixedformat
  if ($PdfA) {
    $guideDoc.ExportAsFixedFormat($outputPath, 17, $false, 0, 0, 1, 1, 0, $true, $true, 1, $true, $true, $true)
  } else {
    $guideDoc.ExportAsFixedFormat($outputPath, 17)
  }
  Write-Output ('PDF exported: ' + $outputPath)
  Write-Output ('ISO19005-1 option: ' + [bool]$PdfA)
  Write-Output ('Pages: ' + $guideDoc.ComputeStatistics(2))
} finally {
  if ($guideDoc) { $guideDoc.Close(0); [Runtime.InteropServices.Marshal]::FinalReleaseComObject($guideDoc) | Out-Null }
  if ($wordApp) { $wordApp.Quit(0); [Runtime.InteropServices.Marshal]::FinalReleaseComObject($wordApp) | Out-Null }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}

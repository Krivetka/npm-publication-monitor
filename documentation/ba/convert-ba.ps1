# Opens BA.html in Word, embeds images, inserts a real table of contents, page numbers,
# saves BA_Kuliashov_Ivan.docx and a PDF, prints the page count of the main text.
#   pwsh -File documentation/ba/convert-ba.ps1
param([string]$Suffix = '',   # '' for the English file, '_ru' for the Russian review copy
      [string]$Html = '')     # input HTML; default BA$Suffix.html next to this script
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $Html) { $Html = Join-Path $here "BA$Suffix.html" }
$html = (Resolve-Path $Html).Path
$docx = Join-Path $here "BA_Kuliashov_Ivan$Suffix.docx"
$pdf  = Join-Path $here "BA_Kuliashov_Ivan$Suffix.pdf"

$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try {
  "step: opening"
  $doc = $word.Documents.Open($html, $false, $false, $false)   # ConfirmConversions, ReadOnly, AddToRecentFiles
  # Page setup (HTML @page is not always honoured)
  $ps = $doc.PageSetup
  $ps.PaperSize = 7            # wdPaperA4
  $ps.TopMargin = 56.7; $ps.BottomMargin = 56.7; $ps.LeftMargin = 70.9; $ps.RightMargin = 56.7
  # Embed linked images
  foreach ($s in @($doc.InlineShapes)) {
    try { if ($s.LinkFormat -ne $null) { $s.LinkFormat.SavePictureWithDocument = $true; $s.LinkFormat.BreakLink() } } catch {}
  }
  # Tables: header row repeated on every page
  foreach ($t in @($doc.Tables)) {
    try { $t.Rows.Item(1).HeadingFormat = -1 } catch {}
  }
  # Appendix B (diagrams) in landscape: a section from its heading to the Statements heading
  $h = @($doc.Paragraphs | Where-Object { ($_.Range.Text.Trim() -like 'Appendix B*' -or $_.Range.Text.Trim() -like 'Приложение B*') -and $_.OutlineLevel -eq 1 })
  $s = @($doc.Paragraphs | Where-Object { ($_.Range.Text.Trim() -like 'Statements*' -or $_.Range.Text.Trim() -like 'Заявления*') -and $_.OutlineLevel -eq 1 })
  if ($h.Count -gt 0 -and $s.Count -gt 0) {
    $s[0].Range.InsertBreak(2)   # wdSectionBreakNextPage before Statements
    $h[0].Range.InsertBreak(2)   # and before Appendix B
    # the h1 CSS also sets a page break before these headings: with the section break that gives a blank page
    foreach ($pat in @('Appendix B*', 'Приложение B*', 'Statements*', 'Заявления*')) {
      foreach ($para in @($doc.Paragraphs | Where-Object { $_.Range.Text.Trim() -like $pat -and $_.OutlineLevel -eq 1 })) {
        $para.PageBreakBefore = 0
        try { $para.Previous(1).PageBreakBefore = 0 } catch {}   # the paragraph that now holds the section break
      }
    }
    $land = $doc.Sections.Item($doc.Sections.Count - 1)
    $land.PageSetup.Orientation = 1   # wdOrientLandscape
    $land.PageSetup.TopMargin = 56.7; $land.PageSetup.BottomMargin = 56.7; $land.PageSetup.LeftMargin = 56.7; $land.PageSetup.RightMargin = 56.7
    foreach ($i in 1..$doc.Sections.Count) { $sec = $doc.Sections.Item($i); $sec.Footers.Item(1).LinkToPrevious = $true }
    # one diagram per page: each caption starts a page and stays with its image
    $caps = @($land.Range.Paragraphs | Where-Object { $_.Range.Text -match "^(Figure|Рисунок) B." })
    for ($k = 0; $k -lt $caps.Count; $k++) { $caps[$k].KeepWithNext = -1; if ($k -gt 0) { $caps[$k].PageBreakBefore = -1 } }
  }
  # Table of contents at the placeholder
  $find = $doc.Content.Find
  $find.ClearFormatting()
  if ($find.Execute('[[TOC]]')) {
    $range = $doc.Content
    $f2 = $range.Find; $f2.ClearFormatting(); [void]$f2.Execute('[[TOC]]')
    $range.Text = ''
    $toc = $doc.TablesOfContents.Add($range, $true, 1, 3, $false, '', $true, $true, '', $true, $true)
    $toc.Update()
  }
  # Page numbers in the footer, none on the title page
  $sec = $doc.Sections.Item(1)
  $sec.PageSetup.DifferentFirstPageHeaderFooter = -1
  $footer = $sec.Footers.Item(1)   # wdHeaderFooterPrimary
  [void]$footer.PageNumbers.Add(1, $false)  # wdAlignPageNumberCenter, no number on the title page
  "step: fields"
  $doc.Fields.Update() | Out-Null
  $doc.TablesOfContents.Item(1).Update()
  "step: saving"
  $doc.SaveAs2($docx, 16)      # wdFormatXMLDocument (.docx)
  "step: pdf"
  $doc.ExportAsFixedFormat($pdf, 17)   # wdExportFormatPDF
  $pages = $doc.ComputeStatistics(2)   # wdStatisticPages
  "pages_total=$pages"
  $doc.Close($false)
} finally {
  $word.Quit()
}
# Word stamps its own user name as lastModifiedBy; set both names to the Latin form on the title page
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($docx, "Update")
try {
  $entry = $zip.GetEntry("docProps/core.xml")
  $reader = New-Object System.IO.StreamReader($entry.Open()); $xml = $reader.ReadToEnd(); $reader.Close()
  $xml = $xml -replace "<dc:creator>[^<]*</dc:creator>", "<dc:creator>Ivan Kuliashov</dc:creator>" -replace "<cp:lastModifiedBy>[^<]*</cp:lastModifiedBy>", "<cp:lastModifiedBy>Ivan Kuliashov</cp:lastModifiedBy>"
  $entry.Delete()
  $new = $zip.CreateEntry("docProps/core.xml")
  $writer = New-Object System.IO.StreamWriter($new.Open(), (New-Object System.Text.UTF8Encoding($false))); $writer.Write($xml); $writer.Close()
} finally { $zip.Dispose() }
"author=Ivan Kuliashov"

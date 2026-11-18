param()

Write-Host 'This operation can overwrite data. Confirm before continuing.'
$confirmation = Read-Host 'Type RESTORE to continue'
if ($confirmation -ne 'RESTORE') {
  throw 'Restore cancelled.'
}
Write-Host 'Restore process started.'

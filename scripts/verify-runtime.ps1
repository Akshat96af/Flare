param([Parameter(Mandatory=$true)][string]$File)
$ErrorActionPreference = 'Stop'
Import-Module "$PSHOME\Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1" -Force
$signature = Get-AuthenticodeSignature -LiteralPath $File
@{ valid = ($signature.Status -eq 'Valid' -and $signature.SignerCertificate.Subject -like '*Microsoft Corporation*') } | ConvertTo-Json -Compress

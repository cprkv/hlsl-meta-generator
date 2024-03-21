[CmdletBinding()]
param (
  [Parameter(ValueFromRemainingArguments=$true)]
  $Arguments
)

$path = ."$PSScriptRoot/vswhere.exe" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if ($path) {
  $path = join-path $path 'Common7\Tools\vsdevcmd.bat'
  if (test-path $path) {
    echo "devcmd: $path"
    cmd /s /c """$path"" $args && set" | Where-Object { $_ -match '(\w+)=(.*)' } | ForEach-Object {
      $null = new-item -force -path "Env:\$($Matches[1])" -value $Matches[2]
    }
  }
}

cl.exe $Arguments

# Run on the owner's machine while signed into the WageWise Supabase project.
$ErrorActionPreference = 'Stop'
$name = (Read-Host 'WageWise admin username').Trim().ToLowerInvariant()
if($name -notmatch '^[a-z0-9][a-z0-9_.-]{2,31}$'){throw 'Enter a valid 3–32 character username.'}
$secure = Read-Host 'New admin password (at least 12 characters)' -AsSecureString
$credential = [pscredential]::new($name,$secure)
$pass = $credential.GetNetworkCredential().Password
if($pass.Length -lt 12 -or [Text.Encoding]::UTF8.GetByteCount($pass) -gt 72){throw 'Password must be at least 12 characters and at most 72 UTF-8 bytes.'}
$config = Get-Content (Join-Path $PSScriptRoot '../supabase/client.json') -Raw | ConvertFrom-Json
$ref = ([uri]$config.url).Host.Split('.')[0]
try {
  $keys = npx.cmd --yes supabase projects api-keys "--remote=$ref" --reveal --output json | ConvertFrom-Json
  if($LASTEXITCODE -ne 0){throw 'Sign in to the Supabase CLI and retry.'}
  $key = ($keys | Where-Object {$_.api_key -like 'sb_secret_*'} | Select-Object -First 1).api_key
  if(!$key){$key=($keys | Where-Object name -eq 'service_role' | Select-Object -First 1).api_key}
  if(!$key){throw 'No server key was available.'}
  $headers=@{apikey=$key}
  if(!$key.StartsWith('sb_')){$headers.Authorization='Bearer '+$key}
  $ready=Invoke-RestMethod -UserAgent WageWise-Admin-Setup/1.0 -Method Post -Uri ($config.url+'/rest/v1/rpc/ww_account_api') -Headers $headers -ContentType 'application/json' -Body '{"op":"admin_ready"}'
  if($ready){throw 'The administrator is already provisioned.'}
  $payload=@{email=([guid]::NewGuid().ToString()+'@accounts.wagewise.invalid');password=$pass;email_confirm=$true;app_metadata=@{ww_username=$name;ww_role='admin'}}
  $null=Invoke-RestMethod -UserAgent WageWise-Admin-Setup/1.0 -Method Post -Uri ($config.url+'/auth/v1/admin/users') -Headers $headers -ContentType 'application/json' -Body ($payload|ConvertTo-Json -Depth 3)
  Write-Host 'Administrator provisioned. Open /admin on the WageWise Worker.'
} finally {
  $pass=$null;$payload=$null;$credential=$null;$key=$null;$keys=$null;$headers=$null;$secure.Dispose()
}

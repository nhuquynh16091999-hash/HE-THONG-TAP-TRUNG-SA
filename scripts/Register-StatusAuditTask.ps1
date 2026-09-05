# Register-StatusAuditTask.ps1
# Creates a Windows Scheduled Task to run Status Audit at 8:00 AM and 4:00 PM VN time

$taskName = "Stramark_Status_Audit_Daily"
$batPath  = "D:\Stramark_ver2\scripts\status_audit.bat"
$workDir  = "D:\Stramark_ver2"

# Remove existing task if present
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

# Create task components — two triggers: 8:00 AM and 4:00 PM
$action    = New-ScheduledTaskAction -Execute $batPath -WorkingDirectory $workDir
$trigger1  = New-ScheduledTaskTrigger -Daily -At "08:00AM"
$trigger2  = New-ScheduledTaskTrigger -Daily -At "04:00PM"
$settings  = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

# Register the task with both triggers
Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger @($trigger1, $trigger2) `
    -Settings $settings `
    -Description "Status Audit: POS vs euShipments cross-check (8AM + 4PM VN)" `
    -Force

Write-Host ""
Write-Host "Task '$taskName' registered successfully!" -ForegroundColor Green
Write-Host "  Schedule : Daily at 8:00 AM + 4:00 PM (SE Asia Standard Time)"
Write-Host "  Script   : $batPath"
Write-Host ""

# Show task info
Get-ScheduledTask -TaskName $taskName | Format-List TaskName, State, Description
Get-ScheduledTaskInfo -TaskName $taskName | Format-List LastRunTime, NextRunTime

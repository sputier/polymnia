# Encodes every .wav of -In to an AAC-LC .m4a (mono, 48 kbps) of -Out, with the Windows Media Foundation encoder
# (Windows.Media.Transcoding). Used by build-fallback.mjs; see docs/playback.md, "Safari".
param(
  [Parameter(Mandatory = $true)][string]$In,
  [Parameter(Mandatory = $true)][string]$Out,
  [int]$Bitrate = 48000
)
$ErrorActionPreference = 'Stop'
[void][Windows.Media.Transcoding.MediaTranscoder, Windows.Media.Transcoding, ContentType = WindowsRuntime]
[void][Windows.Media.MediaProperties.MediaEncodingProfile, Windows.Media.MediaProperties, ContentType = WindowsRuntime]
[void][Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
Add-Type -AssemblyName System.Runtime.WindowsRuntime

$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  })[0]
$asTaskProgress = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncActionWithProgress`1'
  })[0]

function Wait-Operation($operation, [type]$type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($operation))
  $task.Wait(-1) | Out-Null
  $task.Result
}

$outFolder = Wait-Operation ([Windows.Storage.StorageFolder]::GetFolderFromPathAsync((Resolve-Path $Out).Path)) ([Windows.Storage.StorageFolder])
foreach ($wav in Get-ChildItem -LiteralPath $In -Filter *.wav) {
  $name = [IO.Path]::GetFileNameWithoutExtension($wav.Name) + '.m4a'
  $source = Wait-Operation ([Windows.Storage.StorageFile]::GetFileFromPathAsync($wav.FullName)) ([Windows.Storage.StorageFile])
  $target = Wait-Operation ($outFolder.CreateFileAsync($name, [Windows.Storage.CreationCollisionOption]::ReplaceExisting)) ([Windows.Storage.StorageFile])
  $profile = [Windows.Media.MediaProperties.MediaEncodingProfile]::CreateM4a([Windows.Media.MediaProperties.AudioEncodingQuality]::Low)
  $profile.Audio.Bitrate = $Bitrate
  $profile.Audio.ChannelCount = 1
  $profile.Audio.SampleRate = 48000
  $transcoder = New-Object Windows.Media.Transcoding.MediaTranscoder
  $prepared = Wait-Operation ($transcoder.PrepareFileTranscodeAsync($source, $target, $profile)) ([Windows.Media.Transcoding.PrepareTranscodeResult])
  if (-not $prepared.CanTranscode) { throw "Cannot encode $($wav.Name): $($prepared.FailureReason)" }
  $task = $asTaskProgress.MakeGenericMethod([double]).Invoke($null, @($prepared.TranscodeAsync()))
  $task.Wait(-1) | Out-Null
}

Add-Type -AssemblyName System.Speech

[AppDomain]::CurrentDomain.add_UnhandledException({
    param($s, $e)
    [Console]::WriteLine("UNHANDLED: " + $e.ExceptionObject.ToString())
    [Console]::Out.Flush()
})

[AppDomain]::CurrentDomain.add_ProcessExit({
    param($s, $e)
    [Console]::WriteLine("PROCESS_EXIT fired")
    [Console]::Out.Flush()
})

try {
    $r = New-Object System.Speech.Recognition.SpeechRecognitionEngine
    $r.SetInputToDefaultAudioDevice()
    $r.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))

    $r.add_SpeechRecognized({
        param($s, $e)
        [Console]::WriteLine("TRANSCRIPT:" + $e.Result.Text)
        [Console]::Out.Flush()
    })

    $r.add_RecognizeCompleted({
        param($s, $e)
        if ($e.Error) {
            [Console]::WriteLine("RECOGNIZE_ENDED_ERR: " + $e.Error.GetType().Name + " - " + $e.Error.Message)
        } else {
            [Console]::WriteLine("RECOGNIZE_ENDED_OK (no error)")
        }
        [Console]::Out.Flush()
    })

    $r.add_AudioLevelUpdated({
        param($s, $e)
        if ($e.AudioLevel -gt 0) {
            [Console]::WriteLine("LEVEL:" + $e.AudioLevel)
            [Console]::Out.Flush()
        }
    })

    $r.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)
    [Console]::WriteLine("READY with default audio device - speak now")
    [Console]::Out.Flush()

    $tick = 0
    while ($true) {
        Start-Sleep -Milliseconds 1000
        $tick++
        $state = $r.AudioState
        [Console]::WriteLine("TICK " + $tick + " | audio state: " + $state)
        [Console]::Out.Flush()
    }

} catch {
    [Console]::WriteLine("PS_CATCH: " + $_.Exception.GetType().Name + " - " + $_.Exception.Message)
    [Console]::WriteLine($_.ScriptStackTrace)
    [Console]::Out.Flush()
    exit 1
}

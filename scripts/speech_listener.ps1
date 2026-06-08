param([int]$DeviceIndex = 5)

Add-Type -AssemblyName System.Speech

Add-Type -TypeDefinition @"
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Collections.Concurrent;

public class WaveInStream : Stream {

    [StructLayout(LayoutKind.Sequential, Pack = 1)]
    struct WAVEFORMATEX {
        public ushort wFormatTag;
        public ushort nChannels;
        public uint   nSamplesPerSec;
        public uint   nAvgBytesPerSec;
        public ushort nBlockAlign;
        public ushort wBitsPerSample;
        public ushort cbSize;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct WAVEHDR {
        public IntPtr lpData;
        public uint   dwBufferLength;
        public uint   dwBytesRecorded;
        public IntPtr dwUser;
        public uint   dwFlags;
        public uint   dwLoops;
        public IntPtr lpNext;
        public IntPtr reserved;
    }

    const uint CALLBACK_EVENT = 0x00020000;
    const uint WHDR_DONE      = 0x00000001;
    const int  BUF_COUNT      = 4;
    const int  BUF_SIZE       = 192000; // 1 sec at 48kHz stereo 16-bit

    [DllImport("winmm.dll")] static extern int  waveInOpen(out IntPtr hwi, uint id, ref WAVEFORMATEX fmt, IntPtr cb, IntPtr inst, uint flags);
    [DllImport("winmm.dll")] static extern int  waveInPrepareHeader(IntPtr hwi, IntPtr ph, uint sz);
    [DllImport("winmm.dll")] static extern int  waveInAddBuffer(IntPtr hwi, IntPtr ph, uint sz);
    [DllImport("winmm.dll")] static extern int  waveInStart(IntPtr hwi);
    [DllImport("winmm.dll")] static extern int  waveInStop(IntPtr hwi);
    [DllImport("winmm.dll")] static extern int  waveInReset(IntPtr hwi);
    [DllImport("winmm.dll")] static extern int  waveInClose(IntPtr hwi);
    [DllImport("winmm.dll")] static extern int  waveInUnprepareHeader(IntPtr hwi, IntPtr ph, uint sz);
    [DllImport("kernel32.dll")] static extern IntPtr CreateEvent(IntPtr sec, bool manual, bool init, string name);
    [DllImport("kernel32.dll")] static extern bool   CloseHandle(IntPtr h);
    [DllImport("kernel32.dll")] static extern uint   WaitForSingleObject(IntPtr h, uint ms);

    IntPtr   hWaveIn, hEvent;
    IntPtr[] hdrPtrs   = new IntPtr[BUF_COUNT];
    GCHandle[] audioPins = new GCHandle[BUF_COUNT];
    byte[][]   audioData = new byte[BUF_COUNT][];
    ConcurrentQueue<byte[]> queue = new ConcurrentQueue<byte[]>();
    Thread captureThread;
    volatile bool running = true;
    byte[] pending;
    int pendingOff;
    long _position;

    public WaveInStream(int deviceIndex) {
        var fmt = new WAVEFORMATEX();
        fmt.wFormatTag     = 1;
        fmt.nChannels      = 2;      // stereo - Voicemeeter native
        fmt.nSamplesPerSec = 48000;  // 48kHz - Voicemeeter native
        fmt.wBitsPerSample = 16;
        fmt.nBlockAlign    = 4;      // 2 channels * 2 bytes
        fmt.nAvgBytesPerSec = 192000; // 48000 * 4
        fmt.cbSize         = 0;

        hEvent = CreateEvent(IntPtr.Zero, false, false, null);
        int r  = waveInOpen(out hWaveIn, (uint)deviceIndex, ref fmt, hEvent, IntPtr.Zero, CALLBACK_EVENT);
        if (r != 0) throw new Exception("waveInOpen failed with code " + r + " for device index " + deviceIndex);

        int hdrSz = Marshal.SizeOf(typeof(WAVEHDR));
        for (int i = 0; i < BUF_COUNT; i++) {
            audioData[i] = new byte[BUF_SIZE];
            audioPins[i] = GCHandle.Alloc(audioData[i], GCHandleType.Pinned);
            hdrPtrs[i]   = Marshal.AllocHGlobal(hdrSz);

            var hdr = new WAVEHDR();
            hdr.lpData        = audioPins[i].AddrOfPinnedObject();
            hdr.dwBufferLength = (uint)BUF_SIZE;
            Marshal.StructureToPtr(hdr, hdrPtrs[i], false);

            waveInPrepareHeader(hWaveIn, hdrPtrs[i], (uint)hdrSz);
            waveInAddBuffer(hWaveIn, hdrPtrs[i], (uint)hdrSz);
        }

        waveInStart(hWaveIn);
        captureThread = new Thread(new ThreadStart(Loop));
        captureThread.IsBackground = true;
        captureThread.Start();
    }

    long totalBytes = 0;
    public long TotalBytes { get { return totalBytes; } }

    // Decimate 48kHz stereo 16-bit to 16kHz mono 16-bit (3:1 decimation, mix L+R channels)
    byte[] Downsample(byte[] src, int srcLen) {
        int inFrames  = srcLen / 4;       // 4 bytes per stereo frame
        int outFrames = inFrames / 3;     // keep every 3rd frame
        byte[] result = new byte[outFrames * 2];
        int outIdx = 0;
        for (int i = 0; i < outFrames; i++) {
            int s = i * 12;               // 3 frames * 4 bytes
            short L    = (short)(src[s]     | (src[s + 1] << 8));
            short R    = (short)(src[s + 2] | (src[s + 3] << 8));
            short mono = (short)((L + R) >> 1);
            result[outIdx]     = (byte)(mono & 0xFF);
            result[outIdx + 1] = (byte)((mono >> 8) & 0xFF);
            outIdx += 2;
        }
        return result;
    }

    void Loop() {
        int hdrSz = Marshal.SizeOf(typeof(WAVEHDR));
        while (running) {
            WaitForSingleObject(hEvent, 100);
            for (int i = 0; i < BUF_COUNT && running; i++) {
                var h = (WAVEHDR)Marshal.PtrToStructure(hdrPtrs[i], typeof(WAVEHDR));
                if ((h.dwFlags & WHDR_DONE) == 0) continue;
                int len = (int)h.dwBytesRecorded;
                if (len > 0) {
                    var raw = new byte[len];
                    Marshal.Copy(h.lpData, raw, 0, len);
                    byte[] mono = Downsample(raw, len);
                    queue.Enqueue(mono);
                    totalBytes += mono.Length;
                }
                h.dwFlags         = h.dwFlags & 0xFFFFFFFEu;
                h.dwBytesRecorded = 0;
                Marshal.StructureToPtr(h, hdrPtrs[i], false);
                waveInAddBuffer(hWaveIn, hdrPtrs[i], (uint)hdrSz);
            }
        }
    }

    public override int Read(byte[] buffer, int offset, int count) {
        int written = 0;
        while (written < count && running) {
            if (pending != null) {
                int take = Math.Min(pending.Length - pendingOff, count - written);
                Array.Copy(pending, pendingOff, buffer, offset + written, take);
                written    += take;
                pendingOff += take;
                if (pendingOff >= pending.Length) { pending = null; pendingOff = 0; }
                continue;
            }
            byte[] chunk = null;
            while (running && !queue.TryDequeue(out chunk)) { Thread.Sleep(5); }
            if (chunk != null) { pending = chunk; pendingOff = 0; }
        }
        _position += written;
        return written;
    }

    public override bool CanRead  { get { return true;  } }
    public override bool CanSeek  { get { return true;  } }
    public override bool CanWrite { get { return false; } }
    public override long Length   { get { return long.MaxValue; } }
    public override long Position {
        get { return _position; }
        set { _position = value; }
    }
    public override void Flush() {}
    public override long Seek(long offset, SeekOrigin origin) { return _position; }
    public override void SetLength(long value) { }
    public override void Write(byte[] buffer, int offset, int count) { throw new NotSupportedException(); }

    protected override void Dispose(bool disposing) {
        running = false;
        if (hWaveIn != IntPtr.Zero) {
            waveInStop(hWaveIn);
            waveInReset(hWaveIn);
            int sz = Marshal.SizeOf(typeof(WAVEHDR));
            for (int i = 0; i < BUF_COUNT; i++) {
                waveInUnprepareHeader(hWaveIn, hdrPtrs[i], (uint)sz);
                Marshal.FreeHGlobal(hdrPtrs[i]);
                audioPins[i].Free();
            }
            waveInClose(hWaveIn);
            hWaveIn = IntPtr.Zero;
        }
        if (hEvent != IntPtr.Zero) { CloseHandle(hEvent); hEvent = IntPtr.Zero; }
        base.Dispose(disposing);
    }
}
"@

[AppDomain]::CurrentDomain.add_UnhandledException({
    param($s, $e)
    [Console]::WriteLine("UNHANDLED: " + $e.ExceptionObject.ToString())
    [Console]::Out.Flush()
})

try {
    [Console]::WriteLine("Opening WaveIn device " + $DeviceIndex)
    [Console]::Out.Flush()

    $stream = New-Object WaveInStream($DeviceIndex)

    $fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(
        [System.Speech.AudioFormat.EncodingFormat]::Pcm,
        16000,   # samplesPerSecond (after downsampling)
        16,      # bitsPerSample
        1,       # channelCount (mono, after mixing L+R)
        32000,   # avgBytesPerSecond (16000 * 2)
        2,       # blockAlign (1ch * 2 bytes)
        $null)   # formatSpecificData

    $r = New-Object System.Speech.Recognition.SpeechRecognitionEngine
    $r.SetInputToAudioStream($stream, $fmt)
    $r.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))

    $r.add_SpeechRecognized({
        param($s, $e)
        $text = $e.Result.Text.Trim()
        if ($text -ne "") {
            [Console]::WriteLine("TRANSCRIPT:" + $text)
            [Console]::Out.Flush()
        }
    })

    $r.add_AudioLevelUpdated({
        param($s, $e)
        if ($e.AudioLevel -gt 0) {
            [Console]::WriteLine("LEVEL:" + $e.AudioLevel)
            [Console]::Out.Flush()
        }
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

    $r.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)
    [Console]::WriteLine("READY on device " + $DeviceIndex + " - speak now")
    [Console]::Out.Flush()

    $tick = 0
    while ($true) {
        Start-Sleep -Milliseconds 1000
        $tick++
        $bytes = $stream.TotalBytes
        [Console]::WriteLine("TICK " + $tick + " | bytes captured: " + $bytes)
        [Console]::Out.Flush()
    }

} catch {
    [Console]::WriteLine("PS_CATCH: " + $_.Exception.GetType().Name + " - " + $_.Exception.Message)
    [Console]::WriteLine($_.ScriptStackTrace)
    [Console]::Out.Flush()
    exit 1
}

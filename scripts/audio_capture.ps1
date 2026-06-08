param([int]$DeviceIndex = 5)

Add-Type -TypeDefinition @"
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Collections.Concurrent;

public class AudioCapture {

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
    const int  BUF_SIZE       = 192000;

    [DllImport("winmm.dll")] static extern int   waveInOpen(out IntPtr hwi, uint id, ref WAVEFORMATEX fmt, IntPtr cb, IntPtr inst, uint flags);
    [DllImport("winmm.dll")] static extern int   waveInPrepareHeader(IntPtr hwi, IntPtr ph, uint sz);
    [DllImport("winmm.dll")] static extern int   waveInAddBuffer(IntPtr hwi, IntPtr ph, uint sz);
    [DllImport("winmm.dll")] static extern int   waveInStart(IntPtr hwi);
    [DllImport("winmm.dll")] static extern int   waveInStop(IntPtr hwi);
    [DllImport("winmm.dll")] static extern int   waveInReset(IntPtr hwi);
    [DllImport("winmm.dll")] static extern int   waveInClose(IntPtr hwi);
    [DllImport("winmm.dll")] static extern int   waveInUnprepareHeader(IntPtr hwi, IntPtr ph, uint sz);
    [DllImport("kernel32.dll")] static extern IntPtr CreateEvent(IntPtr sec, bool manual, bool init, string name);
    [DllImport("kernel32.dll")] static extern bool   CloseHandle(IntPtr h);
    [DllImport("kernel32.dll")] static extern uint   WaitForSingleObject(IntPtr h, uint ms);

    IntPtr   hWaveIn, hEvent;
    IntPtr[] hdrPtrs = new IntPtr[BUF_COUNT];
    GCHandle[] pins  = new GCHandle[BUF_COUNT];
    byte[][]   bufs  = new byte[BUF_COUNT][];
    ConcurrentQueue<byte[]> queue = new ConcurrentQueue<byte[]>();
    volatile bool running = true;

    public AudioCapture(int deviceIndex) {
        var fmt = new WAVEFORMATEX();
        fmt.wFormatTag      = 1;
        fmt.nChannels       = 2;
        fmt.nSamplesPerSec  = 48000;
        fmt.wBitsPerSample  = 16;
        fmt.nBlockAlign     = 4;
        fmt.nAvgBytesPerSec = 192000;
        fmt.cbSize          = 0;

        hEvent = CreateEvent(IntPtr.Zero, false, false, null);
        int r  = waveInOpen(out hWaveIn, (uint)deviceIndex, ref fmt, hEvent, IntPtr.Zero, CALLBACK_EVENT);
        if (r != 0) throw new Exception("waveInOpen failed: " + r);

        int hdrSz = Marshal.SizeOf(typeof(WAVEHDR));
        for (int i = 0; i < BUF_COUNT; i++) {
            bufs[i]    = new byte[BUF_SIZE];
            pins[i]    = GCHandle.Alloc(bufs[i], GCHandleType.Pinned);
            hdrPtrs[i] = Marshal.AllocHGlobal(hdrSz);
            var hdr = new WAVEHDR();
            hdr.lpData         = pins[i].AddrOfPinnedObject();
            hdr.dwBufferLength = (uint)BUF_SIZE;
            Marshal.StructureToPtr(hdr, hdrPtrs[i], false);
            waveInPrepareHeader(hWaveIn, hdrPtrs[i], (uint)hdrSz);
            waveInAddBuffer(hWaveIn, hdrPtrs[i], (uint)hdrSz);
        }

        waveInStart(hWaveIn);
        var t = new Thread(new ThreadStart(CaptureLoop));
        t.IsBackground = true;
        t.Start();
    }

    void CaptureLoop() {
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
                    queue.Enqueue(Downsample(raw, len));
                }
                h.dwFlags         = h.dwFlags & 0xFFFFFFFEu;
                h.dwBytesRecorded = 0;
                Marshal.StructureToPtr(h, hdrPtrs[i], false);
                waveInAddBuffer(hWaveIn, hdrPtrs[i], (uint)hdrSz);
            }
        }
    }

    byte[] Downsample(byte[] src, int srcLen) {
        int inFrames  = srcLen / 4;
        int outFrames = inFrames / 3;
        byte[] result = new byte[outFrames * 2];
        int outIdx = 0;
        for (int i = 0; i < outFrames; i++) {
            int s = i * 12;
            short L    = (short)(src[s]     | (src[s + 1] << 8));
            short R    = (short)(src[s + 2] | (src[s + 3] << 8));
            short mono = (short)((L + R) >> 1);
            result[outIdx]     = (byte)(mono & 0xFF);
            result[outIdx + 1] = (byte)((mono >> 8) & 0xFF);
            outIdx += 2;
        }
        return result;
    }

    public void Run() {
        var stderr = new StreamWriter(Console.OpenStandardError()) { AutoFlush = true };
        stderr.WriteLine("READY");
        var stdout = Console.OpenStandardOutput();
        while (running) {
            byte[] chunk;
            if (queue.TryDequeue(out chunk)) {
                stdout.Write(chunk, 0, chunk.Length);
                stdout.Flush();
            } else {
                Thread.Sleep(1);
            }
        }
    }
}
"@

try {
    $cap = New-Object AudioCapture($DeviceIndex)
    $cap.Run()
} catch {
    [Console]::Error.WriteLine("ERROR: " + $_.Exception.Message)
    exit 1
}

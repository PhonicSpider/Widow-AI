Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class WaveInHelper {
    [DllImport("winmm.dll")]
    public static extern int waveInGetNumDevs();

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode, Pack = 4)]
    public struct WAVEINCAPS {
        public ushort wMid;
        public ushort wPid;
        public uint vDriverVersion;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string szPname;
        public uint dwFormats;
        public ushort wChannels;
        public ushort wReserved1;
    }

    [DllImport("winmm.dll", EntryPoint="waveInGetDevCapsW", CharSet = CharSet.Unicode)]
    public static extern int waveInGetDevCaps(uint id, ref WAVEINCAPS caps, uint size);
}
"@

$count = [WaveInHelper]::waveInGetNumDevs()
Write-Host "WaveIn devices ($count total):"
for ($i = 0; $i -lt $count; $i++) {
    $caps = New-Object WaveInHelper+WAVEINCAPS
    $size = [System.Runtime.InteropServices.Marshal]::SizeOf($caps)
    [WaveInHelper]::waveInGetDevCaps([uint32]$i, [ref]$caps, [uint32]$size) | Out-Null
    Write-Host "  [$i] $($caps.szPname)  ch=$($caps.wChannels)"
}

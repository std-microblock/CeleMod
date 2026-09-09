using System.ComponentModel;
using System.Runtime.InteropServices;

// FileMode.Append only seeks to EOF once on Unix. Use kernel O_APPEND so a
// native write between managed writes cannot be overwritten by a stale offset.
internal sealed class AppendLogStream : Stream
{
    private int descriptor;
    private AppendLogStream(int descriptor) => this.descriptor = descriptor;

    internal static Stream Open(string path)
    {
        if (!OperatingSystem.IsLinux() && !OperatingSystem.IsAndroid())
            return new FileStream(path, FileMode.Append, FileAccess.Write, FileShare.ReadWrite);
        // Linux/Android: O_WRONLY | O_CREAT | O_APPEND | O_CLOEXEC, mode 0600.
        var fd = open(path, 1 | 64 | 1024 | 0x80000, 384);
        if (fd < 0) throw new Win32Exception(Marshal.GetLastPInvokeError());
        return new AppendLogStream(fd);
    }

    public override bool CanRead => false;
    public override bool CanSeek => false;
    public override bool CanWrite => descriptor >= 0;
    public override long Length => throw new NotSupportedException();
    public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
    public override void Flush() { }
    public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
    public override void SetLength(long value) => throw new NotSupportedException();

    public override void Write(byte[] buffer, int offset, int count)
    {
        ObjectDisposedException.ThrowIf(descriptor < 0, this);
        ArgumentNullException.ThrowIfNull(buffer);
        if (offset < 0 || count < 0 || offset > buffer.Length - count) throw new ArgumentOutOfRangeException();
        if (count == 0) return;
        var pinned = GCHandle.Alloc(buffer, GCHandleType.Pinned);
        try {
            while (count > 0) {
                var written = write(descriptor, IntPtr.Add(pinned.AddrOfPinnedObject(), offset), (nuint)count);
                if (written < 0) {
                    var error = Marshal.GetLastPInvokeError();
                    if (error == 4) continue; // EINTR: no bytes were written, retry.
                    throw new Win32Exception(error);
                }
                if (written == 0) throw new IOException("Game log write made no progress.");
                offset += (int)written;
                count -= (int)written;
            }
        } finally { pinned.Free(); }
    }

    protected override void Dispose(bool disposing)
    {
        var fd = Interlocked.Exchange(ref descriptor, -1);
        if (fd >= 0) close(fd);
        base.Dispose(disposing);
    }

    [DllImport("libc", SetLastError = true)]
    private static extern int open([MarshalAs(UnmanagedType.LPUTF8Str)] string path, int flags, int mode);
    [DllImport("libc", SetLastError = true)]
    private static extern nint write(int fd, IntPtr buffer, nuint count);
    [DllImport("libc")]
    private static extern int close(int fd);
}
